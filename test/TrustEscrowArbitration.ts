import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress, zeroAddress } from "viem";

const unit = 10n ** 6n;
const day = 24n * 3600n;
const evidence = `0x${"22".repeat(32)}` as `0x${string}`;
const Project = { UNFUNDED: 0, FUNDED: 1, ACTIVE: 2, COMPLETED: 3, CLOSED: 4 };
const Milestone = { PENDING: 0, SUBMITTED: 1, DISPUTED: 2, SETTLED: 3 };

describe("TrustLayer Phase 2A arbitration foundation", async () => {
  const { viem, networkHelpers } = await network.create();
  const publicClient = await viem.getPublicClient();

  async function baseFixture() {
    const [client, freelancer, treasury, outsider, secondClient, secondFreelancer] = await viem.getWalletClients();
    const token = await viem.deployContract("MockUSD", [client.account.address]);
    const escrow = await viem.deployContract("TrustEscrow", [token.address, treasury.account.address]);
    const arbitration = await viem.deployContract("ArbitrationHarness", [escrow.address]);
    const rogue = await viem.deployContract("ArbitrationHarness", [escrow.address]);
    return { client, freelancer, treasury, outsider, secondClient, secondFreelancer, token, escrow, arbitration, rogue };
  }

  async function configuredFixture() {
    const f = await baseFixture();
    await f.escrow.write.setArbitrationContract([f.arbitration.address]);
    return f;
  }

  type Fixture = Awaited<ReturnType<typeof baseFixture>>;

  async function createProject(
    f: Fixture,
    amounts = [400n * unit, 600n * unit],
    client = f.client,
    freelancer = f.freelancer,
  ) {
    const now = (await publicClient.getBlock()).timestamp;
    const dueDates = amounts.map((_, i) => now + 14n * day + BigInt(i) * 7n * day);
    const id = await f.escrow.read.nextProjectId();
    await f.escrow.write.createProject([freelancer.account.address, amounts, dueDates, evidence], { account: client.account });
    return { id, dueDates };
  }

  async function fundAndAccept(f: Fixture, id: bigint, client = f.client, freelancer = f.freelancer) {
    const project = await f.escrow.read.projects([id]);
    await f.token.write.approve([f.escrow.address, project[3]], { account: client.account });
    await f.escrow.write.fundProject([id], { account: client.account });
    await f.escrow.write.acceptProject([id], { account: freelancer.account });
  }

  async function submittedFixture() {
    const f = await configuredFixture();
    const project = await createProject(f);
    await fundAndAccept(f, project.id);
    await f.escrow.write.submitMilestone([project.id, 0n, evidence], { account: f.freelancer.account });
    return { ...f, ...project };
  }

  async function frozenFixture() {
    const f = await submittedFixture();
    await f.arbitration.write.freeze([f.id, 0n]);
    return f;
  }

  async function assertAccounting(f: Fixture, ids: bigint[], surplus = 0n) {
    let remaining = 0n;
    for (const id of ids) remaining += (await f.escrow.read.projects([id]))[4];
    assert.equal(await f.escrow.read.totalEscrowLiability(), remaining);
    assert.equal(await f.token.read.balanceOf([f.escrow.address]), remaining + surplus);
  }

  it("starts with arbitration disabled and records the deployer as sole configurator", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    assert.equal(await f.escrow.read.arbitrationContract(), zeroAddress);
    assert.equal(await f.escrow.read.arbitrationConfigurator(), getAddress(f.client.account.address));
    await viem.assertions.revertWithCustomError(f.arbitration.write.freeze([0n, 0n]), f.escrow, "Unauthorized");
    await viem.assertions.revertWithCustomError(f.arbitration.write.settle([0n, 0n, 5000n]), f.escrow, "Unauthorized");
  });

  it("rejects unauthorized initialization and zero, EOA or self addresses", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    for (const caller of [f.freelancer, f.treasury, f.outsider]) {
      await viem.assertions.revertWithCustomError(
        f.escrow.write.setArbitrationContract([f.arbitration.address], { account: caller.account }), f.escrow, "Unauthorized",
      );
    }
    for (const address of [zeroAddress, f.outsider.account.address, f.escrow.address]) {
      await viem.assertions.revertWithCustomError(f.escrow.write.setArbitrationContract([address]), f.escrow, "InvalidInput");
    }
    assert.equal(await f.escrow.read.arbitrationContract(), zeroAddress);
  });

  it("emits configuration once and cannot replace, reset or reinitialize arbitration", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    await viem.assertions.emitWithArgs(
      f.escrow.write.setArbitrationContract([f.arbitration.address]), f.escrow, "ArbitrationContractConfigured", [getAddress(f.arbitration.address)],
    );
    for (const address of [f.rogue.address, zeroAddress, f.arbitration.address]) {
      await viem.assertions.revertWithCustomError(f.escrow.write.setArbitrationContract([address]), f.escrow, "InvalidState");
    }
    assert.equal(await f.escrow.read.arbitrationContract(), getAddress(f.arbitration.address));
  });

  it("returns participants, amount, both states and the original review deadline", async () => {
    const f = await networkHelpers.loadFixture(submittedFixture);
    const milestone = await f.escrow.read.milestones([f.id, 0n]);
    const expected = {
      client: getAddress(f.client.account.address), freelancer: getAddress(f.freelancer.account.address),
      amount: 400n * unit, projectState: Project.ACTIVE, milestoneState: Milestone.SUBMITTED, reviewEnd: milestone[3],
    };
    assert.deepEqual(await f.escrow.read.getDisputeContext([f.id, 0n]), expected);
    await f.arbitration.write.freeze([f.id, 0n]);
    assert.deepEqual(await f.escrow.read.getDisputeContext([f.id, 0n]), { ...expected, milestoneState: Milestone.DISPUTED });
    await f.arbitration.write.settle([f.id, 0n, 5000n]);
    assert.deepEqual(await f.escrow.read.getDisputeContext([f.id, 0n]), { ...expected, milestoneState: Milestone.SETTLED });
    assert.equal((await f.escrow.read.getDisputeContext([f.id, 1n])).reviewEnd, 0n);
    await viem.assertions.revertWithCustomError(f.escrow.read.getDisputeContext([99n, 0n]), f.escrow, "InvalidInput");
    await viem.assertions.revertWithCustomError(f.escrow.read.getDisputeContext([f.id, 2n]), f.escrow, "InvalidInput");
  });

  it("only allows the authorized contract to freeze, without moving funds", async () => {
    const f = await networkHelpers.loadFixture(submittedFixture);
    const before = await f.escrow.read.projects([f.id]);
    await viem.assertions.emitWithArgs(f.arbitration.write.freeze([f.id, 0n]), f.escrow, "MilestoneFrozen", [f.id, 0n]);
    assert.equal((await f.escrow.read.milestones([f.id, 0n]))[5], Milestone.DISPUTED);
    assert.deepEqual(await f.escrow.read.projects([f.id]), before);
    await assertAccounting(f, [f.id]);
  });

  it("rejects freezing and settlement from every EOA role and an unconfigured contract", async () => {
    const f = await networkHelpers.loadFixture(submittedFixture);
    for (const caller of [f.client, f.freelancer, f.treasury, f.outsider]) {
      await viem.assertions.revertWithCustomError(
        f.escrow.write.freezeMilestone([f.id, 0n], { account: caller.account }), f.escrow, "Unauthorized",
      );
    }
    await viem.assertions.revertWithCustomError(f.rogue.write.freeze([f.id, 0n]), f.escrow, "Unauthorized");
    await f.arbitration.write.freeze([f.id, 0n]);
    for (const caller of [f.client, f.freelancer, f.treasury, f.outsider]) {
      await viem.assertions.revertWithCustomError(
        f.escrow.write.settleDisputedMilestone([f.id, 0n, 5000n], { account: caller.account }), f.escrow, "Unauthorized",
      );
    }
    await viem.assertions.revertWithCustomError(f.rogue.write.settle([f.id, 0n, 5000n]), f.escrow, "Unauthorized");
    assert.equal((await f.escrow.read.getDisputeContext([f.id, 0n])).milestoneState, Milestone.DISPUTED);
    await assertAccounting(f, [f.id]);
  });

  it("rejects freezing nonexistent, unfunded, unaccepted, pending and out-of-order milestones", async () => {
    const f = await networkHelpers.loadFixture(configuredFixture);
    await viem.assertions.revertWithCustomError(f.arbitration.write.freeze([99n, 0n]), f.escrow, "InvalidState");
    const { id } = await createProject(f);
    await viem.assertions.revertWithCustomError(f.arbitration.write.freeze([id, 0n]), f.escrow, "InvalidState");
    await f.token.write.approve([f.escrow.address, 1000n * unit]);
    await f.escrow.write.fundProject([id]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.freeze([id, 0n]), f.escrow, "InvalidState");
    await f.escrow.write.acceptProject([id], { account: f.freelancer.account });
    await viem.assertions.revertWithCustomError(f.arbitration.write.freeze([id, 0n]), f.escrow, "InvalidState");
    await f.escrow.write.submitMilestone([id, 0n, evidence], { account: f.freelancer.account });
    for (const index of [1n, 2n]) {
      await viem.assertions.revertWithCustomError(f.arbitration.write.freeze([id, index]), f.escrow, "InvalidState");
    }
    await f.arbitration.write.freeze([id, 0n]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.freeze([id, 0n]), f.escrow, "InvalidState");
  });

  it("allows freezing exactly at the review deadline", async () => {
    const f = await networkHelpers.loadFixture(submittedFixture);
    const { reviewEnd } = await f.escrow.read.getDisputeContext([f.id, 0n]);
    await networkHelpers.time.setNextBlockTimestamp(reviewEnd);
    await f.arbitration.write.freeze([f.id, 0n]);
    assert.equal((await publicClient.getBlock()).timestamp, reviewEnd);
    assert.equal((await f.escrow.read.getDisputeContext([f.id, 0n])).milestoneState, Milestone.DISPUTED);
  });

  it("rejects freezing after review expiry and preserves the normal release path", async () => {
    const f = await networkHelpers.loadFixture(submittedFixture);
    const { reviewEnd } = await f.escrow.read.getDisputeContext([f.id, 0n]);
    await networkHelpers.time.setNextBlockTimestamp(reviewEnd + 1n);
    await viem.assertions.revertWithCustomError(f.arbitration.write.freeze([f.id, 0n]), f.escrow, "NotReady");
    await f.escrow.write.releaseAfterReviewTimeout([f.id, 0n], { account: f.freelancer.account });
    await viem.assertions.revertWithCustomError(f.arbitration.write.freeze([f.id, 0n]), f.escrow, "InvalidState");
    await assertAccounting(f, [f.id]);
  });

  it("blocks approval, timeout release, refunds and resubmission of a frozen milestone", async () => {
    const f = await networkHelpers.loadFixture(frozenFixture);
    await networkHelpers.time.increaseTo(f.dueDates[0] + 2n * day + 1n);
    const before = await f.escrow.read.projects([f.id]);
    await viem.assertions.revertWithCustomError(f.escrow.write.approveMilestone([f.id, 0n]), f.escrow, "InvalidState");
    await viem.assertions.revertWithCustomError(
      f.escrow.write.releaseAfterReviewTimeout([f.id, 0n], { account: f.freelancer.account }), f.escrow, "InvalidState",
    );
    await viem.assertions.revertWithCustomError(f.escrow.write.refundMissedMilestone([f.id, 0n]), f.escrow, "InvalidState");
    await viem.assertions.revertWithCustomError(f.escrow.write.refundUnaccepted([f.id]), f.escrow, "InvalidState");
    await viem.assertions.revertWithCustomError(
      f.escrow.write.submitMilestone([f.id, 0n, evidence], { account: f.freelancer.account }), f.escrow, "InvalidInput",
    );
    assert.deepEqual(await f.escrow.read.projects([f.id]), before);
    await assertAccounting(f, [f.id]);
    // Review/delivery timeouts cannot unlock a frozen milestone; arbitration still can settle it.
    await f.arbitration.write.settle([f.id, 0n, 5000n]);
    await assertAccounting(f, [f.id]);
  });

  it("requires a frozen current milestone for arbitration settlement", async () => {
    const f = await networkHelpers.loadFixture(configuredFixture);
    await viem.assertions.revertWithCustomError(f.arbitration.write.settle([99n, 0n, 5000n]), f.escrow, "InvalidState");
    const { id } = await createProject(f);
    await viem.assertions.revertWithCustomError(f.arbitration.write.settle([id, 0n, 5000n]), f.escrow, "InvalidState");
    await fundAndAccept(f, id);
    await viem.assertions.revertWithCustomError(f.arbitration.write.settle([id, 0n, 5000n]), f.escrow, "InvalidState");
    await f.escrow.write.submitMilestone([id, 0n, evidence], { account: f.freelancer.account });
    await viem.assertions.revertWithCustomError(f.arbitration.write.settle([id, 0n, 5000n]), f.escrow, "InvalidState");
    await f.arbitration.write.freeze([id, 0n]);
    for (const index of [1n, 2n]) {
      await viem.assertions.revertWithCustomError(f.arbitration.write.settle([id, index, 5000n]), f.escrow, "InvalidState");
    }
    await assertAccounting(f, [id]);
  });

  it("rejects allocations above 10,000 without consuming or changing the milestone", async () => {
    const f = await networkHelpers.loadFixture(frozenFixture);
    const before = await f.escrow.read.projects([f.id]);
    for (const bps of [10_001n, 2n ** 256n - 1n]) {
      await viem.assertions.revertWithCustomError(f.arbitration.write.settle([f.id, 0n, bps]), f.escrow, "InvalidInput");
    }
    assert.deepEqual(await f.escrow.read.projects([f.id]), before);
    assert.equal((await f.escrow.read.getDisputeContext([f.id, 0n])).milestoneState, Milestone.DISPUTED);
    await assertAccounting(f, [f.id]);
    await f.arbitration.write.settle([f.id, 0n, 5000n]);
    await assertAccounting(f, [f.id]);
  });

  const allocations = [
    // All values are six-decimal token base units; expected payouts are independent examples.
    { bps: 0n, net: 0n, refund: 400_000_000n, fee: 0n },
    { bps: 1n, net: 39_600n, refund: 399_960_000n, fee: 400n },
    { bps: 3333n, net: 131_986_800n, refund: 266_680_000n, fee: 1_333_200n },
    { bps: 5000n, net: 198_000_000n, refund: 200_000_000n, fee: 2_000_000n },
    { bps: 9999n, net: 395_960_400n, refund: 40_000n, fee: 3_999_600n },
    { bps: 10_000n, net: 396_000_000n, refund: 0n, fee: 4_000_000n },
  ];
  for (const { bps, net, refund, fee } of allocations) {
    it(`settles ${bps} freelancer bps with correct client refund, 1% fee and accounting`, async () => {
      const f = await networkHelpers.loadFixture(frozenFixture);
      const clientBefore = await f.token.read.balanceOf([f.client.account.address]);
      const tx = await f.arbitration.write.settle([f.id, 0n, bps]);
      await viem.assertions.emitWithArgs(tx, f.escrow, "DisputedMilestoneSettled", [f.id, 0n, bps]);
      await viem.assertions.emitWithArgs(tx, f.escrow, "MilestoneSettled", [f.id, 0n, 400n * unit, net + fee, net, refund, fee]);
      assert.equal(await f.token.read.balanceOf([f.freelancer.account.address]), net);
      assert.equal(await f.token.read.balanceOf([f.client.account.address]), clientBefore + refund);
      assert.equal(await f.token.read.balanceOf([f.treasury.account.address]), fee);
      assert.equal(net + refund + fee, 400n * unit);
      const project = await f.escrow.read.projects([f.id]);
      assert.equal(project[4], 600n * unit);
      assert.equal(project[7], 1);
      assert.equal(project[9], Project.ACTIVE);
      assert.equal((await f.escrow.read.getDisputeContext([f.id, 0n])).milestoneState, Milestone.SETTLED);
      await assertAccounting(f, [f.id]);
    });
  }

  for (const { amount, bps, net, refund, fee } of [
    { amount: 10_001n, bps: 3333n, net: 3300n, refund: 6668n, fee: 33n },
    { amount: 1n, bps: 5000n, net: 0n, refund: 1n, fee: 0n },
    { amount: 1n, bps: 10_000n, net: 1n, refund: 0n, fee: 0n },
    { amount: 101n, bps: 10_000n, net: 100n, refund: 0n, fee: 1n },
  ]) {
    it(`conserves rounding dust for ${amount} base units at ${bps} bps`, async () => {
      const f = await networkHelpers.loadFixture(configuredFixture);
      const { id } = await createProject(f, [amount]);
      await fundAndAccept(f, id);
      await f.escrow.write.submitMilestone([id, 0n, evidence], { account: f.freelancer.account });
      await f.arbitration.write.freeze([id, 0n]);
      const clientBefore = await f.token.read.balanceOf([f.client.account.address]);
      await f.arbitration.write.settle([id, 0n, bps]);
      assert.equal(await f.token.read.balanceOf([f.freelancer.account.address]), net);
      assert.equal(await f.token.read.balanceOf([f.client.account.address]), clientBefore + refund);
      assert.equal(await f.token.read.balanceOf([f.treasury.account.address]), fee);
      assert.equal(net + refund + fee, amount);
      assert.equal((await f.escrow.read.projects([id]))[9], Project.COMPLETED);
      await assertAccounting(f, [id]);
    });
  }

  it("prevents replay while the next milestone is frozen and after project completion", async () => {
    const f = await networkHelpers.loadFixture(frozenFixture);
    await f.arbitration.write.settle([f.id, 0n, 5000n]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.settle([f.id, 0n, 5000n]), f.escrow, "InvalidState");
    await viem.assertions.revertWithCustomError(f.escrow.write.approveMilestone([f.id, 0n]), f.escrow, "InvalidState");
    await f.escrow.write.submitMilestone([f.id, 1n, evidence], { account: f.freelancer.account });
    await f.arbitration.write.freeze([f.id, 1n]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.settle([f.id, 0n, 10_000n]), f.escrow, "InvalidState");
    await f.arbitration.write.settle([f.id, 1n, 10_000n]);
    const balances = await Promise.all([f.client, f.freelancer, f.treasury].map(w => f.token.read.balanceOf([w.account.address])));
    await viem.assertions.revertWithCustomError(f.arbitration.write.settle([f.id, 1n, 0n]), f.escrow, "InvalidState");
    await viem.assertions.revertWithCustomError(f.arbitration.write.freeze([f.id, 1n]), f.escrow, "InvalidState");
    assert.deepEqual(await Promise.all([f.client, f.freelancer, f.treasury].map(w => f.token.read.balanceOf([w.account.address]))), balances);
    assert.equal((await f.escrow.read.projects([f.id]))[9], Project.COMPLETED);
    await assertAccounting(f, [f.id]);
  });

  it("isolates independent projects, remaining milestones and unrelated surplus tokens", async () => {
    const f = await networkHelpers.loadFixture(frozenFixture);
    await f.token.write.transfer([f.secondClient.account.address, 700n * unit]);
    const other = await createProject(f, [300n * unit, 400n * unit], f.secondClient, f.secondFreelancer);
    await fundAndAccept(f, other.id, f.secondClient, f.secondFreelancer);
    await f.token.write.transfer([f.escrow.address, 7n]);
    await assertAccounting(f, [f.id, other.id], 7n);
    const otherBefore = await f.escrow.read.projects([other.id]);
    await f.arbitration.write.settle([f.id, 0n, 5000n]);
    assert.deepEqual(await f.escrow.read.projects([other.id]), otherBefore);
    assert.equal(await f.token.read.balanceOf([f.secondFreelancer.account.address]), 0n);
    await assertAccounting(f, [f.id, other.id], 7n);
    await f.escrow.write.submitMilestone([other.id, 0n, evidence], { account: f.secondFreelancer.account });
    const firstBefore = await f.escrow.read.projects([f.id]);
    await f.escrow.write.approveMilestone([other.id, 0n], { account: f.secondClient.account });
    assert.deepEqual(await f.escrow.read.projects([f.id]), firstBefore);
    await assertAccounting(f, [f.id, other.id], 7n);
    await f.escrow.write.submitMilestone([other.id, 1n, evidence], { account: f.secondFreelancer.account });
    await f.arbitration.write.freeze([other.id, 1n]);
    await f.arbitration.write.settle([other.id, 1n, 0n]);
    assert.equal(await f.token.read.balanceOf([f.secondClient.account.address]), 400n * unit);
    assert.equal(await f.token.read.balanceOf([f.secondFreelancer.account.address]), 297n * unit);
    assert.equal((await f.escrow.read.projects([other.id]))[9], Project.COMPLETED);
    await assertAccounting(f, [f.id, other.id], 7n);
    await f.escrow.write.submitMilestone([f.id, 1n, evidence], { account: f.freelancer.account });
    await f.escrow.write.approveMilestone([f.id, 1n]);
    assert.equal(await f.token.read.balanceOf([f.freelancer.account.address]), 792n * unit);
    assert.equal(await f.token.read.balanceOf([f.treasury.account.address]), 11n * unit);
    await assertAccounting(f, [f.id, other.id], 7n);
    assert.equal(await f.escrow.read.totalEscrowLiability(), 0n);
  });

  it("cannot arbitrate a milestone already settled normally", async () => {
    const f = await networkHelpers.loadFixture(submittedFixture);
    await f.escrow.write.approveMilestone([f.id, 0n]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.freeze([f.id, 0n]), f.escrow, "InvalidState");
    await viem.assertions.revertWithCustomError(f.arbitration.write.settle([f.id, 0n, 10_000n]), f.escrow, "InvalidState");
    await assertAccounting(f, [f.id]);
  });

  it("preserves the unaccepted-project refund with arbitration configured", async () => {
    const f = await networkHelpers.loadFixture(configuredFixture);
    const { id } = await createProject(f, [100n * unit]);
    await f.token.write.approve([f.escrow.address, 100n * unit]);
    await f.escrow.write.fundProject([id]);
    const acceptBy = (await f.escrow.read.projects([id]))[5];
    await networkHelpers.time.setNextBlockTimestamp(acceptBy);
    await viem.assertions.revertWithCustomError(f.escrow.write.refundUnaccepted([id]), f.escrow, "NotReady");
    await networkHelpers.time.setNextBlockTimestamp(acceptBy + 1n);
    await f.escrow.write.refundUnaccepted([id]);
    assert.equal((await f.escrow.read.projects([id]))[9], Project.CLOSED);
    assert.equal(await f.token.read.balanceOf([f.client.account.address]), 1_000_000n * unit);
    await viem.assertions.revertWithCustomError(f.arbitration.write.freeze([id, 0n]), f.escrow, "InvalidState");
    await assertAccounting(f, [id]);
  });

  it("preserves missed-delivery refunds and their deadline with arbitration configured", async () => {
    const f = await networkHelpers.loadFixture(configuredFixture);
    const { id, dueDates } = await createProject(f, [100n * unit]);
    await fundAndAccept(f, id);
    await networkHelpers.time.setNextBlockTimestamp(dueDates[0] + 2n * day);
    await viem.assertions.revertWithCustomError(f.escrow.write.refundMissedMilestone([id, 0n]), f.escrow, "NotReady");
    await networkHelpers.time.setNextBlockTimestamp(dueDates[0] + 2n * day + 1n);
    await f.escrow.write.refundMissedMilestone([id, 0n]);
    assert.equal((await f.escrow.read.projects([id]))[9], Project.COMPLETED);
    assert.equal(await f.token.read.balanceOf([f.client.account.address]), 1_000_000n * unit);
    await viem.assertions.revertWithCustomError(f.arbitration.write.settle([id, 0n, 5000n]), f.escrow, "InvalidState");
    await assertAccounting(f, [id]);
  });

  it("preserves the exact review timeout boundary for non-disputed milestones", async () => {
    const f = await networkHelpers.loadFixture(submittedFixture);
    const { reviewEnd } = await f.escrow.read.getDisputeContext([f.id, 0n]);
    await networkHelpers.time.setNextBlockTimestamp(reviewEnd);
    await viem.assertions.revertWithCustomError(
      f.escrow.write.releaseAfterReviewTimeout([f.id, 0n], { account: f.freelancer.account }), f.escrow, "NotReady",
    );
    await networkHelpers.time.setNextBlockTimestamp(reviewEnd + 1n);
    await f.escrow.write.releaseAfterReviewTimeout([f.id, 0n], { account: f.freelancer.account });
    assert.equal(await f.token.read.balanceOf([f.freelancer.account.address]), 396n * unit);
    assert.equal(await f.token.read.balanceOf([f.treasury.account.address]), 4n * unit);
    await assertAccounting(f, [f.id]);
  });
});
