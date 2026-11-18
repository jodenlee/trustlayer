import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { encodeFunctionData, getAddress, maxUint256, zeroAddress, type Address } from "viem";
import phase2D from "../ignition/modules/Phase2D.js";

const unit = 10n ** 6n;
const fee = 15n * unit;
const reward = 4n * unit;
const hour = 3600n;
const evidence = `0x${"66".repeat(32)}` as `0x${string}`;

describe("TrustLayer Phase 2D treasury and juror rewards", async () => {
  const { viem, networkHelpers } = await network.create();
  const publicClient = await viem.getPublicClient();
  const wallets = await viem.getWalletClients();
  const [client, freelancer, outsider, nextOwner, recipient, secondClient, secondFreelancer, ...jurors] = wallets;
  type Wallet = typeof client;
  const addressOf = (wallet: Wallet) => getAddress(wallet.account.address);

  async function deployFixture(adversarial = false) {
    const deployed = adversarial
      ? await viem.deployContract("TreasuryTestToken", [client.account.address])
      : await viem.deployContract("MockUSD", [client.account.address]);
    const token = await viem.getContractAt("MockUSD", deployed.address);
    const treasury = await viem.deployContract("ProtocolTreasury", [token.address, client.account.address]);
    const escrow = await viem.deployContract("TrustEscrow", [token.address, treasury.address]);
    const registry = await viem.deployContract("JurorRegistry", [token.address]);
    const arbitration = await viem.deployContract("DisputeArbitration", [escrow.address, registry.address]);
    return { token, treasury, escrow, registry, arbitration };
  }
  type Fixture = Awaited<ReturnType<typeof deployFixture>>;
  async function baseFixture() { return deployFixture(); }

  async function configure(f: Fixture) {
    await f.treasury.write.configureSources([f.escrow.address, f.arbitration.address]);
    await f.arbitration.write.setProtocolTreasury([f.treasury.address]);
    await f.escrow.write.setArbitrationContract([f.arbitration.address]);
    await f.registry.write.setArbitrationContract([f.arbitration.address]);
  }

  async function enroll(f: Fixture, wallet: Wallet, amount = 200n * unit) {
    await f.token.write.transfer([wallet.account.address, 1000n * unit]);
    await f.registry.write.registerJuror({ account: wallet.account });
    await f.token.write.approve([f.registry.address, maxUint256], { account: wallet.account });
    await f.registry.write.depositStake([amount], { account: wallet.account });
  }

  async function configuredFixture() {
    const f = await baseFixture();
    await configure(f);
    for (const juror of jurors.slice(0, 6)) await enroll(f, juror);
    return f;
  }

  async function project(f: Fixture, amounts = [400n * unit, 600n * unit], payer = client, worker = freelancer) {
    const id = await f.escrow.read.nextProjectId();
    const now = (await publicClient.getBlock()).timestamp;
    const dates = amounts.map((_, i) => now + BigInt(14 + i * 7) * 24n * hour);
    await f.escrow.write.createProject([worker.account.address, amounts, dates, evidence], { account: payer.account });
    const total = amounts.reduce((sum, amount) => sum + amount, 0n);
    await f.token.write.approve([f.escrow.address, total], { account: payer.account });
    await f.escrow.write.fundProject([id], { account: payer.account });
    await f.escrow.write.acceptProject([id], { account: worker.account });
    await f.escrow.write.submitMilestone([id, 0n, evidence], { account: worker.account });
    return id;
  }

  async function open(f: Fixture, projectId = 0n, index = 0n, payer = client) {
    await f.token.write.approve([f.arbitration.address, fee], { account: payer.account });
    return f.arbitration.write.openDispute([projectId, index, evidence], { account: payer.account });
  }

  async function submittedFixture() {
    const f = await configuredFixture();
    await project(f);
    return f;
  }

  async function openedFixture() {
    const f = await submittedFixture();
    await open(f);
    return f;
  }

  async function jury(f: Fixture, id = 0n) {
    return (await f.arbitration.read.getDispute([id])).jurors.map(address => {
      const wallet = wallets.find(candidate => addressOf(candidate) === address);
      assert.ok(wallet);
      return wallet;
    });
  }

  async function finalize(f: Fixture, ballots: (1 | 2 | 3)[] = [1, 1], id = 0n) {
    const dispute = await f.arbitration.read.getDispute([id]);
    await networkHelpers.time.increaseTo(dispute.responseDeadline);
    const selected = await jury(f, id);
    for (let i = 0; i < ballots.length; ++i) await f.arbitration.write.castVote([id, ballots[i]], { account: selected[i].account });
    await networkHelpers.time.increaseTo(dispute.votingDeadline + 1n);
    return f.arbitration.write.finalizeDispute([id], { account: outsider.account });
  }

  async function finalizedFixture() {
    const f = await openedFixture();
    await finalize(f);
    return f;
  }

  async function assertAccounting(f: Fixture, projectIds = [0n], treasurySurplus = 0n, feeSurplus = 0n) {
    let principal = 0n;
    for (const id of projectIds) principal += (await f.escrow.read.projects([id]))[4];
    assert.equal(await f.escrow.read.totalEscrowLiability(), principal);
    assert.equal(await f.token.read.balanceOf([f.escrow.address]), principal);
    let stake = 0n;
    let locked = 0n;
    for (let i = 0n; i < await f.registry.read.registeredJurorCount(); ++i) {
      const address = await f.registry.read.registeredJurors([i]);
      const info = await f.registry.read.getJurorInfo([address]);
      assert.equal(info.depositedStake, info.availableStake + info.lockedStake);
      assert.equal(info.lockedStake, info.activeAssignments * 100n * unit);
      stake += info.depositedStake;
      locked += info.lockedStake;
    }
    assert.equal(await f.registry.read.totalStaked(), stake);
    assert.equal(await f.registry.read.totalLockedStake(), locked);
    assert.equal(await f.token.read.balanceOf([f.registry.address]), stake);
    const pendingJuror = await f.arbitration.read.pendingJurorFees();
    const pendingProtocol = await f.arbitration.read.pendingProtocolFees();
    const reserved = await f.arbitration.read.reservedJurorRewards();
    const claimed = await f.arbitration.read.totalJurorRewardsClaimed();
    const protocol = await f.arbitration.read.totalProtocolFeesTransferred();
    const held = await f.arbitration.read.totalDisputeFeesHeld();
    assert.equal(held, pendingJuror + pendingProtocol + reserved);
    assert.equal(await f.token.read.balanceOf([f.arbitration.address]), held + feeSurplus);
    assert.equal(held + claimed + protocol, await f.arbitration.read.nextDisputeId() * fee);
    assert.equal(await f.arbitration.read.totalJurorRewardsReserved(), reserved + claimed);
    assert.equal(protocol, await f.treasury.read.totalDisputeFeesReceived());
    const available = await f.treasury.read.availableRevenue();
    assert.equal(await f.treasury.read.totalRevenueReceived(), available + await f.treasury.read.totalWithdrawn());
    assert.equal(await f.token.read.balanceOf([f.treasury.address]), available + treasurySurplus);
    assert.equal(await f.token.read.allowance([f.escrow.address, f.treasury.address]), 0n);
    assert.equal(await f.token.read.allowance([f.arbitration.address, f.treasury.address]), 0n);
    const holders = new Set<Address>([...wallets.map(addressOf), f.escrow.address, f.registry.address, f.arbitration.address, f.treasury.address]);
    const balances = await Promise.all([...holders].map(address => f.token.read.balanceOf([address])));
    assert.equal(balances.reduce((sum, balance) => sum + balance, 0n), await f.token.read.totalSupply());
  }

  it("creates a six-decimal revenue vault with an explicit owner and rejects invalid construction", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    assert.equal(await f.treasury.read.owner(), addressOf(client));
    assert.equal(await f.treasury.read.paymentToken(), getAddress(f.token.address));
    assert.equal(await f.treasury.read.availableRevenue(), 0n);
    assert.equal(await f.escrow.read.usesProtocolTreasury(), true);
    await viem.assertions.revertWithCustomError(viem.deployContract("ProtocolTreasury", [zeroAddress, client.account.address]), f.treasury, "InvalidInput");
    await viem.assertions.revertWithCustomError(viem.deployContract("ProtocolTreasury", [outsider.account.address, client.account.address]), f.treasury, "InvalidInput");
    await viem.assertions.revertWithCustomError(viem.deployContract("ProtocolTreasury", [f.token.address, zeroAddress]), f.treasury, "OwnableInvalidOwner");
    const wrong = await viem.deployContract("RegistryTestToken", [client.account.address, 18]);
    await viem.assertions.revertWithCustomError(viem.deployContract("ProtocolTreasury", [wrong.address, client.account.address]), f.treasury, "InvalidInput");
  });

  it("pins matching revenue sources once and rejects unauthorized or mismatched configuration", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    await viem.assertions.revertWithCustomError(f.treasury.write.configureSources([f.escrow.address, f.arbitration.address], { account: outsider.account }), f.treasury, "OwnableUnauthorizedAccount");
    for (const [escrow, arbitration] of [[zeroAddress, f.arbitration.address], [f.escrow.address, outsider.account.address], [f.escrow.address, f.escrow.address]] as const) {
      await viem.assertions.revertWithCustomError(f.treasury.write.configureSources([escrow, arbitration]), f.treasury, "InvalidInput");
    }
    const otherVault = await viem.deployContract("ProtocolTreasury", [f.token.address, client.account.address]);
    await viem.assertions.revertWithCustomError(otherVault.write.configureSources([f.escrow.address, f.arbitration.address]), otherVault, "InvalidInput");
    await viem.assertions.emitWithArgs(f.treasury.write.configureSources([f.escrow.address, f.arbitration.address]), f.treasury, "SourcesConfigured", [getAddress(f.escrow.address), getAddress(f.arbitration.address)]);
    await viem.assertions.revertWithCustomError(f.treasury.write.configureSources([f.escrow.address, f.arbitration.address]), f.treasury, "InvalidState");
  });

  it("validates treasury token compatibility in the escrow constructor", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    const token = await viem.deployContract("MockUSD", [client.account.address]);
    await viem.assertions.revertWithCustomError(viem.deployContract("TrustEscrow", [token.address, f.treasury.address]), f.escrow, "InvalidInput");
  });

  it("requires all Phase 2D permissions before opening and configures treasury only once", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    await f.escrow.write.setArbitrationContract([f.arbitration.address]);
    await f.registry.write.setArbitrationContract([f.arbitration.address]);
    assert.equal(await f.arbitration.read.isConfigured(), false);
    await viem.assertions.revertWithCustomError(f.arbitration.write.openDispute([0n, 0n, evidence]), f.arbitration, "InvalidConfiguration");
    await viem.assertions.revertWithCustomError(f.arbitration.write.setProtocolTreasury([f.treasury.address], { account: outsider.account }), f.arbitration, "Unauthorized");
    await viem.assertions.revertWithCustomError(f.arbitration.write.setProtocolTreasury([f.treasury.address]), f.arbitration, "InvalidConfiguration");
    for (const address of [zeroAddress, outsider.account.address, f.token.address]) await viem.assertions.revertWithCustomError(f.arbitration.write.setProtocolTreasury([address]), f.arbitration, "InvalidInput");
    await f.treasury.write.configureSources([f.escrow.address, f.arbitration.address]);
    await viem.assertions.emitWithArgs(f.arbitration.write.setProtocolTreasury([f.treasury.address]), f.arbitration, "ProtocolTreasuryConfigured", [getAddress(f.treasury.address)]);
    assert.equal(await f.arbitration.read.isConfigured(), true);
    await viem.assertions.revertWithCustomError(f.arbitration.write.setProtocolTreasury([f.treasury.address]), f.arbitration, "InvalidState");
    await viem.assertions.revertWithCustomError(f.arbitration.write.setProtocolTreasury([zeroAddress]), f.arbitration, "InvalidState");
  });

  it("restricts every fee intake method to its pinned source, including against the owner", async () => {
    const f = await networkHelpers.loadFixture(configuredFixture);
    for (const caller of [client, freelancer, outsider, jurors[0]]) {
      await viem.assertions.revertWithCustomError(f.treasury.write.depositServiceFee([0n, 0n, 4n * unit], { account: caller.account }), f.treasury, "Unauthorized");
      await viem.assertions.revertWithCustomError(f.treasury.write.depositDisputeFee([0n], { account: caller.account }), f.treasury, "Unauthorized");
    }
    await assertAccounting(f, []);
  });

  it("receives each normal service fee exactly once and preserves principal through two milestones", async () => {
    const f = await networkHelpers.loadFixture(submittedFixture);
    const tx = await f.escrow.write.approveMilestone([0n, 0n]);
    await viem.assertions.emitWithArgs(tx, f.treasury, "ServiceFeeDeposited", [0n, 0n, 4n * unit]);
    assert.equal(await f.treasury.read.totalServiceFeesReceived(), 4n * unit);
    await viem.assertions.revertWithCustomError(f.escrow.write.approveMilestone([0n, 0n]), f.escrow, "InvalidState");
    await f.treasury.write.withdraw([recipient.account.address, 4n * unit]);
    await f.escrow.write.submitMilestone([0n, 1n, evidence], { account: freelancer.account });
    await f.escrow.write.approveMilestone([0n, 1n]);
    assert.equal(await f.treasury.read.totalServiceFeesReceived(), 10n * unit);
    assert.equal(await f.treasury.read.availableRevenue(), 6n * unit);
    assert.equal(await f.treasury.read.totalWithdrawn(), 4n * unit);
    assert.equal(await f.token.read.balanceOf([freelancer.account.address]), 990n * unit);
    assert.equal(await f.treasury.read.serviceFeeReceived([0n, 0n]), true);
    assert.equal(await f.treasury.read.serviceFeeReceived([0n, 1n]), true);
    await assertAccounting(f);
  });

  it("supports the normal review-time release path with treasury accounting", async () => {
    const f = await networkHelpers.loadFixture(submittedFixture);
    const { reviewEnd } = await f.escrow.read.getDisputeContext([0n, 0n]);
    await networkHelpers.time.increaseTo(reviewEnd + 1n);
    await f.escrow.write.releaseAfterReviewTimeout([0n, 0n], { account: freelancer.account });
    assert.equal(await f.treasury.read.totalServiceFeesReceived(), 4n * unit);
    await assertAccounting(f);
  });

  it("keeps escrow settlement atomic if treasury source configuration is incomplete", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    await project(f);
    await viem.assertions.revertWithCustomError(f.escrow.write.approveMilestone([0n, 0n]), f.treasury, "Unauthorized");
    assert.equal((await f.escrow.read.getDisputeContext([0n, 0n])).milestoneState, 1);
    assert.equal(await f.token.read.balanceOf([freelancer.account.address]), 0n);
    await assertAccounting(f);
  });

  it("does not reserve rewards or send protocol revenue before finalization", async () => {
    const f = await networkHelpers.loadFixture(openedFixture);
    assert.equal(await f.arbitration.read.pendingJurorFees(), 12n * unit);
    assert.equal(await f.arbitration.read.pendingProtocolFees(), 3n * unit);
    assert.equal(await f.arbitration.read.reservedJurorRewards(), 0n);
    assert.equal(await f.treasury.read.totalDisputeFeesReceived(), 0n);
    for (const juror of await jury(f)) {
      assert.equal(await f.arbitration.read.claimableReward([0n, juror.account.address]), 0n);
      await viem.assertions.revertWithCustomError(f.arbitration.write.claimJurorReward([0n], { account: juror.account }), f.arbitration, "InvalidState");
    }
    await viem.assertions.revertWithCustomError(f.arbitration.write.finalizeDispute([0n]), f.arbitration, "NotReady");
    await assertAccounting(f);
  });

  for (const outcome of [
    { name: "freelancer victory", votes: [1, 1] as (1 | 2 | 3)[], net: 396n, refund: 0n, service: 4n },
    { name: "client victory", votes: [2, 2] as (1 | 2 | 3)[], net: 0n, refund: 400n, service: 0n },
    { name: "split verdict", votes: [3, 3] as (1 | 2 | 3)[], net: 198n, refund: 200n, service: 2n },
    { name: "no-vote fallback", votes: [] as (1 | 2 | 3)[], net: 198n, refund: 200n, service: 2n },
  ]) {
    it(`allocates exactly 3 + 12 mUSD after ${outcome.name} and allows all three 4 mUSD rewards`, async () => {
      const f = await networkHelpers.loadFixture(openedFixture);
      const clientBefore = await f.token.read.balanceOf([client.account.address]);
      const tx = await finalize(f, outcome.votes);
      await viem.assertions.emitWithArgs(tx, f.arbitration, "JurorRewardsReserved", [0n, 12n * unit]);
      await viem.assertions.emitWithArgs(tx, f.treasury, "DisputeFeeDeposited", [0n, 3n * unit]);
      assert.equal(await f.token.read.balanceOf([client.account.address]), clientBefore + outcome.refund * unit);
      assert.equal(await f.token.read.balanceOf([freelancer.account.address]), outcome.net * unit);
      assert.equal(await f.treasury.read.totalServiceFeesReceived(), outcome.service * unit);
      assert.equal(await f.treasury.read.availableRevenue(), (outcome.service + 3n) * unit);
      assert.equal(await f.arbitration.read.pendingJurorFees(), 0n);
      assert.equal(await f.arbitration.read.pendingProtocolFees(), 0n);
      assert.equal(await f.arbitration.read.reservedJurorRewards(), 12n * unit);
      assert.equal(await f.registry.read.totalLockedStake(), 0n);
      for (const juror of await jury(f)) {
        const before = await f.token.read.balanceOf([juror.account.address]);
        assert.equal(await f.arbitration.read.claimableReward([0n, juror.account.address]), reward);
        await viem.assertions.emitWithArgs(f.arbitration.write.claimJurorReward([0n], { account: juror.account }), f.arbitration, "JurorRewardClaimed", [0n, addressOf(juror), reward]);
        assert.equal(await f.token.read.balanceOf([juror.account.address]), before + reward);
        assert.equal(await f.arbitration.read.claimableReward([0n, juror.account.address]), 0n);
        await assertAccounting(f);
      }
      assert.equal(await f.arbitration.read.rewardsClaimedForDispute([0n]), 12n * unit);
      assert.equal(await f.arbitration.read.totalDisputeFeesHeld(), 0n);
    });
  }

  it("rejects unassigned claims, duplicates and unknown cases without redirecting rewards", async () => {
    const f = await networkHelpers.loadFixture(finalizedFixture);
    for (const caller of [client, freelancer, outsider, jurors[5]]) {
      assert.equal(await f.arbitration.read.claimableReward([0n, caller.account.address]), 0n);
      await viem.assertions.revertWithCustomError(f.arbitration.write.claimJurorReward([0n], { account: caller.account }), f.arbitration, "Unauthorized");
    }
    const selected = await jury(f);
    await f.arbitration.write.claimJurorReward([0n], { account: selected[0].account });
    await viem.assertions.revertWithCustomError(f.arbitration.write.claimJurorReward([0n], { account: selected[0].account }), f.arbitration, "InvalidState");
    await viem.assertions.revertWithCustomError(f.arbitration.write.claimJurorReward([99n], { account: selected[0].account }), f.arbitration, "InvalidState");
    assert.equal(await f.arbitration.read.rewardsClaimedForDispute([0n]), reward);
    await assertAccounting(f);
  });

  it("preserves unclaimed rewards after arbitrarily long delays and after treasury withdrawal", async () => {
    const f = await networkHelpers.loadFixture(finalizedFixture);
    await f.treasury.write.withdraw([recipient.account.address, 7n * unit]);
    await networkHelpers.time.increase(365n * 24n * hour);
    const selected = await jury(f);
    assert.equal(await f.arbitration.read.claimableReward([0n, selected[0].account.address]), reward);
    await f.arbitration.write.claimJurorReward([0n], { account: selected[0].account });
    assert.equal(await f.arbitration.read.reservedJurorRewards(), 8n * unit);
    await assertAccounting(f);
  });

  it("prevents duplicate finalization and duplicate protocol revenue or reward reservation", async () => {
    const f = await networkHelpers.loadFixture(finalizedFixture);
    await viem.assertions.revertWithCustomError(f.arbitration.write.finalizeDispute([0n]), f.arbitration, "InvalidState");
    assert.equal(await f.treasury.read.totalDisputeFeesReceived(), 3n * unit);
    assert.equal(await f.arbitration.read.totalJurorRewardsReserved(), 12n * unit);
    assert.equal(await f.treasury.read.disputeFeeReceived([0n]), true);
    await assertAccounting(f);
  });

  it("withdraws only recognized treasury revenue once and rejects invalid amounts and recipients", async () => {
    const f = await networkHelpers.loadFixture(finalizedFixture);
    await viem.assertions.revertWithCustomError(f.treasury.write.withdraw([recipient.account.address, 1n], { account: outsider.account }), f.treasury, "OwnableUnauthorizedAccount");
    for (const [to, amount] of [[zeroAddress, 1n], [f.treasury.address, 1n], [recipient.account.address, 0n]] as const) await viem.assertions.revertWithCustomError(f.treasury.write.withdraw([to, amount]), f.treasury, "InvalidInput");
    await viem.assertions.revertWithCustomError(f.treasury.write.withdraw([recipient.account.address, 7n * unit + 1n]), f.treasury, "InsufficientRevenue");
    await viem.assertions.emitWithArgs(f.treasury.write.withdraw([recipient.account.address, 7n * unit]), f.treasury, "TreasuryWithdrawal", [addressOf(client), addressOf(recipient), 7n * unit]);
    await viem.assertions.revertWithCustomError(f.treasury.write.withdraw([recipient.account.address, 1n]), f.treasury, "InsufficientRevenue");
    assert.equal(await f.token.read.balanceOf([recipient.account.address]), 7n * unit);
    assert.equal(await f.token.read.balanceOf([f.arbitration.address]), 12n * unit);
    assert.equal(await f.token.read.balanceOf([f.registry.address]), 1200n * unit);
    assert.equal(await f.token.read.balanceOf([f.escrow.address]), 600n * unit);
    await assertAccounting(f);
  });

  it("uses two-step ownership transfer without transferring any fee-source authority", async () => {
    const f = await networkHelpers.loadFixture(finalizedFixture);
    await viem.assertions.emitWithArgs(f.treasury.write.transferOwnership([nextOwner.account.address]), f.treasury, "OwnershipTransferStarted", [addressOf(client), addressOf(nextOwner)]);
    await viem.assertions.revertWithCustomError(f.treasury.write.withdraw([recipient.account.address, 1n], { account: nextOwner.account }), f.treasury, "OwnableUnauthorizedAccount");
    await viem.assertions.revertWithCustomError(f.treasury.write.acceptOwnership({ account: outsider.account }), f.treasury, "OwnableUnauthorizedAccount");
    await viem.assertions.emitWithArgs(f.treasury.write.acceptOwnership({ account: nextOwner.account }), f.treasury, "OwnershipTransferred", [addressOf(client), addressOf(nextOwner)]);
    await viem.assertions.revertWithCustomError(f.treasury.write.withdraw([recipient.account.address, 1n]), f.treasury, "OwnableUnauthorizedAccount");
    await viem.assertions.revertWithCustomError(f.treasury.write.configureSources([f.escrow.address, f.arbitration.address], { account: nextOwner.account }), f.treasury, "InvalidState");
    await viem.assertions.revertWithCustomError(f.arbitration.write.setProtocolTreasury([f.treasury.address], { account: nextOwner.account }), f.arbitration, "Unauthorized");
    await f.treasury.write.withdraw([recipient.account.address, 7n * unit], { account: nextOwner.account });
    await assertAccounting(f);
  });

  it("keeps donations separate from recorded fee revenue and reserved rewards", async () => {
    const f = await networkHelpers.loadFixture(finalizedFixture);
    await f.token.write.transfer([f.treasury.address, 13n]);
    await f.token.write.transfer([f.arbitration.address, 17n]);
    await f.treasury.write.withdraw([recipient.account.address, 7n * unit]);
    await viem.assertions.revertWithCustomError(f.treasury.write.withdraw([recipient.account.address, 1n]), f.treasury, "InsufficientRevenue");
    for (const juror of await jury(f)) await f.arbitration.write.claimJurorReward([0n], { account: juror.account });
    await assertAccounting(f, [0n], 13n, 17n);
  });

  it("isolates multiple active/completed disputes and limits aggregate rewards to their own reservations", async () => {
    const f = await networkHelpers.loadFixture(openedFixture);
    await f.token.write.transfer([secondClient.account.address, 1000n * unit]);
    const other = await project(f, [300n * unit], secondClient, secondFreelancer);
    await open(f, other, 0n, secondClient);
    await finalize(f);
    const firstJury = await jury(f);
    await f.arbitration.write.claimJurorReward([0n], { account: firstJury[0].account });
    assert.equal(await f.arbitration.read.pendingJurorFees(), 12n * unit);
    assert.equal(await f.arbitration.read.reservedJurorRewards(), 8n * unit);
    assert.equal(await f.registry.read.totalLockedStake(), 300n * unit);
    const second = await f.arbitration.read.getDispute([1n]);
    await networkHelpers.time.increaseTo(second.votingDeadline + 1n);
    await f.arbitration.write.finalizeDispute([1n], { account: outsider.account });
    await viem.assertions.revertWithCustomError(f.arbitration.write.claimJurorReward([1n], { account: firstJury[0].account }), f.arbitration, "Unauthorized");
    for (const juror of firstJury.slice(1)) await f.arbitration.write.claimJurorReward([0n], { account: juror.account });
    for (const juror of await jury(f, 1n)) await f.arbitration.write.claimJurorReward([1n], { account: juror.account });
    assert.equal(await f.arbitration.read.totalJurorRewardsClaimed(), 24n * unit);
    assert.equal(await f.treasury.read.totalDisputeFeesReceived(), 6n * unit);
    assert.equal(await f.arbitration.read.totalDisputeFeesHeld(), 0n);
    await assertAccounting(f, [0n, other]);
  });

  it("supports the same juror claiming once for each of several independent finalized cases", async () => {
    const f = await networkHelpers.loadFixture(configuredFixture);
    for (const id of [0n, 1n, 2n]) { await project(f, [100n * unit]); await open(f, id); }
    const last = await f.arbitration.read.getDispute([2n]);
    await networkHelpers.time.increaseTo(last.votingDeadline + 1n);
    for (const id of [0n, 1n, 2n]) await f.arbitration.write.finalizeDispute([id]);
    const shared = (await jury(f, 0n))[0];
    assert.equal(await f.arbitration.read.claimableReward([0n, shared.account.address]), reward);
    assert.equal(await f.arbitration.read.claimableReward([2n, shared.account.address]), reward);
    await f.arbitration.write.claimJurorReward([2n], { account: shared.account });
    await f.arbitration.write.claimJurorReward([0n], { account: shared.account });
    await viem.assertions.revertWithCustomError(f.arbitration.write.claimJurorReward([2n], { account: shared.account }), f.arbitration, "InvalidState");
    await assertAccounting(f, [0n, 1n, 2n]);
  });

  it("deploys the full Phase 2D stack on a clean local network with all permissions connected", async () => {
    const clean = await network.create();
    assert.equal(await (await clean.viem.getPublicClient()).getBlockNumber(), 0n);
    const { token, treasury, escrow, registry, arbitration } = await clean.ignition.deploy(phase2D);
    assert.equal(await arbitration.read.isConfigured(), true);
    assert.equal(await escrow.read.treasury(), getAddress(treasury.address));
    assert.equal(await escrow.read.usesProtocolTreasury(), true);
    assert.equal(await treasury.read.arbitration(), getAddress(arbitration.address));
    assert.equal(await treasury.read.escrow(), getAddress(escrow.address));
    assert.equal(await registry.read.arbitrationContract(), getAddress(arbitration.address));
    assert.equal(await treasury.read.paymentToken(), getAddress(token.address));
    assert.equal(await treasury.read.owner(), addressOf(client));
  });

  it("completes project creation through voting, settlement, all reward claims and treasury withdrawal", async () => {
    const f = await networkHelpers.loadFixture(configuredFixture);
    await project(f, [400n * unit]);
    await open(f);
    await finalize(f, [1, 1, 3]);
    for (const juror of await jury(f)) await f.arbitration.write.claimJurorReward([0n], { account: juror.account });
    await f.treasury.write.withdraw([recipient.account.address, 7n * unit]);
    assert.equal((await f.escrow.read.projects([0n]))[9], 3);
    assert.equal(await f.token.read.balanceOf([freelancer.account.address]), 396n * unit);
    assert.equal(await f.token.read.balanceOf([recipient.account.address]), 7n * unit);
    assert.equal(await f.arbitration.read.totalJurorRewardsClaimed(), 12n * unit);
    assert.equal(await f.registry.read.totalLockedStake(), 0n);
    assert.equal(await f.treasury.read.availableRevenue(), 0n);
    await assertAccounting(f);
  });

  it("preserves legacy fee custody and refuses to migrate or enable rewards after any case has opened", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    const escrow = await viem.deployContract("TrustEscrow", [f.token.address, client.account.address]);
    const registry = await viem.deployContract("JurorRegistry", [f.token.address]);
    const arbitration = await viem.deployContract("DisputeArbitration", [escrow.address, registry.address]);
    const legacy = { ...f, escrow, registry, arbitration };
    await escrow.write.setArbitrationContract([arbitration.address]);
    await registry.write.setArbitrationContract([arbitration.address]);
    for (const juror of jurors.slice(0, 3)) await enroll(legacy, juror);
    await project(legacy);
    await open(legacy);
    await viem.assertions.revertWithCustomError(arbitration.write.setProtocolTreasury([f.treasury.address]), arbitration, "InvalidState");
    await finalize(legacy);
    assert.equal(await arbitration.read.totalDisputeFeesHeld(), fee);
    assert.equal(await arbitration.read.reservedJurorRewards(), 0n);
    assert.equal(await arbitration.read.claimableReward([0n, jurors[0].account.address]), 0n);
    await viem.assertions.revertWithCustomError(arbitration.write.claimJurorReward([0n], { account: jurors[0].account }), arbitration, "InvalidState");
    assert.equal(await f.token.read.balanceOf([f.treasury.address]), 0n);
  });

  async function adversarialFixture() {
    const f = await deployFixture(true);
    await configure(f);
    for (const juror of jurors.slice(0, 3)) await enroll(f, juror);
    await project(f);
    await open(f);
    const control = await viem.getContractAt("TreasuryTestToken", f.token.address);
    return { ...f, control };
  }

  async function adversarialFinalizedFixture() {
    const f = await adversarialFixture();
    await finalize(f);
    return f;
  }

  it("rolls back a failed reward transfer without consuming the claim and permits retry", async () => {
    const f = await networkHelpers.loadFixture(adversarialFinalizedFixture);
    const juror = (await jury(f))[0];
    await f.control.write.configure([1, zeroAddress, "0x"]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.claimJurorReward([0n], { account: juror.account }), f.arbitration, "SafeERC20FailedOperation");
    assert.equal(await f.arbitration.read.rewardClaimed([0n, juror.account.address]), false);
    assert.equal(await f.arbitration.read.reservedJurorRewards(), 12n * unit);
    await f.control.write.configure([0, zeroAddress, "0x"]);
    await f.arbitration.write.claimJurorReward([0n], { account: juror.account });
    await assertAccounting(f);
  });

  it("blocks reward-claim reentrancy and preserves the pending claim", async () => {
    const f = await networkHelpers.loadFixture(adversarialFinalizedFixture);
    const juror = (await jury(f))[0];
    const data = encodeFunctionData({ abi: f.arbitration.abi, functionName: "claimJurorReward", args: [0n] });
    await f.control.write.configure([3, f.arbitration.address, data]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.claimJurorReward([0n], { account: juror.account }), f.arbitration, "ReentrancyGuardReentrantCall");
    assert.equal(await f.arbitration.read.rewardClaimed([0n, juror.account.address]), false);
    await assertAccounting(f);
  });

  it("rejects a short reward payment without consuming that juror's claim", async () => {
    const f = await networkHelpers.loadFixture(adversarialFinalizedFixture);
    const juror = (await jury(f))[0];
    const before = await f.token.read.balanceOf([juror.account.address]);
    await f.control.write.configure([2, zeroAddress, "0x"]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.claimJurorReward([0n], { account: juror.account }), f.arbitration, "InvalidInput");
    assert.equal(await f.arbitration.read.rewardClaimed([0n, juror.account.address]), false);
    assert.equal(await f.token.read.balanceOf([juror.account.address]), before);
    await assertAccounting(f);
  });

  it("rolls back failed treasury withdrawals, including accounting, and permits retry", async () => {
    const f = await networkHelpers.loadFixture(adversarialFinalizedFixture);
    await f.control.write.configure([1, zeroAddress, "0x"]);
    await viem.assertions.revertWithCustomError(f.treasury.write.withdraw([recipient.account.address, 7n * unit]), f.treasury, "SafeERC20FailedOperation");
    assert.equal(await f.treasury.read.availableRevenue(), 7n * unit);
    assert.equal(await f.treasury.read.totalWithdrawn(), 0n);
    await f.control.write.configure([0, zeroAddress, "0x"]);
    await f.treasury.write.withdraw([recipient.account.address, 7n * unit]);
    await assertAccounting(f);
  });

  it("blocks treasury withdrawal reentrancy even when the callback passes owner authorization", async () => {
    const f = await networkHelpers.loadFixture(adversarialFinalizedFixture);
    const owner = await viem.deployContract("TreasuryOwnerHarness");
    await f.treasury.write.transferOwnership([owner.address]);
    await owner.write.accept([f.treasury.address]);
    const data = encodeFunctionData({ abi: owner.abi, functionName: "withdraw", args: [f.treasury.address, recipient.account.address, 1n] });
    await f.control.write.configure([3, owner.address, data]);
    await viem.assertions.revertWithCustomError(owner.write.withdraw([f.treasury.address, recipient.account.address, unit]), f.treasury, "ReentrancyGuardReentrantCall");
    assert.equal(await f.treasury.read.availableRevenue(), 7n * unit);
    assert.equal(await f.treasury.read.totalWithdrawn(), 0n);
    await assertAccounting(f);
  });

  it("rejects a short treasury withdrawal without debiting recognized revenue", async () => {
    const f = await networkHelpers.loadFixture(adversarialFinalizedFixture);
    await f.control.write.configure([2, zeroAddress, "0x"]);
    await viem.assertions.revertWithCustomError(f.treasury.write.withdraw([recipient.account.address, 7n * unit]), f.treasury, "InvalidInput");
    assert.equal(await f.treasury.read.availableRevenue(), 7n * unit);
    assert.equal(await f.treasury.read.totalWithdrawn(), 0n);
    await assertAccounting(f);
  });

  it("rolls back all settlement and reward effects when the final 3 mUSD treasury transfer fails", async () => {
    const f = await networkHelpers.loadFixture(adversarialFixture);
    const dispute = await f.arbitration.read.getDispute([0n]);
    await networkHelpers.time.increaseTo(dispute.votingDeadline + 1n);
    await f.control.write.blockTransfer([f.arbitration.address, f.treasury.address]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.finalizeDispute([0n]), f.control, "TransferBlocked");
    assert.deepEqual(await f.arbitration.read.getDispute([0n]), dispute);
    assert.equal(await f.arbitration.read.rewardsReserved([0n]), false);
    assert.equal(await f.treasury.read.totalServiceFeesReceived(), 0n);
    assert.equal(await f.treasury.read.totalDisputeFeesReceived(), 0n);
    assert.equal((await f.escrow.read.getDisputeContext([0n, 0n])).milestoneState, 2);
    assert.equal(await f.registry.read.totalLockedStake(), 300n * unit);
    await assertAccounting(f);
    await f.control.write.blockTransfer([zeroAddress, zeroAddress]);
    await f.arbitration.write.finalizeDispute([0n], { account: outsider.account });
    await assertAccounting(f);
  });

  it("rejects short treasury intake even when existing surplus could mask the missing fee", async () => {
    const f = await networkHelpers.loadFixture(adversarialFixture);
    await f.token.write.transfer([f.treasury.address, 100n * unit]);
    const dispute = await f.arbitration.read.getDispute([0n]);
    await networkHelpers.time.increaseTo(dispute.votingDeadline + 1n);
    await f.control.write.configure([2, zeroAddress, "0x"]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.finalizeDispute([0n]), f.treasury, "InvalidInput");
    assert.equal(await f.treasury.read.availableRevenue(), 0n);
    assert.equal(await f.arbitration.read.reservedJurorRewards(), 0n);
    await assertAccounting(f, [0n], 100n * unit);
  });

  it("rolls back settlement if approving a treasury fee fails", async () => {
    const f = await networkHelpers.loadFixture(adversarialFixture);
    await networkHelpers.time.increaseTo((await f.arbitration.read.getDispute([0n])).votingDeadline + 1n);
    await f.control.write.configure([4, zeroAddress, "0x"]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.finalizeDispute([0n]), f.escrow, "SafeERC20FailedOperation");
    assert.equal(await f.arbitration.read.reservedJurorRewards(), 0n);
    assert.equal(await f.treasury.read.availableRevenue(), 0n);
    await assertAccounting(f);
  });

  it("blocks a token callback from reentering treasury intake during service-fee deposit", async () => {
    const f = await networkHelpers.loadFixture(adversarialFixture);
    await networkHelpers.time.increaseTo((await f.arbitration.read.getDispute([0n])).votingDeadline + 1n);
    const data = encodeFunctionData({ abi: f.treasury.abi, functionName: "depositDisputeFee", args: [0n] });
    // Trigger only when the token is being pulled into treasury, while its intake guard is active.
    await f.control.write.setCallbackRecipient([f.treasury.address]);
    await f.control.write.configure([3, f.treasury.address, data]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.finalizeDispute([0n]), f.treasury, "ReentrancyGuardReentrantCall");
    assert.equal(await f.treasury.read.availableRevenue(), 0n);
    await assertAccounting(f);
  });
});
