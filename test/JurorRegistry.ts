import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { encodeFunctionData, getAddress, maxUint256, zeroAddress, type Address } from "viem";
import phase2B from "../ignition/modules/Phase2B.js";

const unit = 10n ** 6n;
const minimum = 100n * unit;
const Assignment = { NONE: 0, ACTIVE: 1, RELEASED: 2 };

describe("TrustLayer Phase 2B juror registration and staking", async () => {
  const { viem, networkHelpers, ignition } = await network.create();

  async function baseFixture() {
    const [deployer, client, freelancer, outsider, treasury, ...jurors] = await viem.getWalletClients();
    const token = await viem.deployContract("MockUSD", [deployer.account.address]);
    const registry = await viem.deployContract("JurorRegistry", [token.address]);
    const arbitration = await viem.deployContract("JurorArbitrationHarness", [registry.address]);
    const rogue = await viem.deployContract("JurorArbitrationHarness", [registry.address]);
    return { deployer, client, freelancer, outsider, treasury, jurors, token, registry, arbitration, rogue };
  }

  async function configuredFixture() {
    const f = await baseFixture();
    await f.registry.write.setArbitrationContract([f.arbitration.address]);
    return f;
  }

  type Fixture = Awaited<ReturnType<typeof baseFixture>>;
  type Wallet = Fixture["deployer"];
  const addressOf = (wallet: Wallet) => getAddress(wallet.account.address);

  async function enroll(f: Fixture, wallet: Wallet, amount: bigint) {
    await f.token.write.transfer([wallet.account.address, 5000n * unit]);
    await f.registry.write.registerJuror({ account: wallet.account });
    await f.token.write.approve([f.registry.address, maxUint256], { account: wallet.account });
    if (amount > 0n) await f.registry.write.depositStake([amount], { account: wallet.account });
  }

  async function poolFixture() {
    const f = await configuredFixture();
    for (const juror of f.jurors.slice(0, 6)) await enroll(f, juror, 300n * unit);
    return f;
  }

  async function minimumPoolFixture() {
    const f = await configuredFixture();
    for (const juror of f.jurors.slice(0, 3)) await enroll(f, juror, minimum);
    return f;
  }

  async function assignedFixture() {
    const f = await poolFixture();
    await f.arbitration.write.reserve([0n, f.client.account.address, f.freelancer.account.address]);
    return f;
  }

  async function assertAccounting(f: Fixture, wallets: Wallet[], surplus = 0n) {
    let deposited = 0n;
    let locked = 0n;
    for (const wallet of wallets) {
      const info = await f.registry.read.getJurorInfo([wallet.account.address]);
      assert.equal(info.availableStake + info.lockedStake, info.depositedStake);
      assert.equal(info.lockedStake, info.activeAssignments * minimum);
      assert.equal(BigInt((await f.registry.read.getActiveDisputes([wallet.account.address])).length), info.activeAssignments);
      assert.equal(await f.registry.read.isEligible([wallet.account.address]), info.registered && info.availableStake >= minimum);
      deposited += info.depositedStake;
      locked += info.lockedStake;
    }
    assert.equal(await f.registry.read.totalStaked(), deposited);
    assert.equal(await f.registry.read.totalLockedStake(), locked);
    assert.equal(await f.token.read.balanceOf([f.registry.address]), deposited + surplus);
    const available = await f.registry.read.getAvailableJurors();
    assert.equal(BigInt(available.length), await f.registry.read.availableJurorCount());
    assert.equal(new Set(available).size, available.length);
    assert.equal(await f.registry.read.selectionCursor(), available[0] ?? zeroAddress);
    for (const wallet of wallets) {
      assert.equal(available.includes(addressOf(wallet)), await f.registry.read.isEligible([wallet.account.address]));
    }
  }

  it("validates the token contract and six-decimal staking units", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    assert.equal(await f.registry.read.stakingToken(), getAddress(f.token.address));
    assert.equal(await f.registry.read.MIN_STAKE(), minimum);
    assert.equal(await f.registry.read.STAKE_PER_DISPUTE(), minimum);
    assert.equal(await f.registry.read.JURORS_PER_DISPUTE(), 3n);
    for (const tokenAddress of [zeroAddress, f.outsider.account.address]) {
      await viem.assertions.revertWithCustomError(viem.deployContract("JurorRegistry", [tokenAddress]), f.registry, "InvalidInput");
    }
    const wrongDecimals = await viem.deployContract("RegistryTestToken", [f.deployer.account.address, 18]);
    await viem.assertions.revertWithCustomError(viem.deployContract("JurorRegistry", [wrongDecimals.address]), f.registry, "InvalidInput");
  });

  it("starts unconfigured and rejects unauthorized assignment and release", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    assert.equal(await f.registry.read.arbitrationContract(), zeroAddress);
    assert.equal(await f.registry.read.arbitrationConfigurator(), addressOf(f.deployer));
    await viem.assertions.revertWithCustomError(
      f.arbitration.write.reserve([0n, f.client.account.address, f.freelancer.account.address]), f.registry, "Unauthorized",
    );
    await viem.assertions.revertWithCustomError(f.arbitration.write.release([0n]), f.registry, "Unauthorized");
  });

  it("only permits the deployer to configure a deployed arbitration contract once", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    for (const caller of [f.client, f.freelancer, f.outsider, f.jurors[0]]) {
      await viem.assertions.revertWithCustomError(
        f.registry.write.setArbitrationContract([f.arbitration.address], { account: caller.account }), f.registry, "Unauthorized",
      );
    }
    for (const value of [zeroAddress, f.deployer.account.address, f.registry.address]) {
      await viem.assertions.revertWithCustomError(f.registry.write.setArbitrationContract([value]), f.registry, "InvalidInput");
    }
    await viem.assertions.emitWithArgs(
      f.registry.write.setArbitrationContract([f.arbitration.address]), f.registry, "ArbitrationContractConfigured", [getAddress(f.arbitration.address)],
    );
    for (const value of [f.rogue.address, zeroAddress, f.arbitration.address]) {
      await viem.assertions.revertWithCustomError(f.registry.write.setArbitrationContract([value]), f.registry, "InvalidState");
    }
    assert.equal(await f.registry.read.arbitrationContract(), getAddress(f.arbitration.address));
  });

  it("registers once without conferring eligibility or spending tokens", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    const juror = f.jurors[0];
    await viem.assertions.emitWithArgs(
      f.registry.write.registerJuror({ account: juror.account }), f.registry, "JurorRegistered", [addressOf(juror)],
    );
    assert.equal(await f.registry.read.registeredJurorCount(), 1n);
    assert.equal(await f.registry.read.registeredJurors([0n]), addressOf(juror));
    assert.deepEqual(await f.registry.read.getJurorInfo([juror.account.address]), {
      registered: true, depositedStake: 0n, lockedStake: 0n, availableStake: 0n, activeAssignments: 0n,
    });
    assert.equal(await f.registry.read.isEligible([juror.account.address]), false);
    assert.deepEqual(await f.registry.read.getAvailableJurors(), []);
    await viem.assertions.revertWithCustomError(f.registry.write.registerJuror({ account: juror.account }), f.registry, "InvalidState");
    await assertAccounting(f, [juror]);
  });

  it("requires registration, a positive deposit, allowance and a funded wallet", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    const juror = f.jurors[0];
    await viem.assertions.revertWithCustomError(f.registry.write.depositStake([minimum], { account: juror.account }), f.registry, "InvalidState");
    await f.registry.write.registerJuror({ account: juror.account });
    await viem.assertions.revertWithCustomError(f.registry.write.depositStake([0n], { account: juror.account }), f.registry, "InvalidInput");
    await viem.assertions.revertWithCustomError(f.registry.write.depositStake([minimum], { account: juror.account }), f.token, "ERC20InsufficientAllowance");
    await f.token.write.approve([f.registry.address, minimum], { account: juror.account });
    await viem.assertions.revertWithCustomError(f.registry.write.depositStake([minimum], { account: juror.account }), f.token, "ERC20InsufficientBalance");
    await assertAccounting(f, [juror]);
    assert.deepEqual(await f.registry.read.getAvailableJurors(), []);
  });

  it("updates eligibility exactly at 100 mUSD and permits stake top-ups", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    const juror = f.jurors[0];
    await enroll(f, juror, minimum - 1n);
    assert.equal(await f.registry.read.isEligible([juror.account.address]), false);
    await viem.assertions.emitWithArgs(
      f.registry.write.depositStake([1n], { account: juror.account }), f.registry, "StakeDeposited", [addressOf(juror), 1n],
    );
    assert.equal(await f.registry.read.isEligible([juror.account.address]), true);
    await f.registry.write.depositStake([50n * unit], { account: juror.account });
    assert.equal(await f.registry.read.availableStake([juror.account.address]), 150n * unit);
    assert.deepEqual(await f.registry.read.getAvailableJurors(), [addressOf(juror)]);
    await assertAccounting(f, [juror]);
  });

  it("withdraws only the caller's own unlocked tokens and updates eligibility below minimum", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    const juror = f.jurors[0];
    await enroll(f, juror, 150n * unit);
    const before = await f.token.read.balanceOf([juror.account.address]);
    await viem.assertions.emitWithArgs(
      f.registry.write.withdrawStake([50n * unit + 1n], { account: juror.account }),
      f.registry, "StakeWithdrawn", [addressOf(juror), 50n * unit + 1n],
    );
    assert.equal(await f.token.read.balanceOf([juror.account.address]), before + 50n * unit + 1n);
    assert.equal(await f.registry.read.isEligible([juror.account.address]), false);
    assert.equal(await f.registry.read.selectionCursor(), zeroAddress);
    await f.registry.write.withdrawStake([minimum - 1n], { account: juror.account });
    await viem.assertions.revertWithCustomError(f.registry.write.withdrawStake([1n], { account: juror.account }), f.registry, "InsufficientAvailableStake");
    assert.equal((await f.registry.read.getJurorInfo([juror.account.address])).registered, true);
    await assertAccounting(f, [juror]);
  });

  it("rejects unregistered, zero and excessive withdrawals without using someone else's stake", async () => {
    const f = await networkHelpers.loadFixture(poolFixture);
    await viem.assertions.revertWithCustomError(f.registry.write.withdrawStake([1n], { account: f.outsider.account }), f.registry, "InvalidState");
    const juror = f.jurors[0];
    await viem.assertions.revertWithCustomError(f.registry.write.withdrawStake([0n], { account: juror.account }), f.registry, "InvalidInput");
    await viem.assertions.revertWithCustomError(f.registry.write.withdrawStake([301n * unit], { account: juror.account }), f.registry, "InsufficientAvailableStake");
    await f.registry.write.registerJuror({ account: f.outsider.account });
    await viem.assertions.revertWithCustomError(f.registry.write.withdrawStake([minimum], { account: f.outsider.account }), f.registry, "InsufficientAvailableStake");
    await assertAccounting(f, f.jurors.slice(0, 6));
  });

  it("previews deterministic rotation without modifying it and selects three distinct jurors", async () => {
    const f = await networkHelpers.loadFixture(poolFixture);
    const first = f.jurors.slice(0, 3).map(addressOf);
    const second = f.jurors.slice(3, 6).map(addressOf);
    for (let i = 0; i < 2; ++i) assert.deepEqual(await f.registry.read.previewJurors([f.client.account.address, f.freelancer.account.address]), first);
    assert.equal(await f.registry.read.selectionCursor(), first[0]);
    await f.arbitration.write.reserve([0n, f.client.account.address, f.freelancer.account.address]);
    assert.deepEqual((await f.registry.read.getAssignment([0n])).jurors, first);
    assert.deepEqual(await f.registry.read.previewJurors([f.client.account.address, f.freelancer.account.address]), second);
    await f.arbitration.write.reserve([1n, f.client.account.address, f.freelancer.account.address]);
    assert.deepEqual((await f.registry.read.getAssignment([1n])).jurors, second);
    assert.deepEqual(await f.registry.read.getAvailableJurors(), [...first, ...second]);
    await assertAccounting(f, f.jurors.slice(0, 6));
  });

  it("excludes registered, staked client and freelancer and wraps past their positions", async () => {
    const f = await networkHelpers.loadFixture(configuredFixture);
    // Both participants precede the three permitted candidates in the rotation.
    for (const wallet of [f.client, f.freelancer, ...f.jurors.slice(0, 3)]) await enroll(f, wallet, minimum);
    const expected = f.jurors.slice(0, 3).map(addressOf);
    assert.deepEqual(await f.registry.read.previewJurors([f.client.account.address, f.freelancer.account.address]), expected);
    await f.arbitration.write.reserve([4n, f.client.account.address, f.freelancer.account.address]);
    assert.deepEqual((await f.registry.read.getAssignment([4n])).jurors, expected);
    assert.deepEqual(await f.registry.read.getAvailableJurors(), [addressOf(f.client), addressOf(f.freelancer)]);
    assert.equal((await f.registry.read.getJurorInfo([f.client.account.address])).lockedStake, 0n);
    await assertAccounting(f, [f.client, f.freelancer, ...f.jurors.slice(0, 3)]);
  });

  it("rejects invalid participants without advancing rotation or recording an assignment", async () => {
    const f = await networkHelpers.loadFixture(poolFixture);
    const before = await f.registry.read.getAvailableJurors();
    for (const [client, freelancer] of [[zeroAddress, f.freelancer.account.address], [f.client.account.address, zeroAddress], [f.client.account.address, f.client.account.address]] as const) {
      await viem.assertions.revertWithCustomError(f.registry.read.previewJurors([client, freelancer]), f.registry, "InvalidInput");
      await viem.assertions.revertWithCustomError(f.arbitration.write.reserve([0n, client, freelancer]), f.registry, "InvalidInput");
    }
    assert.deepEqual(await f.registry.read.getAvailableJurors(), before);
    assert.equal((await f.registry.read.getAssignment([0n])).state, Assignment.NONE);
  });

  for (const count of [0, 1, 2]) {
    it(`fails atomically with ${count} eligible jurors`, async () => {
      const f = await networkHelpers.loadFixture(configuredFixture);
      for (const wallet of f.jurors.slice(0, count)) await enroll(f, wallet, minimum);
      const before = await f.registry.read.getAvailableJurors();
      await viem.assertions.revertWithCustomError(
        f.registry.read.previewJurors([f.client.account.address, f.freelancer.account.address]), f.registry, "InsufficientEligibleJurors",
      );
      await viem.assertions.revertWithCustomError(
        f.arbitration.write.reserve([0n, f.client.account.address, f.freelancer.account.address]), f.registry, "InsufficientEligibleJurors",
      );
      assert.equal((await f.registry.read.getAssignment([0n])).state, Assignment.NONE);
      assert.deepEqual(await f.registry.read.getAvailableJurors(), before);
      await assertAccounting(f, f.jurors.slice(0, count));
    });
  }

  it("fails atomically when party exclusions leave only two usable jurors", async () => {
    const f = await networkHelpers.loadFixture(configuredFixture);
    for (const wallet of [f.client, f.freelancer, ...f.jurors.slice(0, 2)]) await enroll(f, wallet, minimum);
    const before = await f.registry.read.getAvailableJurors();
    await viem.assertions.revertWithCustomError(
      f.arbitration.write.reserve([0n, f.client.account.address, f.freelancer.account.address]), f.registry, "InsufficientEligibleJurors",
    );
    assert.deepEqual(await f.registry.read.getAvailableJurors(), before);
    assert.equal((await f.registry.read.getAssignment([0n])).state, Assignment.NONE);
    await assertAccounting(f, [f.client, f.freelancer, ...f.jurors.slice(0, 2)]);
  });

  it("emits assignment and lock events and tracks active dispute IDs without transferring stake", async () => {
    const f = await networkHelpers.loadFixture(poolFixture);
    const before = await f.token.read.balanceOf([f.registry.address]);
    const tx = await f.arbitration.write.reserve([0n, f.client.account.address, f.freelancer.account.address]);
    for (const juror of f.jurors.slice(0, 3)) {
      await viem.assertions.emitWithArgs(tx, f.registry, "JurorAssigned", [0n, addressOf(juror)]);
      await viem.assertions.emitWithArgs(tx, f.registry, "StakeLocked", [0n, addressOf(juror), minimum]);
      assert.deepEqual(await f.registry.read.getJurorInfo([juror.account.address]), {
        registered: true, depositedStake: 300n * unit, lockedStake: minimum, availableStake: 200n * unit, activeAssignments: 1n,
      });
      assert.deepEqual(await f.registry.read.getActiveDisputes([juror.account.address]), [0n]);
      assert.equal(await f.registry.read.isAssigned([0n, juror.account.address]), true);
    }
    assert.equal(await f.token.read.balanceOf([f.registry.address]), before);
    assert.equal(await f.registry.read.isAssigned([0n, f.outsider.account.address]), false);
    assert.equal(await f.registry.read.isAssigned([99n, zeroAddress]), false);
    await assertAccounting(f, f.jurors.slice(0, 6));
  });

  it("only allows configured arbitration to reserve and release, including against jurors and deployer", async () => {
    const f = await networkHelpers.loadFixture(assignedFixture);
    for (const wallet of [f.deployer, f.client, f.freelancer, f.outsider, f.jurors[0]]) {
      await viem.assertions.revertWithCustomError(
        f.registry.write.reserveJurors([1n, f.client.account.address, f.freelancer.account.address], { account: wallet.account }), f.registry, "Unauthorized",
      );
      await viem.assertions.revertWithCustomError(f.registry.write.releaseJurors([0n], { account: wallet.account }), f.registry, "Unauthorized");
    }
    await viem.assertions.revertWithCustomError(f.rogue.write.reserve([1n, f.client.account.address, f.freelancer.account.address]), f.registry, "Unauthorized");
    await viem.assertions.revertWithCustomError(f.rogue.write.release([0n]), f.registry, "Unauthorized");
    await assertAccounting(f, f.jurors.slice(0, 6));
  });

  it("prevents assigning the same dispute again even after release", async () => {
    const f = await networkHelpers.loadFixture(assignedFixture);
    const original = await f.registry.read.getAssignment([0n]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.reserve([0n, f.client.account.address, f.freelancer.account.address]), f.registry, "InvalidState");
    await f.arbitration.write.release([0n]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.reserve([0n, f.freelancer.account.address, f.client.account.address]), f.registry, "InvalidState");
    const released = await f.registry.read.getAssignment([0n]);
    assert.deepEqual(released, { ...original, state: Assignment.RELEASED });
    assert.equal(await f.registry.read.isAssigned([0n, f.jurors[0].account.address]), true);
    await assertAccounting(f, f.jurors.slice(0, 6));
  });

  it("unlocks exactly once and rejects unknown disputes without changing other locks", async () => {
    const f = await networkHelpers.loadFixture(assignedFixture);
    await viem.assertions.revertWithCustomError(f.arbitration.write.release([999n]), f.registry, "InvalidState");
    const tx = await f.arbitration.write.release([0n]);
    for (const juror of f.jurors.slice(0, 3)) {
      await viem.assertions.emitWithArgs(tx, f.registry, "StakeUnlocked", [0n, addressOf(juror), minimum]);
      assert.deepEqual(await f.registry.read.getActiveDisputes([juror.account.address]), []);
    }
    await viem.assertions.emitWithArgs(tx, f.registry, "AssignmentReleased", [0n]);
    await viem.assertions.revertWithCustomError(f.arbitration.write.release([0n]), f.registry, "InvalidState");
    await assertAccounting(f, f.jurors.slice(0, 6));
  });

  it("allows unlocked withdrawals and top-ups while protecting assigned stake", async () => {
    const f = await networkHelpers.loadFixture(assignedFixture);
    const juror = f.jurors[0];
    await viem.assertions.revertWithCustomError(f.registry.write.withdrawStake([200n * unit + 1n], { account: juror.account }), f.registry, "InsufficientAvailableStake");
    await f.registry.write.withdrawStake([200n * unit], { account: juror.account });
    assert.deepEqual(await f.registry.read.getJurorInfo([juror.account.address]), {
      registered: true, depositedStake: minimum, lockedStake: minimum, availableStake: 0n, activeAssignments: 1n,
    });
    assert.equal(await f.registry.read.isEligible([juror.account.address]), false);
    await f.registry.write.depositStake([minimum], { account: juror.account });
    assert.equal(await f.registry.read.isEligible([juror.account.address]), true);
    assert.deepEqual(await f.registry.read.getAvailableJurors(), [
      ...f.jurors.slice(3, 6).map(addressOf), ...f.jurors.slice(1, 3).map(addressOf), addressOf(juror),
    ]);
    await f.arbitration.write.release([0n]);
    assert.equal(await f.registry.read.availableStake([juror.account.address]), 200n * unit);
    await f.registry.write.withdrawStake([200n * unit], { account: juror.account });
    await assertAccounting(f, f.jurors.slice(0, 6));
  });

  it("exhausts a minimum-stake pool without duplication and restores it on release", async () => {
    const f = await networkHelpers.loadFixture(minimumPoolFixture);
    await f.arbitration.write.reserve([0n, f.client.account.address, f.freelancer.account.address]);
    assert.deepEqual(await f.registry.read.getAvailableJurors(), []);
    assert.equal(await f.registry.read.selectionCursor(), zeroAddress);
    await viem.assertions.revertWithCustomError(
      f.arbitration.write.reserve([1n, f.client.account.address, f.freelancer.account.address]), f.registry, "InsufficientEligibleJurors",
    );
    for (const juror of f.jurors.slice(0, 3)) {
      await viem.assertions.revertWithCustomError(f.registry.write.withdrawStake([1n], { account: juror.account }), f.registry, "InsufficientAvailableStake");
    }
    await f.arbitration.write.release([0n]);
    assert.deepEqual(await f.registry.read.getAvailableJurors(), f.jurors.slice(0, 3).map(addressOf));
    await f.arbitration.write.reserve([1n, f.client.account.address, f.freelancer.account.address]);
    await assertAccounting(f, f.jurors.slice(0, 3));
  });

  it("supports concurrent disputes only with separate 100 mUSD locks and releases them independently", async () => {
    const f = await networkHelpers.loadFixture(minimumPoolFixture);
    for (const juror of f.jurors.slice(0, 3)) await f.registry.write.depositStake([minimum], { account: juror.account });
    for (const id of [10n, 11n]) await f.arbitration.write.reserve([id, f.client.account.address, f.freelancer.account.address]);
    for (const juror of f.jurors.slice(0, 3)) {
      assert.equal((await f.registry.read.getJurorInfo([juror.account.address])).lockedStake, 200n * unit);
      assert.deepEqual(await f.registry.read.getActiveDisputes([juror.account.address]), [10n, 11n]);
    }
    await f.arbitration.write.release([10n]);
    for (const juror of f.jurors.slice(0, 3)) {
      assert.equal((await f.registry.read.getJurorInfo([juror.account.address])).lockedStake, minimum);
      assert.deepEqual(await f.registry.read.getActiveDisputes([juror.account.address]), [11n]);
      await f.registry.write.withdrawStake([minimum], { account: juror.account });
    }
    await assertAccounting(f, f.jurors.slice(0, 3));
    await f.arbitration.write.release([11n]);
    for (const juror of f.jurors.slice(0, 3)) await f.registry.write.withdrawStake([minimum], { account: juror.account });
    await assertAccounting(f, f.jurors.slice(0, 3));
    assert.equal(await f.registry.read.totalStaked(), 0n);
  });

  it("skips unstaked registrations and handles cursor, middle, tail and singleton removals", async () => {
    const f = await networkHelpers.loadFixture(configuredFixture);
    for (const juror of f.jurors.slice(0, 8)) await enroll(f, juror, 0n);
    for (const juror of f.jurors.slice(0, 4)) await f.registry.write.depositStake([minimum], { account: juror.account });
    for (const index of [1, 3, 0, 2]) {
      await f.registry.write.withdrawStake([minimum], { account: f.jurors[index].account });
      await assertAccounting(f, f.jurors.slice(0, 8));
    }
    assert.equal(await f.registry.read.registeredJurorCount(), 8n);
    assert.equal(await f.registry.read.selectionCursor(), zeroAddress);
    for (const index of [3, 1, 0]) await f.registry.write.depositStake([minimum], { account: f.jurors[index].account });
    assert.deepEqual(await f.registry.read.getAvailableJurors(), [3, 1, 0].map(i => addressOf(f.jurors[i])));
    await f.arbitration.write.reserve([0n, f.client.account.address, f.freelancer.account.address]);
    await assertAccounting(f, f.jurors.slice(0, 8));
  });

  it("returns explicit empty state for unknown jurors and disputes", async () => {
    const f = await networkHelpers.loadFixture(baseFixture);
    assert.deepEqual(await f.registry.read.getJurorInfo([f.outsider.account.address]), {
      registered: false, depositedStake: 0n, lockedStake: 0n, availableStake: 0n, activeAssignments: 0n,
    });
    assert.deepEqual(await f.registry.read.getAssignment([77n]), { client: zeroAddress, freelancer: zeroAddress, jurors: [zeroAddress, zeroAddress, zeroAddress], state: Assignment.NONE });
    assert.deepEqual(await f.registry.read.getActiveDisputes([f.outsider.account.address]), []);
    assert.equal(await f.registry.read.isAssigned([77n, f.outsider.account.address]), false);
  });

  it("keeps unsolicited token surplus outside juror liabilities and withdrawals", async () => {
    const f = await networkHelpers.loadFixture(minimumPoolFixture);
    await f.token.write.transfer([f.registry.address, 17n * unit]);
    await f.arbitration.write.reserve([0n, f.client.account.address, f.freelancer.account.address]);
    await f.arbitration.write.release([0n]);
    for (const juror of f.jurors.slice(0, 3)) {
      await f.registry.write.withdrawStake([minimum], { account: juror.account });
      await viem.assertions.revertWithCustomError(f.registry.write.withdrawStake([1n], { account: juror.account }), f.registry, "InsufficientAvailableStake");
    }
    await assertAccounting(f, f.jurors.slice(0, 3), 17n * unit);
  });

  it("matches a separate rotation and accounting model across mixed staking and assignment operations", async () => {
    const f = await networkHelpers.loadFixture(poolFixture);
    const wallets = f.jurors.slice(0, 6);
    const addresses = wallets.map(addressOf);
    const model = new Map(addresses.map(address => [address, { deposited: 300n * unit, locked: 0n, active: new Set<bigint>() }]));
    const cases = new Map<bigint, { jurors: Address[]; active: boolean }>();
    let pool = [...addresses];
    let nextCase = 0n;
    let seed = 0x5eed;
    const operationCounts = [0, 0, 0, 0];
    let reservations = 0;
    let releases = 0;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 8;
    };
    const sync = (address: Address) => {
      const info = model.get(address)!;
      const present = pool.includes(address);
      if (info.deposited - info.locked >= minimum) {
        if (!present) pool.push(address);
      } else if (present) pool = pool.filter(candidate => candidate !== address);
    };

    for (let step = 0; step < 48; ++step) {
      // Fixed seed makes failures reproducible; this is test input generation, not protocol randomness.
      const operation = next() % 4;
      ++operationCounts[operation];
      const wallet = wallets[next() % wallets.length];
      const address = addressOf(wallet);
      const info = model.get(address)!;
      if (operation === 0) {
        const amount = BigInt(1 + next() % 150) * unit + BigInt(next() % 2);
        await f.registry.write.depositStake([amount], { account: wallet.account });
        info.deposited += amount;
        sync(address);
      } else if (operation === 1) {
        const available = info.deposited - info.locked;
        if (available === 0n) {
          await viem.assertions.revertWithCustomError(f.registry.write.withdrawStake([1n], { account: wallet.account }), f.registry, "InsufficientAvailableStake");
        } else {
          const amount = next() % 2 === 0 ? available : (available / 2n || 1n);
          await f.registry.write.withdrawStake([amount], { account: wallet.account });
          info.deposited -= amount;
          sync(address);
        }
      } else if (operation === 2) {
        const id = nextCase++;
        const client = next() % 2 === 0 ? address : addressOf(f.client);
        const freelancer = addressOf(f.freelancer);
        const selected = pool.filter(candidate => candidate !== client && candidate !== freelancer).slice(0, 3);
        if (selected.length < 3) {
          await viem.assertions.revertWithCustomError(f.arbitration.write.reserve([id, client, freelancer]), f.registry, "InsufficientEligibleJurors");
          assert.equal((await f.registry.read.getAssignment([id])).state, Assignment.NONE);
        } else {
          assert.deepEqual(await f.registry.read.previewJurors([client, freelancer]), selected);
          await f.arbitration.write.reserve([id, client, freelancer]);
          ++reservations;
          const last = pool.indexOf(selected[2]);
          pool = [...pool.slice(last + 1), ...pool.slice(0, last + 1)];
          cases.set(id, { jurors: selected, active: true });
          for (const juror of selected) {
            const state = model.get(juror)!;
            state.locked += minimum;
            state.active.add(id);
            sync(juror);
          }
          assert.deepEqual(await f.registry.read.getAssignment([id]), { client, freelancer, jurors: selected, state: Assignment.ACTIVE });
        }
      } else {
        const active = [...cases].filter(([, assignment]) => assignment.active);
        if (active.length === 0) {
          await viem.assertions.revertWithCustomError(f.arbitration.write.release([999_999n]), f.registry, "InvalidState");
        } else {
          const [id, assignment] = active[next() % active.length];
          await f.arbitration.write.release([id]);
          ++releases;
          assignment.active = false;
          for (const juror of assignment.jurors) {
            const state = model.get(juror)!;
            state.locked -= minimum;
            state.active.delete(id);
            sync(juror);
          }
          assert.equal((await f.registry.read.getAssignment([id])).state, Assignment.RELEASED);
        }
      }
      assert.deepEqual(await f.registry.read.getAvailableJurors(), pool, `rotation at step ${step}`);
      await assertAccounting(f, wallets);
      for (const juror of addresses) {
        const expected = model.get(juror)!;
        const actual = await f.registry.read.getJurorInfo([juror]);
        assert.equal(actual.depositedStake, expected.deposited);
        assert.equal(actual.lockedStake, expected.locked);
        assert.deepEqual(new Set(await f.registry.read.getActiveDisputes([juror])), expected.active);
      }
    }
    assert.ok(operationCounts.every(count => count > 0), "exercise every operation type");
    assert.ok(reservations > 0 && releases > 0, "exercise successful reservation and release");
  });

  it("keeps escrow, treasury and juror custody independent during normal escrow settlement", async () => {
    const f = await networkHelpers.loadFixture(assignedFixture);
    const escrow = await viem.deployContract("TrustEscrow", [f.token.address, f.treasury.account.address]);
    const publicClient = await viem.getPublicClient();
    const due = (await publicClient.getBlock()).timestamp + 14n * 24n * 3600n;
    const hash = `0x${"33".repeat(32)}` as `0x${string}`;
    await escrow.write.createProject([f.freelancer.account.address, [400n * unit], [due], hash]);
    await f.token.write.approve([escrow.address, 400n * unit]);
    await escrow.write.fundProject([0n]);
    await escrow.write.acceptProject([0n], { account: f.freelancer.account });
    await escrow.write.submitMilestone([0n, 0n, hash], { account: f.freelancer.account });
    const before = await f.registry.read.getAssignment([0n]);
    await escrow.write.approveMilestone([0n, 0n]);
    assert.equal(await f.token.read.balanceOf([f.freelancer.account.address]), 396n * unit);
    assert.equal(await f.token.read.balanceOf([f.treasury.account.address]), 4n * unit);
    assert.equal(await escrow.read.totalEscrowLiability(), 0n);
    assert.deepEqual(await f.registry.read.getAssignment([0n]), before);
    await assertAccounting(f, f.jurors.slice(0, 6));
    await f.arbitration.write.release([0n]);
    assert.equal(await f.token.read.balanceOf([escrow.address]), 0n);
    assert.equal(await f.token.read.balanceOf([f.treasury.account.address]), 4n * unit);
    await assertAccounting(f, f.jurors.slice(0, 6));
  });

  it("deploys the local Phase 2B module with the shared token and arbitration disabled", async () => {
    const { token, escrow, registry } = await ignition.deploy(phase2B);
    assert.equal(await registry.read.stakingToken(), getAddress(token.address));
    assert.equal(await escrow.read.paymentToken(), getAddress(token.address));
    assert.equal(await registry.read.arbitrationContract(), zeroAddress);
    assert.equal(await escrow.read.arbitrationContract(), zeroAddress);
    assert.equal(await registry.read.totalStaked(), 0n);
  });

  async function tokenFixture() {
    const [deployer, juror] = await viem.getWalletClients();
    const token = await viem.deployContract("RegistryTestToken", [deployer.account.address, 6]);
    const registry = await viem.deployContract("JurorRegistry", [token.address]);
    await token.write.transfer([juror.account.address, 500n * unit]);
    await registry.write.registerJuror({ account: juror.account });
    await token.write.approve([registry.address, maxUint256], { account: juror.account });
    return { deployer, juror, token, registry };
  }

  it("rolls back stake and pool changes when a deposit returns false", async () => {
    const f = await networkHelpers.loadFixture(tokenFixture);
    await f.token.write.setTransferMode([1, zeroAddress, "0x"]);
    await viem.assertions.revertWithCustomError(f.registry.write.depositStake([minimum], { account: f.juror.account }), f.registry, "SafeERC20FailedOperation");
    assert.equal(await f.registry.read.totalStaked(), 0n);
    assert.equal(await f.registry.read.availableStake([f.juror.account.address]), 0n);
    assert.equal(await f.registry.read.selectionCursor(), zeroAddress);
  });

  it("rejects fee-on-transfer deposits even when surplus could otherwise mask the shortfall", async () => {
    const f = await networkHelpers.loadFixture(tokenFixture);
    await f.token.write.transfer([f.registry.address, 10n * unit]);
    await f.token.write.setTransferMode([2, zeroAddress, "0x"]);
    await viem.assertions.revertWithCustomError(f.registry.write.depositStake([minimum], { account: f.juror.account }), f.registry, "InvalidInput");
    assert.equal(await f.registry.read.totalStaked(), 0n);
    assert.equal(await f.token.read.balanceOf([f.registry.address]), 10n * unit);
    assert.equal(await f.token.read.balanceOf([f.juror.account.address]), 500n * unit);
    assert.deepEqual(await f.registry.read.getAvailableJurors(), []);
  });

  it("rolls back a failed withdrawal, including eligibility and cursor changes", async () => {
    const f = await networkHelpers.loadFixture(tokenFixture);
    await f.registry.write.depositStake([minimum], { account: f.juror.account });
    const before = await f.registry.read.getJurorInfo([f.juror.account.address]);
    await f.token.write.setTransferMode([1, zeroAddress, "0x"]);
    await viem.assertions.revertWithCustomError(f.registry.write.withdrawStake([minimum], { account: f.juror.account }), f.registry, "SafeERC20FailedOperation");
    assert.deepEqual(await f.registry.read.getJurorInfo([f.juror.account.address]), before);
    assert.equal(await f.registry.read.totalStaked(), minimum);
    assert.deepEqual(await f.registry.read.getAvailableJurors(), [addressOf(f.juror)]);
    assert.equal(await f.token.read.balanceOf([f.registry.address]), minimum);
  });

  it("blocks token callback reentrancy during deposits and withdrawals", async () => {
    const f = await networkHelpers.loadFixture(tokenFixture);
    const data = encodeFunctionData({ abi: f.registry.abi, functionName: "registerJuror" });
    await f.token.write.setTransferMode([3, f.registry.address, data]);
    await viem.assertions.revertWithCustomError(f.registry.write.depositStake([minimum], { account: f.juror.account }), f.registry, "ReentrancyGuardReentrantCall");
    assert.equal(await f.registry.read.totalStaked(), 0n);
    await f.token.write.setTransferMode([0, zeroAddress, "0x"]);
    await f.registry.write.depositStake([minimum], { account: f.juror.account });
    await f.token.write.setTransferMode([3, f.registry.address, data]);
    await viem.assertions.revertWithCustomError(f.registry.write.withdrawStake([minimum], { account: f.juror.account }), f.registry, "ReentrancyGuardReentrantCall");
    assert.equal(await f.registry.read.totalStaked(), minimum);
    assert.deepEqual(await f.registry.read.getAvailableJurors(), [addressOf(f.juror)]);
    assert.equal((await f.registry.read.getJurorInfo([f.token.address])).registered, false);
  });

  it("blocks reentrant reservation and release even from the authorized arbitration address", async () => {
    const f = await networkHelpers.loadFixture(tokenFixture);
    await f.registry.write.setArbitrationContract([f.token.address]);
    const reserve = encodeFunctionData({ abi: f.registry.abi, functionName: "reserveJurors", args: [0n, f.deployer.account.address, f.juror.account.address] });
    await f.token.write.setTransferMode([3, f.registry.address, reserve]);
    await viem.assertions.revertWithCustomError(f.registry.write.depositStake([minimum], { account: f.juror.account }), f.registry, "ReentrancyGuardReentrantCall");
    assert.equal((await f.registry.read.getAssignment([0n])).state, Assignment.NONE);
    await f.token.write.setTransferMode([0, zeroAddress, "0x"]);
    await f.registry.write.depositStake([minimum], { account: f.juror.account });
    const release = encodeFunctionData({ abi: f.registry.abi, functionName: "releaseJurors", args: [0n] });
    await f.token.write.setTransferMode([3, f.registry.address, release]);
    await viem.assertions.revertWithCustomError(f.registry.write.withdrawStake([minimum], { account: f.juror.account }), f.registry, "ReentrancyGuardReentrantCall");
    assert.equal(await f.registry.read.totalStaked(), minimum);
    assert.equal(await f.registry.read.totalLockedStake(), 0n);
    assert.deepEqual(await f.registry.read.getAvailableJurors(), [addressOf(f.juror)]);
  });
});
