import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { encodeFunctionData, getAddress, maxUint256, zeroAddress, type Address } from "viem";
import phase2C from "../ignition/modules/Phase2C.js";

const unit = 10n ** 6n;
const fee = 15n * unit;
const minimum = 100n * unit;
const hour = 3600n;
const evidence = `0x${"44".repeat(32)}` as `0x${string}`;
const response = `0x${"55".repeat(32)}` as `0x${string}`;
const zeroHash = `0x${"00".repeat(32)}` as `0x${string}`;
const Vote = { NONE: 0, FREELANCER: 1, CLIENT: 2, SPLIT: 3 } as const;
type Ballot = 0 | 1 | 2 | 3;
const Status = { OPEN: 1, FINALIZED: 2 };
const Milestone = { PENDING: 0, SUBMITTED: 1, DISPUTED: 2, SETTLED: 3 };

describe("TrustLayer Phase 2C dispute resolution", async () => {
  const { viem, networkHelpers, ignition } = await network.create();
  const publicClient = await viem.getPublicClient();
  const wallets = await viem.getWalletClients();

  async function deployFixture(testToken = false, releaseHarness = false) {
    const [client, freelancer, treasury, outsider, secondClient, secondFreelancer, ...jurors] = wallets;
    const deployedToken = testToken
      ? await viem.deployContract("RegistryTestToken", [client.account.address, 6])
      : await viem.deployContract("MockUSD", [client.account.address]);
    // Both tokens implement this ERC-20 ABI. Bind one stable type; obtain adversarial controls separately.
    const token = await viem.getContractAt("MockUSD", deployedToken.address);
    const escrow = await viem.deployContract("TrustEscrow", [token.address, treasury.account.address]);
    const registry = await viem.deployContract("JurorRegistry", [token.address]);
    const harness = releaseHarness ? await viem.deployContract("DisputeRegistryHarness", [registry.address]) : undefined;
    const arbitration = await viem.deployContract("DisputeArbitration", [escrow.address, harness?.address ?? registry.address]);
    return { client, freelancer, treasury, outsider, secondClient, secondFreelancer, jurors, token, escrow, registry, arbitration, harness };
  }

  type Fixture = Awaited<ReturnType<typeof deployFixture>>;
  type Wallet = Fixture["client"];
  const addressOf = (wallet: Wallet) => getAddress(wallet.account.address);

  async function baseFixture() { return deployFixture(); }

  async function configure(f: Fixture) {
    await f.escrow.write.setArbitrationContract([f.arbitration.address]);
    if (f.harness) {
      await f.registry.write.setArbitrationContract([f.harness.address]);
      await f.harness.write.setArbitrationContract([f.arbitration.address]);
    } else await f.registry.write.setArbitrationContract([f.arbitration.address]);
  }

  async function enroll(f: Fixture, wallet: Wallet, stake = 200n * unit) {
    // The initial client already owns token supply; every other wallet needs funding.
    if (wallet.account.address !== f.client.account.address) await f.token.write.transfer([wallet.account.address, 1000n * unit]);
    await f.registry.write.registerJuror({ account: wallet.account });
    await f.token.write.approve([f.registry.address, maxUint256], { account: wallet.account });
    await f.registry.write.depositStake([stake], { account: wallet.account });
  }

  async function configureAndEnroll(f: Fixture, count = 6) {
    await configure(f);
    for (const juror of f.jurors.slice(0, count)) await enroll(f, juror);
    await f.token.write.transfer([f.freelancer.account.address, 100n * unit]);
    return f;
  }

  async function configuredFixture() { return configureAndEnroll(await baseFixture()); }

  async function createProject(f: Fixture, amounts = [400n * unit, 600n * unit], client = f.client, freelancer = f.freelancer) {
    const id = await f.escrow.read.nextProjectId();
    const now = (await publicClient.getBlock()).timestamp;
    const dueDates = amounts.map((_, i) => now + BigInt(14 + i * 7) * 24n * hour);
    await f.escrow.write.createProject([freelancer.account.address, amounts, dueDates, evidence], { account: client.account });
    return id;
  }

  async function fundAndSubmit(f: Fixture, id: bigint, client = f.client, freelancer = f.freelancer) {
    const project = await f.escrow.read.projects([id]);
    await f.token.write.approve([f.escrow.address, project[3]], { account: client.account });
    await f.escrow.write.fundProject([id], { account: client.account });
    await f.escrow.write.acceptProject([id], { account: freelancer.account });
    await f.escrow.write.submitMilestone([id, 0n, evidence], { account: freelancer.account });
  }

  async function submittedFixture() {
    const f = await configuredFixture();
    const id = await createProject(f);
    await fundAndSubmit(f, id);
    return { ...f, id };
  }

  async function open(f: Fixture, projectId = 0n, index = 0n, opener = f.client) {
    await f.token.write.approve([f.arbitration.address, fee], { account: opener.account });
    return f.arbitration.write.openDispute([projectId, index, evidence], { account: opener.account });
  }

  async function openedFixture() {
    const f = await submittedFixture();
    await open(f);
    return f;
  }

  async function selectedWallets(f: Fixture, id = 0n) {
    const dispute = await f.arbitration.read.getDispute([id]);
    return dispute.jurors.map(address => {
      const wallet = wallets.find(w => addressOf(w) === address);
      assert.ok(wallet);
      return wallet;
    });
  }

  async function vote(f: Fixture, ballots: Ballot[], id = 0n) {
    const dispute = await f.arbitration.read.getDispute([id]);
    await networkHelpers.time.increaseTo(dispute.responseDeadline);
    const selected = await selectedWallets(f, id);
    for (let i = 0; i < ballots.length; ++i) {
      if (ballots[i] !== Vote.NONE) await f.arbitration.write.castVote([id, ballots[i]], { account: selected[i].account });
    }
  }

  async function finish(f: Fixture, id = 0n) {
    const dispute = await f.arbitration.read.getDispute([id]);
    await networkHelpers.time.increaseTo(dispute.votingDeadline + 1n);
    return f.arbitration.write.finalizeDispute([id], { account: f.outsider.account });
  }

  async function assertAccounting(f: Fixture, projectIds = [0n], feeSurplus = 0n) {
    let escrowLiability = 0n;
    for (const id of projectIds) escrowLiability += (await f.escrow.read.projects([id]))[4];
    assert.equal(await f.escrow.read.totalEscrowLiability(), escrowLiability);
    assert.equal(await f.token.read.balanceOf([f.escrow.address]), escrowLiability);
    let stake = 0n;
    let locked = 0n;
    const count = await f.registry.read.registeredJurorCount();
    for (let i = 0n; i < count; ++i) {
      const juror = await f.registry.read.registeredJurors([i]);
      const info = await f.registry.read.getJurorInfo([juror]);
      assert.equal(info.depositedStake, info.lockedStake + info.availableStake);
      assert.equal(info.lockedStake, minimum * info.activeAssignments);
      stake += info.depositedStake;
      locked += info.lockedStake;
    }
    assert.equal(await f.registry.read.totalStaked(), stake);
    assert.equal(await f.registry.read.totalLockedStake(), locked);
    assert.equal(await f.token.read.balanceOf([f.registry.address]), stake);
    const fees = await f.arbitration.read.totalDisputeFeesHeld();
    assert.equal(await f.token.read.balanceOf([f.arbitration.address]), fees + feeSurplus);
    assert.equal(fees, await f.arbitration.read.pendingJurorFees() + await f.arbitration.read.pendingProtocolFees());
    assert.equal(fees, await f.arbitration.read.nextDisputeId() * fee);
    const holders = new Set<Address>([...wallets.map(addressOf), f.escrow.address, f.registry.address, f.arbitration.address]);
    const balances = await Promise.all([...holders].map(address => f.token.read.balanceOf([address])));
    assert.equal(balances.reduce((total, balance) => total + balance, 0n), await f.token.read.totalSupply());
  }

  it("binds matching token custody and requires both existing one-time authorizations", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    assert.equal(await f.arbitration.read.paymentToken(), getAddress(f.token.address));
    assert.equal(await f.arbitration.read.isConfigured(), false);
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([0n, 0n, evidence]), f.arbitration, "InvalidConfiguration");
    await f.escrow.write.setArbitrationContract([f.arbitration.address]);
    assert.equal(await f.arbitration.read.isConfigured(), false);
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([0n, 0n, evidence]), f.arbitration, "InvalidConfiguration");
    await f.registry.write.setArbitrationContract([f.arbitration.address]);
    assert.equal(await f.arbitration.read.isConfigured(), true);
    await viem.assertions.revertWithCustomError(f.registry.write.setArbitrationContract([f.arbitration.address]), f.registry, "InvalidState");
    await viem.assertions.revertWithCustomError(f.escrow.write.setArbitrationContract([f.arbitration.address]), f.escrow, "InvalidState");
  });

  it("rejects invalid dependencies, mismatched tokens and already configured collaborators", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    for (const [escrow, registry] of [[zeroAddress, f.registry.address], [f.escrow.address, f.outsider.account.address], [f.escrow.address, f.escrow.address]] as const) {
      await viem.assertions.revertWithCustomError(viem.deployContract("DisputeArbitration", [escrow, registry]), f.arbitration, "InvalidInput");
    }
    const otherToken = await viem.deployContract("MockUSD", [f.client.account.address]);
    const otherRegistry = await viem.deployContract("JurorRegistry", [otherToken.address]);
    await viem.assertions.revertWithCustomError(viem.deployContract("DisputeArbitration", [f.escrow.address, otherRegistry.address]), f.arbitration, "InvalidConfiguration");
    await f.registry.write.setArbitrationContract([f.arbitration.address]);
    await viem.assertions.revertWithCustomError(viem.deployContract("DisputeArbitration", [f.escrow.address, f.registry.address]), f.arbitration, "InvalidConfiguration");
  });

  it("opens a dispute, records deadlines and evidence, collects the fee and locks three distinct jurors", async () => {
    const f = await networkHelpers.loadFixture(submittedFixture);
    const before = await f.token.read.balanceOf([f.client.account.address]);
    const tx = await open(f);
    const dispute = await f.arbitration.read.getDispute([0n]);
    assert.equal(dispute.projectId, f.id);
    assert.equal(dispute.milestoneIndex, 0n);
    assert.equal(dispute.milestoneAmount, 400n * unit);
    assert.equal(dispute.client, addressOf(f.client));
    assert.equal(dispute.freelancer, addressOf(f.freelancer));
    assert.equal(dispute.opener, addressOf(f.client));
    assert.equal(dispute.status, Status.OPEN);
    assert.equal(dispute.evidenceHash, evidence);
    assert.equal(dispute.responseDeadline, dispute.openedAt + 12n * hour);
    assert.equal(dispute.votingDeadline, dispute.responseDeadline + 24n * hour);
    assert.equal(new Set(dispute.jurors).size, 3);
    assert.deepEqual(dispute.jurors, f.jurors.slice(0, 3).map(addressOf));
    assert.equal((await f.escrow.read.getDisputeContext([0n, 0n])).milestoneState, Milestone.DISPUTED);
    assert.deepEqual(await f.arbitration.read.getMilestoneDispute([0n, 0n]), [true, 0n]);
    assert.equal(await f.token.read.balanceOf([f.client.account.address]), before - fee);
    assert.equal(await f.arbitration.read.pendingJurorFees(), 12n * unit);
    assert.equal(await f.arbitration.read.pendingProtocolFees(), 3n * unit);
    assert.equal(await f.registry.read.totalLockedStake(), 300n * unit);
    for (const juror of dispute.jurors) assert.deepEqual(await f.registry.read.getActiveDisputes([juror]), [0n]);
    await viem.assertions.emitWithArgs(tx, f.arbitration, "DisputeOpened", [0n, 0n, 0n, addressOf(f.client), evidence, dispute.responseDeadline, dispute.votingDeadline]);
    await viem.assertions.emitWithArgs(tx, f.arbitration, "DisputeFeeCollected", [0n, addressOf(f.client), fee]);
    await assertAccounting(f);
  });

  it("allows the freelancer to open and charges that opener rather than the other participant", async () => {
    const f = await networkHelpers.loadFixture(submittedFixture);
    const clientBefore = await f.token.read.balanceOf([f.client.account.address]);
    const freelancerBefore = await f.token.read.balanceOf([f.freelancer.account.address]);
    await open(f, 0n, 0n, f.freelancer);
    assert.equal((await f.arbitration.read.getDispute([0n])).opener, addressOf(f.freelancer));
    assert.equal(await f.token.read.balanceOf([f.client.account.address]), clientBefore);
    assert.equal(await f.token.read.balanceOf([f.freelancer.account.address]), freelancerBefore - fee);
    await f.arbitration.write.respondToDispute([0n, response]);
    await assertAccounting(f);
  });

  it("rejects nonparticipants, empty evidence, nonexistent and out-of-range milestones", async () => {
    const f = await networkHelpers.loadFixture(submittedFixture);
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([0n, 0n, evidence], { account: f.outsider.account }), f.arbitration, "Unauthorized");
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([0n, 0n, zeroHash]), f.arbitration, "InvalidInput");
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([99n, 0n, evidence]), f.escrow, "InvalidInput");
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([0n, 2n, evidence]), f.escrow, "InvalidInput");
    await assertAccounting(f);
  });

  it("rejects unfunded, unaccepted, pending, future and already settled milestones", async () => {
    const f = await networkHelpers.loadFixture(configuredFixture);
    const id = await createProject(f);
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([id, 0n, evidence]), f.arbitration, "InvalidState");
    await f.token.write.approve([f.escrow.address, 1000n * unit]);
    await f.escrow.write.fundProject([id]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([id, 0n, evidence]), f.arbitration, "InvalidState");
    await f.escrow.write.acceptProject([id], { account: f.freelancer.account });
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([id, 0n, evidence]), f.arbitration, "InvalidState");
    await f.escrow.write.submitMilestone([id, 0n, evidence], { account: f.freelancer.account });
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([id, 1n, evidence]), f.arbitration, "InvalidState");
    await f.escrow.write.approveMilestone([id, 0n]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([id, 0n, evidence]), f.arbitration, "InvalidState");
    await assertAccounting(f);
  });

  it("allows dispute opening exactly at the review deadline", async () => {
    const f = await networkHelpers.loadFixture(submittedFixture);
    await f.token.write.approve([f.arbitration.address, fee]);
    const { reviewEnd } = await f.escrow.read.getDisputeContext([0n, 0n]);
    await networkHelpers.time.setNextBlockTimestamp(reviewEnd);
    await f.arbitration.write.openDispute([0n, 0n, evidence]);
    assert.equal((await f.arbitration.read.getDispute([0n])).openedAt, reviewEnd);
    await assertAccounting(f);
  });

  it("rejects dispute opening one second after review expiry", async () => {
    const f = await networkHelpers.loadFixture(submittedFixture);
    await f.token.write.approve([f.arbitration.address, fee]);
    const { reviewEnd } = await f.escrow.read.getDisputeContext([0n, 0n]);
    await networkHelpers.time.setNextBlockTimestamp(reviewEnd + 1n);
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([0n, 0n, evidence]), f.arbitration, "NotReady");
    assert.deepEqual(await f.arbitration.read.getMilestoneDispute([0n, 0n]), [false, 0n]);
    await f.escrow.write.releaseAfterReviewTimeout([0n, 0n], { account: f.freelancer.account });
    await assertAccounting(f);
  });

  it("rejects duplicate disputes from either party before and after finalization", async () => {
    const f = await networkHelpers.loadFixture(openedFixture);
    for (const party of [f.client, f.freelancer]) await viem.assertions.revertWithCustomError(
      f.arbitration.write.openDispute([0n, 0n, evidence], { account: party.account }), f.arbitration, "InvalidState",
    );
    await finish(f);
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([0n, 0n, evidence]), f.arbitration, "InvalidState");
    assert.equal(await f.arbitration.read.nextDisputeId(), 1n);
    await assertAccounting(f);
  });

  it("rolls back fee, allowance, freeze, IDs and locks when fewer than three jurors qualify", async () => {
    const f = await configureAndEnroll(await baseFixture(), 2);
    await createProject(f);
    await fundAndSubmit(f, 0n);
    await f.token.write.approve([f.arbitration.address, fee]);
    const before = await f.token.read.balanceOf([f.client.account.address]);
    const pool = await f.registry.read.getAvailableJurors();
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([0n, 0n, evidence]), f.registry, "InsufficientEligibleJurors");
    assert.equal(await f.token.read.balanceOf([f.client.account.address]), before);
    assert.equal(await f.token.read.allowance([f.client.account.address, f.arbitration.address]), fee);
    assert.equal((await f.escrow.read.getDisputeContext([0n, 0n])).milestoneState, Milestone.SUBMITTED);
    assert.equal(await f.arbitration.read.nextDisputeId(), 0n);
    assert.deepEqual(await f.arbitration.read.getMilestoneDispute([0n, 0n]), [false, 0n]);
    assert.deepEqual(await f.registry.read.getAvailableJurors(), pool);
    assert.equal((await f.registry.read.getAssignment([0n])).state, 0);
    await assertAccounting(f);
    await enroll(f, f.jurors[2]);
    await f.arbitration.write.openDispute([0n, 0n, evidence]);
    await assertAccounting(f);
  });

  it("never selects a staked participant as a juror", async () => {
    const f = await baseFixture();
    await configure(f);
    await enroll(f, f.client);
    await enroll(f, f.freelancer);
    for (const juror of f.jurors.slice(0, 3)) await enroll(f, juror);
    await createProject(f);
    await fundAndSubmit(f, 0n);
    await open(f);
    const dispute = await f.arbitration.read.getDispute([0n]);
    assert.deepEqual(dispute.jurors, f.jurors.slice(0, 3).map(addressOf));
    assert.equal((await f.registry.read.getJurorInfo([f.client.account.address])).lockedStake, 0n);
    assert.equal((await f.registry.read.getJurorInfo([f.freelancer.account.address])).lockedStake, 0n);
    await assertAccounting(f);
  });

  it("requires the opener's allowance and actual fee balance without consuming the case", async () => {
    const f = await networkHelpers.loadFixture(submittedFixture);
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([0n, 0n, evidence]), f.token, "ERC20InsufficientAllowance");
    await f.token.write.transfer([f.client.account.address, 100n * unit], { account: f.freelancer.account });
    await f.token.write.approve([f.arbitration.address, fee], { account: f.freelancer.account });
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([0n, 0n, evidence], { account: f.freelancer.account }), f.token, "ERC20InsufficientBalance");
    assert.equal((await f.escrow.read.getDisputeContext([0n, 0n])).milestoneState, Milestone.SUBMITTED);
    assert.equal(await f.arbitration.read.nextDisputeId(), 0n);
    await assertAccounting(f);
  });

  it("accepts one counterparty response hash and rejects opener, outsiders, empty or repeated responses", async () => {
    const f = await networkHelpers.loadFixture(openedFixture);
    for (const caller of [f.client, f.outsider, f.jurors[0]]) await viem.assertions.revertWithCustomError(
      f.arbitration.write.respondToDispute([0n, response], { account: caller.account }), f.arbitration, "Unauthorized",
    );
    await viem.assertions.revertWithCustomError(f.arbitration.write.respondToDispute([0n, zeroHash], { account: f.freelancer.account }), f.arbitration, "InvalidInput");
    await viem.assertions.emitWithArgs(
      f.arbitration.write.respondToDispute([0n, response], { account: f.freelancer.account }), f.arbitration, "DisputeResponded", [0n, addressOf(f.freelancer), response],
    );
    await viem.assertions.revertWithCustomError(f.arbitration.write.respondToDispute([0n, evidence], { account: f.freelancer.account }), f.arbitration, "InvalidState");
    assert.equal((await f.arbitration.read.getDispute([0n])).responseHash, response);
  });

  it("accepts a response one second before its deadline without shortening the voting delay", async () => {
    const f = await networkHelpers.loadFixture(openedFixture);
    const dispute = await f.arbitration.read.getDispute([0n]);
    await networkHelpers.time.setNextBlockTimestamp(dispute.responseDeadline - 1n);
    await f.arbitration.write.respondToDispute([0n, response], { account: f.freelancer.account });
    assert.equal((await publicClient.getBlock()).timestamp, dispute.responseDeadline - 1n);
    assert.equal((await f.arbitration.read.getDispute([0n])).votingDeadline, dispute.votingDeadline);
  });

  it("rejects response hashes at and after the response deadline", async () => {
    const f = await networkHelpers.loadFixture(openedFixture);
    const { responseDeadline } = await f.arbitration.read.getDispute([0n]);
    await networkHelpers.time.setNextBlockTimestamp(responseDeadline);
    await viem.assertions.revertWithCustomError(f.arbitration.write.respondToDispute([0n, response], { account: f.freelancer.account }), f.arbitration, "NotReady");
    await networkHelpers.time.setNextBlockTimestamp(responseDeadline + 1n);
    await viem.assertions.revertWithCustomError(f.arbitration.write.respondToDispute([0n, response], { account: f.freelancer.account }), f.arbitration, "NotReady");
  });

  it("rejects votes before the response deadline and accepts votes at and just after it", async () => {
    const f = await networkHelpers.loadFixture(openedFixture);
    const dispute = await f.arbitration.read.getDispute([0n]);
    const selected = await selectedWallets(f);
    await networkHelpers.time.setNextBlockTimestamp(dispute.responseDeadline - 1n);
    await viem.assertions.revertWithCustomError(f.arbitration.write.castVote([0n, Vote.FREELANCER], { account: selected[0].account }), f.arbitration, "NotReady");
    await networkHelpers.time.setNextBlockTimestamp(dispute.responseDeadline);
    await f.arbitration.write.castVote([0n, Vote.FREELANCER], { account: selected[0].account });
    assert.equal((await publicClient.getBlock()).timestamp, dispute.responseDeadline);
    await networkHelpers.time.setNextBlockTimestamp(dispute.responseDeadline + 1n);
    await f.arbitration.write.castVote([0n, Vote.CLIENT], { account: selected[1].account });
    assert.equal((await publicClient.getBlock()).timestamp, dispute.responseDeadline + 1n);
  });

  it("accepts votes just before and exactly at votingDeadline but rejects one second afterward", async () => {
    const f = await networkHelpers.loadFixture(openedFixture);
    const { votingDeadline } = await f.arbitration.read.getDispute([0n]);
    const selected = await selectedWallets(f);
    await networkHelpers.time.setNextBlockTimestamp(votingDeadline - 1n);
    await f.arbitration.write.castVote([0n, Vote.CLIENT], { account: selected[0].account });
    await networkHelpers.time.setNextBlockTimestamp(votingDeadline);
    await f.arbitration.write.castVote([0n, Vote.CLIENT], { account: selected[1].account });
    await networkHelpers.time.setNextBlockTimestamp(votingDeadline + 1n);
    await viem.assertions.revertWithCustomError(f.arbitration.write.castVote([0n, Vote.CLIENT], { account: selected[2].account }), f.arbitration, "NotReady");
    assert.equal(await f.arbitration.read.votes([0n, selected[2].account.address]), Vote.NONE);
  });

  it("only accepts one nonempty vote from each assigned juror and emits its on-chain record", async () => {
    const f = await networkHelpers.loadFixture(openedFixture);
    const { responseDeadline } = await f.arbitration.read.getDispute([0n]);
    await networkHelpers.time.increaseTo(responseDeadline);
    for (const caller of [f.client, f.freelancer, f.outsider, f.jurors[5]]) await viem.assertions.revertWithCustomError(
      f.arbitration.write.castVote([0n, Vote.FREELANCER], { account: caller.account }), f.arbitration, "Unauthorized",
    );
    const selected = await selectedWallets(f);
    await viem.assertions.revertWithCustomError(f.arbitration.write.castVote([0n, Vote.NONE], { account: selected[0].account }), f.arbitration, "InvalidInput");
    await viem.assertions.revert(f.arbitration.write.castVote([0n, 4 as Ballot], { account: selected[0].account }));
    await viem.assertions.emitWithArgs(
      f.arbitration.write.castVote([0n, Vote.FREELANCER], { account: selected[0].account }), f.arbitration, "VoteCast", [0n, addressOf(selected[0]), Vote.FREELANCER],
    );
    await viem.assertions.revertWithCustomError(f.arbitration.write.castVote([0n, Vote.CLIENT], { account: selected[0].account }), f.arbitration, "InvalidState");
    assert.equal(await f.arbitration.read.votes([0n, selected[0].account.address]), Vote.FREELANCER);
    assert.equal((await f.arbitration.read.getDispute([0n])).freelancerVotes, 1);
  });

  it("rejects voting, responses and finalization on nonexistent cases", async () => {
    const f = await networkHelpers.loadFixture(openedFixture);
    await viem.assertions.revertWithCustomError(f.arbitration.write.castVote([99n, Vote.SPLIT], { account: f.jurors[0].account }), f.arbitration, "InvalidState");
    await viem.assertions.revertWithCustomError(f.arbitration.write.respondToDispute([99n, response], { account: f.freelancer.account }), f.arbitration, "InvalidState");
    await viem.assertions.revertWithCustomError(f.arbitration.write.finalizeDispute([99n]), f.arbitration, "InvalidState");
    await viem.assertions.revertWithCustomError(f.arbitration.read.getDispute([99n]), f.arbitration, "InvalidInput");
    await viem.assertions.revertWithCustomError(f.arbitration.read.getVerdict([99n]), f.arbitration, "InvalidInput");
  });

  it("requires the voting deadline to pass even when a majority has already voted", async () => {
    const f = await networkHelpers.loadFixture(openedFixture);
    await vote(f, [Vote.FREELANCER, Vote.FREELANCER]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.finalizeDispute([0n]), f.arbitration, "NotReady");
    await viem.assertions.revertWithCustomError(f.arbitration.read.getVerdict([0n]), f.arbitration, "NotReady");
    const { votingDeadline } = await f.arbitration.read.getDispute([0n]);
    await networkHelpers.time.setNextBlockTimestamp(votingDeadline - 1n);
    await viem.assertions.revertWithCustomError(f.arbitration.write.finalizeDispute([0n]), f.arbitration, "NotReady");
    await networkHelpers.time.setNextBlockTimestamp(votingDeadline);
    await viem.assertions.revertWithCustomError(f.arbitration.write.finalizeDispute([0n]), f.arbitration, "NotReady");
    await networkHelpers.time.setNextBlockTimestamp(votingDeadline + 1n);
    await f.arbitration.write.finalizeDispute([0n], { account: f.outsider.account });
    assert.equal((await f.arbitration.read.getDispute([0n])).finalizedAt, votingDeadline + 1n);
    await assertAccounting(f);
  });

  const outcomes: { name: string; ballots: Ballot[]; ruling: Ballot; bps: number; fallback: boolean; net: bigint; refund: bigint; serviceFee: bigint }[] = [
    { name: "freelancer unanimous", ballots: [1, 1, 1], ruling: 1, bps: 10000, fallback: false, net: 396n, refund: 0n, serviceFee: 4n },
    { name: "client unanimous", ballots: [2, 2, 2], ruling: 2, bps: 0, fallback: false, net: 0n, refund: 400n, serviceFee: 0n },
    { name: "split unanimous", ballots: [3, 3, 3], ruling: 3, bps: 5000, fallback: false, net: 198n, refund: 200n, serviceFee: 2n },
    { name: "freelancer majority with opposing vote", ballots: [2, 1, 1], ruling: 1, bps: 10000, fallback: false, net: 396n, refund: 0n, serviceFee: 4n },
    { name: "client majority with opposing vote", ballots: [2, 1, 2], ruling: 2, bps: 0, fallback: false, net: 0n, refund: 400n, serviceFee: 0n },
    { name: "split majority with opposing vote", ballots: [3, 1, 3], ruling: 3, bps: 5000, fallback: false, net: 198n, refund: 200n, serviceFee: 2n },
    { name: "two freelancer votes and one abstention", ballots: [1, 1, 0], ruling: 1, bps: 10000, fallback: false, net: 396n, refund: 0n, serviceFee: 4n },
    { name: "two client votes and one abstention", ballots: [2, 0, 2], ruling: 2, bps: 0, fallback: false, net: 0n, refund: 400n, serviceFee: 0n },
    { name: "two split votes and one abstention", ballots: [0, 3, 3], ruling: 3, bps: 5000, fallback: false, net: 198n, refund: 200n, serviceFee: 2n },
    { name: "three different votes", ballots: [1, 2, 3], ruling: 3, bps: 5000, fallback: true, net: 198n, refund: 200n, serviceFee: 2n },
    { name: "zero votes", ballots: [], ruling: 3, bps: 5000, fallback: true, net: 198n, refund: 200n, serviceFee: 2n },
    { name: "one freelancer vote", ballots: [1], ruling: 3, bps: 5000, fallback: true, net: 198n, refund: 200n, serviceFee: 2n },
    { name: "one client vote", ballots: [2], ruling: 3, bps: 5000, fallback: true, net: 198n, refund: 200n, serviceFee: 2n },
    { name: "one split vote", ballots: [3], ruling: 3, bps: 5000, fallback: true, net: 198n, refund: 200n, serviceFee: 2n },
    { name: "two different votes", ballots: [1, 2], ruling: 3, bps: 5000, fallback: true, net: 198n, refund: 200n, serviceFee: 2n },
  ];
  for (const outcome of outcomes) {
    it(`finalizes ${outcome.name} with correct payouts, service fee and unlocked collateral`, async () => {
      const f = await networkHelpers.loadFixture(openedFixture);
      const clientBefore = await f.token.read.balanceOf([f.client.account.address]);
      const freelancerBefore = await f.token.read.balanceOf([f.freelancer.account.address]);
      await vote(f, outcome.ballots);
      const tx = await finish(f);
      const dispute = await f.arbitration.read.getDispute([0n]);
      assert.equal(dispute.status, Status.FINALIZED);
      assert.equal(dispute.ruling, outcome.ruling);
      assert.equal(dispute.freelancerBps, outcome.bps);
      assert.equal(dispute.fallbackApplied, outcome.fallback);
      assert.deepEqual(await f.arbitration.read.getVerdict([0n]), [outcome.ruling, outcome.bps, outcome.fallback]);
      assert.equal(await f.token.read.balanceOf([f.client.account.address]), clientBefore + outcome.refund * unit);
      assert.equal(await f.token.read.balanceOf([f.freelancer.account.address]), freelancerBefore + outcome.net * unit);
      assert.equal(await f.token.read.balanceOf([f.treasury.account.address]), outcome.serviceFee * unit);
      assert.equal((await f.escrow.read.projects([0n]))[4], 600n * unit);
      assert.equal((await f.escrow.read.getDisputeContext([0n, 0n])).milestoneState, Milestone.SETTLED);
      assert.equal((await f.registry.read.getAssignment([0n])).state, 2);
      assert.equal(await f.registry.read.totalLockedStake(), 0n);
      for (const juror of dispute.jurors) assert.deepEqual(await f.registry.read.getActiveDisputes([juror]), []);
      await viem.assertions.emitWithArgs(tx, f.arbitration, "VerdictReached", [0n, outcome.ruling, outcome.fallback, dispute.freelancerVotes, dispute.clientVotes, dispute.splitVotes]);
      await viem.assertions.emitWithArgs(tx, f.arbitration, "DisputeFinalized", [0n, 0n, 0n, BigInt(outcome.bps), 400n * unit, dispute.finalizedAt]);
      await viem.assertions.emitWithArgs(tx, f.escrow, "MilestoneSettled", [0n, 0n, 400n * unit, (outcome.net + outcome.serviceFee) * unit, outcome.net * unit, outcome.refund * unit, outcome.serviceFee * unit]);
      await assertAccounting(f);
    });
  }

  it("prevents repeat finalization, voting, responses, payout and unlocking", async () => {
    const f = await networkHelpers.loadFixture(openedFixture);
    await vote(f, [1, 1]);
    await finish(f);
    const before = await f.arbitration.read.getDispute([0n]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.finalizeDispute([0n]), f.arbitration, "InvalidState");
    await viem.assertions.revertWithCustomError(f.arbitration.write.castVote([0n, 2], { account: f.jurors[2].account }), f.arbitration, "InvalidState");
    await viem.assertions.revertWithCustomError(f.arbitration.write.respondToDispute([0n, response], { account: f.freelancer.account }), f.arbitration, "InvalidState");
    await viem.assertions.revertWithCustomError(f.registry.write.releaseJurors([0n]), f.registry, "Unauthorized");
    await viem.assertions.revertWithCustomError(f.escrow.write.settleDisputedMilestone([0n, 0n, 10000n]), f.escrow, "Unauthorized");
    assert.deepEqual(await f.arbitration.read.getDispute([0n]), before);
    await assertAccounting(f);
  });

  it("blocks normal settlement paths while the complete dispute remains active", async () => {
    const f = await networkHelpers.loadFixture(openedFixture);
    await networkHelpers.time.increaseTo((await f.arbitration.read.getDispute([0n])).votingDeadline + 10n * 24n * hour);
    await viem.assertions.revertWithCustomError(f.escrow.write.approveMilestone([0n, 0n]), f.escrow, "InvalidState");
    await viem.assertions.revertWithCustomError(f.escrow.write.releaseAfterReviewTimeout([0n, 0n], { account: f.freelancer.account }), f.escrow, "InvalidState");
    await viem.assertions.revertWithCustomError(f.escrow.write.refundMissedMilestone([0n, 0n]), f.escrow, "InvalidState");
    await viem.assertions.revertWithCustomError(f.escrow.write.refundUnaccepted([0n]), f.escrow, "InvalidState");
    await f.arbitration.write.finalizeDispute([0n], { account: f.outsider.account });
    await assertAccounting(f);
  });

  it("isolates concurrent disputes, votes and accounting across independent projects", async () => {
    const f = await networkHelpers.loadFixture(openedFixture);
    await f.token.write.transfer([f.secondClient.account.address, 1000n * unit]);
    const otherId = await createProject(f, [300n * unit], f.secondClient, f.secondFreelancer);
    await fundAndSubmit(f, otherId, f.secondClient, f.secondFreelancer);
    await open(f, otherId, 0n, f.secondClient);
    const firstJury = await selectedWallets(f, 0n);
    const secondJury = await selectedWallets(f, 1n);
    assert.equal(new Set([...firstJury, ...secondJury].map(addressOf)).size, 6);
    await networkHelpers.time.increaseTo((await f.arbitration.read.getDispute([1n])).responseDeadline);
    await viem.assertions.revertWithCustomError(f.arbitration.write.castVote([1n, 1], { account: firstJury[0].account }), f.arbitration, "Unauthorized");
    for (const juror of firstJury.slice(0, 2)) await f.arbitration.write.castVote([0n, 1], { account: juror.account });
    for (const juror of secondJury.slice(0, 2)) await f.arbitration.write.castVote([1n, 2], { account: juror.account });
    const secondBefore = await f.escrow.read.projects([otherId]);
    await networkHelpers.time.increaseTo((await f.arbitration.read.getDispute([1n])).votingDeadline + 1n);
    await f.arbitration.write.finalizeDispute([0n]);
    assert.deepEqual(await f.escrow.read.projects([otherId]), secondBefore);
    assert.equal(await f.registry.read.totalLockedStake(), 300n * unit);
    await assertAccounting(f, [0n, otherId]);
    await f.arbitration.write.finalizeDispute([1n], { account: f.outsider.account });
    assert.equal(await f.token.read.balanceOf([f.secondClient.account.address]), 985n * unit);
    assert.equal(await f.arbitration.read.totalDisputeFeesHeld(), 30n * unit);
    assert.equal(await f.registry.read.totalLockedStake(), 0n);
    await assertAccounting(f, [0n, otherId]);
  });

  it("completes the funded-project to arbitration flow and permits a new dispute for the next milestone", async () => {
    const f = await networkHelpers.loadFixture(configuredFixture);
    await createProject(f);
    await fundAndSubmit(f, 0n);
    await open(f);
    await f.arbitration.write.respondToDispute([0n, response], { account: f.freelancer.account });
    await vote(f, [1, 3, 1]);
    await finish(f);
    await f.escrow.write.submitMilestone([0n, 1n, evidence], { account: f.freelancer.account });
    await open(f, 0n, 1n, f.freelancer);
    assert.deepEqual(await f.arbitration.read.getMilestoneDispute([0n, 1n]), [true, 1n]);
    await vote(f, [3, 3], 1n);
    await finish(f, 1n);
    assert.equal((await f.escrow.read.projects([0n]))[9], 3);
    assert.equal(await f.token.read.balanceOf([f.freelancer.account.address]), 778n * unit);
    assert.equal(await f.token.read.balanceOf([f.treasury.account.address]), 7n * unit);
    assert.equal(await f.registry.read.totalLockedStake(), 0n);
    assert.equal(await f.arbitration.read.totalDisputeFeesHeld(), 30n * unit);
    await assertAccounting(f);
  });

  it("retains fees through finalization and does not count unsolicited donations as dispute fees", async () => {
    const f = await networkHelpers.loadFixture(openedFixture);
    await f.token.write.transfer([f.arbitration.address, 7n]);
    await finish(f);
    assert.equal(await f.arbitration.read.totalDisputeFeesHeld(), fee);
    assert.equal(await f.arbitration.read.pendingJurorFees(), 12n * unit);
    assert.equal(await f.arbitration.read.pendingProtocolFees(), 3n * unit);
    await assertAccounting(f, [0n], 7n);
  });

  it("deploys and connects the local Phase 2C module using the same arbitration authority", async () => {
    const { token, escrow, registry, arbitration } = await ignition.deploy(phase2C);
    assert.equal(await arbitration.read.isConfigured(), true);
    assert.equal(await escrow.read.arbitrationContract(), getAddress(arbitration.address));
    assert.equal(await registry.read.arbitrationContract(), getAddress(arbitration.address));
    assert.equal(await arbitration.read.paymentToken(), getAddress(token.address));
  });

  async function adversarialFixture() {
    const f = await configureAndEnroll(await deployFixture(true));
    await createProject(f);
    await fundAndSubmit(f, 0n);
    const control = await viem.getContractAt("RegistryTestToken", f.token.address);
    return { ...f, control };
  }

  it("rolls back a failed fee transfer and a short fee transfer even when fee surplus exists", async () => {
    const f = await networkHelpers.loadFixture(adversarialFixture);
    await f.token.write.transfer([f.arbitration.address, fee]);
    await f.token.write.approve([f.arbitration.address, fee]);
    for (const mode of [1, 2]) {
      await f.control.write.setTransferMode([mode, zeroAddress, "0x"]);
      await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([0n, 0n, evidence]), f.arbitration, mode === 1 ? "SafeERC20FailedOperation" : "InvalidInput");
      assert.equal(await f.arbitration.read.nextDisputeId(), 0n);
      assert.equal((await f.escrow.read.getDisputeContext([0n, 0n])).milestoneState, Milestone.SUBMITTED);
      await assertAccounting(f, [0n], fee);
    }
  });

  it("blocks reentrant callbacks during fee collection without consuming the case", async () => {
    const f = await networkHelpers.loadFixture(adversarialFixture);
    await f.token.write.approve([f.arbitration.address, fee]);
    const callback = encodeFunctionData({ abi: f.arbitration.abi, functionName: "finalizeDispute", args: [0n] });
    await f.control.write.setTransferMode([3, f.arbitration.address, callback]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([0n, 0n, evidence]), f.arbitration, "ReentrancyGuardReentrantCall");
    assert.equal(await f.arbitration.read.nextDisputeId(), 0n);
    await assertAccounting(f);
  });

  it("rolls back finalization after a token payout failure and permits a safe retry", async () => {
    const f = await networkHelpers.loadFixture(adversarialFixture);
    await open(f);
    await vote(f, [3, 3]);
    const before = await f.arbitration.read.getDispute([0n]);
    await networkHelpers.time.increaseTo(before.votingDeadline + 1n);
    await f.control.write.setTransferMode([1, zeroAddress, "0x"]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.finalizeDispute([0n]), f.escrow, "SafeERC20FailedOperation");
    assert.deepEqual(await f.arbitration.read.getDispute([0n]), before);
    assert.equal((await f.escrow.read.getDisputeContext([0n, 0n])).milestoneState, Milestone.DISPUTED);
    assert.equal((await f.registry.read.getAssignment([0n])).state, 1);
    await assertAccounting(f);
    await f.control.write.setTransferMode([0, zeroAddress, "0x"]);
    await f.arbitration.write.finalizeDispute([0n], { account: f.outsider.account });
    await assertAccounting(f);
  });

  it("blocks reentrant finalization from token payout callbacks and leaves the verdict retryable", async () => {
    const f = await networkHelpers.loadFixture(adversarialFixture);
    await open(f);
    await vote(f, [1, 1]);
    const dispute = await f.arbitration.read.getDispute([0n]);
    await networkHelpers.time.increaseTo(dispute.votingDeadline + 1n);
    const callback = encodeFunctionData({ abi: f.arbitration.abi, functionName: "finalizeDispute", args: [0n] });
    await f.control.write.setTransferMode([3, f.arbitration.address, callback]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.finalizeDispute([0n]), f.arbitration, "ReentrancyGuardReentrantCall");
    assert.equal((await f.arbitration.read.getDispute([0n])).status, Status.OPEN);
    assert.equal(await f.registry.read.totalLockedStake(), 300n * unit);
    await assertAccounting(f);
    await f.control.write.setTransferMode([0, zeroAddress, "0x"]);
    await f.arbitration.write.finalizeDispute([0n]);
    await assertAccounting(f);
  });

  it("rolls back completed escrow payouts if registry unlocking fails, then finalizes successfully on retry", async () => {
    const f = await configureAndEnroll(await deployFixture(false, true));
    assert.ok(f.harness);
    await createProject(f);
    await fundAndSubmit(f, 0n);
    await open(f);
    await vote(f, [3, 3]);
    const before = await f.arbitration.read.getDispute([0n]);
    const clientBefore = await f.token.read.balanceOf([f.client.account.address]);
    const freelancerBefore = await f.token.read.balanceOf([f.freelancer.account.address]);
    await f.harness.write.setFailRelease([true]);
    await networkHelpers.time.increaseTo(before.votingDeadline + 1n);
    await viem.assertions.revertWithCustomError(f.arbitration.write.finalizeDispute([0n]), f.harness, "ForcedReleaseFailure");
    assert.deepEqual(await f.arbitration.read.getDispute([0n]), before);
    assert.equal(await f.token.read.balanceOf([f.client.account.address]), clientBefore);
    assert.equal(await f.token.read.balanceOf([f.freelancer.account.address]), freelancerBefore);
    assert.equal(await f.token.read.balanceOf([f.treasury.account.address]), 0n);
    assert.equal((await f.escrow.read.getDisputeContext([0n, 0n])).milestoneState, Milestone.DISPUTED);
    assert.equal((await f.registry.read.getAssignment([0n])).state, 1);
    await assertAccounting(f);
    await f.harness.write.setFailRelease([false]);
    await f.arbitration.write.finalizeDispute([0n], { account: f.outsider.account });
    assert.equal(await f.registry.read.totalLockedStake(), 0n);
    await assertAccounting(f);
  });
});
