import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress, zeroAddress, type Address, type Hex } from "viem";
import phase1 from "../ignition/modules/Phase1.js";
import phase2B from "../ignition/modules/Phase2B.js";
import phase2C from "../ignition/modules/Phase2C.js";
import phase2D from "../ignition/modules/Phase2D.js";
import { CONTRACT_NAMES, abis, assertDeploymentOnChain, getContracts, parseLocalDeployment } from "../packages/contracts/src/index.js";
import { abiHash, assertRuntimeMatches, buildInventory, readCompiledContracts } from "../scripts/lib/artifacts.js";
import { deploymentPath, readIgnitionAddresses, verifyDeployment, type ProtocolAddresses } from "../scripts/lib/deployment.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const unit = 10n ** 6n;
const hour = 3600n;
const hash = `0x${"77".repeat(32)}` as Hex;

describe("TrustLayer Phase 2E deployed protocol and frontend artifacts", async () => {
  const compiled = await readCompiledContracts(root);

  async function deployed() {
    const connection = await network.create();
    const client = await connection.viem.getPublicClient();
    assert.equal(await client.getBlockNumber(), 0n);
    const protocol = await connection.ignition.deploy(phase2D);
    const addresses: ProtocolAddresses = { MockUSD: protocol.token.address, TrustEscrow: protocol.escrow.address,
      JurorRegistry: protocol.registry.address, DisputeArbitration: protocol.arbitration.address, ProtocolTreasury: protocol.treasury.address };
    const manifest = await verifyDeployment(connection.viem, addresses, compiled, {
      deploymentId: "phase2e-test", rpcUrl: "http://127.0.0.1:8545", ephemeral: true, fresh: true,
    });
    return { connection, client, protocol, addresses, manifest };
  }

  for (const outcome of [
    { name: "freelancer victory", votes: [1, 1, 2] as const, bps: 10000, fallback: false, freelancer: 990n, client: 985n, service: 10n },
    { name: "client victory", votes: [2, 2, 1] as const, bps: 0, fallback: false, freelancer: 396n, client: 1585n, service: 4n },
    { name: "split majority", votes: [3, 3, 1] as const, bps: 5000, fallback: false, freelancer: 693n, client: 1285n, service: 7n },
    { name: "no-majority fallback", votes: [1, 2, 3] as const, bps: 5000, fallback: true, freelancer: 693n, client: 1285n, service: 7n },
  ]) {
    it(`executes normal milestone payment then second-milestone ${outcome.name} through deployed production contracts`, async () => {
      const { connection, client: rpc, protocol: p, manifest } = await deployed();
      const [deployer, customer, worker, juror1, juror2, juror3, finalizer] = await connection.viem.getWalletClients();
      const jury = [juror1, juror2, juror3];
      async function mined(transaction: Promise<Hex>) {
        const receipt = await rpc.waitForTransactionReceipt({ hash: await transaction });
        assert.equal(receipt.status, "success");
        return receipt.transactionHash;
      }
      const frontend = getContracts(manifest, await rpc.getChainId());
      assert.equal(await rpc.readContract({ ...frontend.MockUSD, functionName: "decimals" }), 6);
      await mined(p.token.write.transfer([customer.account.address, 2000n * unit]));
      for (const juror of jury) {
        await mined(p.token.write.transfer([juror.account.address, 200n * unit]));
        await mined(p.registry.write.registerJuror({ account: juror.account }));
        await mined(p.token.write.approve([p.registry.address, 200n * unit], { account: juror.account }));
        await mined(p.registry.write.depositStake([200n * unit], { account: juror.account }));
      }
      const now = (await rpc.getBlock()).timestamp;
      await mined(p.escrow.write.createProject([worker.account.address, [400n * unit, 600n * unit], [now + 14n * 24n * hour, now + 21n * 24n * hour], hash], { account: customer.account }));
      await mined(p.token.write.approve([p.escrow.address, 1000n * unit], { account: customer.account }));
      await mined(p.escrow.write.fundProject([0n], { account: customer.account }));
      await mined(p.escrow.write.acceptProject([0n], { account: worker.account }));
      await mined(p.escrow.write.submitMilestone([0n, 0n, hash], { account: worker.account }));
      const approved = await mined(p.escrow.write.approveMilestone([0n, 0n], { account: customer.account }));
      await connection.viem.assertions.emitWithArgs(approved, p.treasury, "ServiceFeeDeposited", [0n, 0n, 4n * unit]);
      assert.equal(await p.token.read.balanceOf([worker.account.address]), 396n * unit);
      assert.equal(await p.treasury.read.availableRevenue(), 4n * unit);
      assert.equal(await p.token.read.balanceOf([p.escrow.address]), 600n * unit);
      assert.equal(await p.escrow.read.totalEscrowLiability(), 600n * unit);
      assert.equal((await p.escrow.read.projects([0n]))[7], 1);

      await mined(p.escrow.write.submitMilestone([0n, 1n, hash], { account: worker.account }));
      await mined(p.token.write.approve([p.arbitration.address, 15n * unit], { account: customer.account }));
      await mined(p.arbitration.write.openDispute([0n, 1n, hash], { account: customer.account }));
      const dispute = await p.arbitration.read.getDispute([0n]);
      assert.deepEqual(dispute.jurors, jury.map(juror => getAddress(juror.account.address)));
      assert.equal(new Set(dispute.jurors).size, 3);
      assert.ok(!dispute.jurors.includes(getAddress(customer.account.address)) && !dispute.jurors.includes(getAddress(worker.account.address)));
      assert.equal(dispute.responseDeadline, dispute.openedAt + 12n * hour);
      assert.equal(dispute.votingDeadline, dispute.responseDeadline + 24n * hour);
      assert.equal((await p.escrow.read.getDisputeContext([0n, 1n])).milestoneState, 2);
      assert.equal(await p.arbitration.read.totalDisputeFeesHeld(), 15n * unit);
      assert.equal(await p.registry.read.totalLockedStake(), 300n * unit);
      for (const juror of jury) {
        const info = await p.registry.read.getJurorInfo([juror.account.address]);
        assert.deepEqual([info.depositedStake, info.lockedStake, info.availableStake, info.activeAssignments], [200n * unit, 100n * unit, 100n * unit, 1n]);
      }
      await connection.networkHelpers.time.increaseTo(dispute.responseDeadline);
      for (let index = 0; index < jury.length; ++index) await mined(p.arbitration.write.castVote([0n, outcome.votes[index]], { account: jury[index].account }));
      await connection.networkHelpers.time.increaseTo(dispute.votingDeadline + 1n);
      const settled = await mined(p.arbitration.write.finalizeDispute([0n], { account: finalizer.account }));
      await connection.viem.assertions.emitWithArgs(settled, p.arbitration, "JurorRewardsReserved", [0n, 12n * unit]);
      assert.equal(await p.registry.read.totalLockedStake(), 0n);
      assert.equal(await p.registry.read.totalStaked(), 600n * unit);
      assert.equal(await p.arbitration.read.reservedJurorRewards(), 12n * unit);
      assert.equal(await p.treasury.read.totalDisputeFeesReceived(), 3n * unit);
      const verdict = await p.arbitration.read.getDispute([0n]);
      assert.equal(verdict.freelancerBps, outcome.bps);
      assert.equal(verdict.fallbackApplied, outcome.fallback);
      for (const juror of jury) {
        assert.equal(await p.arbitration.read.claimableReward([0n, juror.account.address]), 4n * unit);
        await mined(p.arbitration.write.claimJurorReward([0n], { account: juror.account }));
        assert.equal(await p.token.read.balanceOf([juror.account.address]), 4n * unit);
        const info = await p.registry.read.getJurorInfo([juror.account.address]);
        assert.deepEqual([info.depositedStake, info.lockedStake, info.availableStake], [200n * unit, 0n, 200n * unit]);
      }
      assert.equal(await p.token.read.balanceOf([worker.account.address]), outcome.freelancer * unit);
      assert.equal(await p.token.read.balanceOf([customer.account.address]), outcome.client * unit);
      assert.equal(await p.treasury.read.totalServiceFeesReceived(), outcome.service * unit);
      assert.equal(await p.treasury.read.availableRevenue(), (outcome.service + 3n) * unit);
      assert.equal(await p.escrow.read.totalEscrowLiability(), 0n);
      assert.equal(await p.token.read.balanceOf([p.escrow.address]), 0n);
      assert.equal((await p.escrow.read.projects([0n]))[9], 3);
      assert.equal(await p.arbitration.read.totalDisputeFeesHeld(), 0n);
      assert.equal(await p.arbitration.read.totalJurorRewardsClaimed(), 12n * unit);
      assert.equal(await p.arbitration.read.totalProtocolFeesTransferred(), 3n * unit);
      assert.equal(await p.token.read.allowance([p.escrow.address, p.treasury.address]), 0n);
      assert.equal(await p.token.read.allowance([p.arbitration.address, p.treasury.address]), 0n);
      const holders = [deployer.account.address, customer.account.address, worker.account.address, ...jury.map(juror => juror.account.address),
        p.escrow.address, p.registry.address, p.arbitration.address, p.treasury.address];
      const balances = await Promise.all(holders.map(address => p.token.read.balanceOf([address])));
      assert.equal(balances.reduce((total, balance) => total + balance, 0n), await p.token.read.totalSupply());
      await assertDeploymentOnChain(rpc, manifest);
    });
  }

  it("reproduces all Phase2D addresses and runtime hashes on independent fresh chains", async () => {
    const first = await deployed();
    const second = await deployed();
    assert.deepEqual(first.addresses, second.addresses);
    assert.deepEqual(first.manifest.contracts, second.manifest.contracts);
    assert.deepEqual(first.manifest.verification.configurationEventCounts, [1, 1, 1, 1]);
  });

  it("keeps the documented Phase1 deployment usable without arbitration or a treasury vault", async () => {
    const connection = await network.create();
    const [deployer] = await connection.viem.getWalletClients();
    const { token, escrow } = await connection.ignition.deploy(phase1);
    assert.equal(await escrow.read.paymentToken(), getAddress(token.address));
    assert.equal(await escrow.read.treasury(), getAddress(deployer.account.address));
    assert.equal(await escrow.read.usesProtocolTreasury(), false);
    assert.equal(await escrow.read.arbitrationContract(), zeroAddress);
  });

  it("keeps the documented Phase2B deployment usable with an unconfigured juror registry", async () => {
    const connection = await network.create();
    const { token, escrow, registry } = await connection.ignition.deploy(phase2B);
    assert.equal(await registry.read.stakingToken(), getAddress(token.address));
    assert.equal(await registry.read.arbitrationContract(), zeroAddress);
    assert.equal(await escrow.read.arbitrationContract(), zeroAddress);
    assert.equal(await escrow.read.usesProtocolTreasury(), false);
  });

  it("keeps the documented Phase2C deployment usable in explicit legacy fee-retention mode", async () => {
    const connection = await network.create();
    const { escrow, registry, arbitration } = await connection.ignition.deploy(phase2C);
    assert.equal(await arbitration.read.isConfigured(), true);
    assert.equal(await escrow.read.arbitrationContract(), getAddress(arbitration.address));
    assert.equal(await registry.read.arbitrationContract(), getAddress(arbitration.address));
    assert.equal(await arbitration.read.protocolTreasury(), zeroAddress);
    assert.equal(await arbitration.read.totalDisputeFeesHeld(), 0n);
  });

  it("exports exact compiled production ABIs and a complete real method/event inventory", async () => {
    const inventory = JSON.parse(await readFile(resolve(root, "packages/contracts/generated/inventory.json"), "utf8"));
    assert.deepEqual(inventory, buildInventory(compiled));
    for (const name of CONTRACT_NAMES) {
      const exported = JSON.parse(await readFile(resolve(root, "packages/contracts/generated/abi", `${name}.json`), "utf8"));
      assert.deepEqual(exported, compiled[name].abi);
      assert.deepEqual(abis[name], compiled[name].abi);
      assert.equal(inventory[name].abiHash, abiHash(abis[name]));
    }
    assert.equal(Object.keys(inventory).length, 5);
  });

  it("rejects wrong-chain wallets and malformed, incomplete or ABI-stale address exports", async () => {
    const { manifest } = await deployed();
    assert.throws(() => getContracts(manifest, 11155111), /Wallet chain/);
    assert.throws(() => parseLocalDeployment({ ...manifest, chainId: 1 }), /Unsupported deployment/);
    assert.throws(() => parseLocalDeployment({ ...manifest, rpcUrl: "https://example.com" }), /loopback/);
    const zero = { ...manifest, contracts: { ...manifest.contracts, MockUSD: { ...manifest.contracts.MockUSD, address: zeroAddress } } };
    assert.throws(() => parseLocalDeployment(zero), /Zero deployment/);
    const duplicate = { ...manifest, contracts: { ...manifest.contracts, MockUSD: { ...manifest.contracts.MockUSD, address: manifest.contracts.TrustEscrow.address } } };
    assert.throws(() => parseLocalDeployment(duplicate), /Duplicate deployment/);
    const stale = { ...manifest, contracts: { ...manifest.contracts, MockUSD: { ...manifest.contracts.MockUSD, abiHash: `0x${"00".repeat(32)}` } } };
    assert.throws(() => parseLocalDeployment(stale), /ABI mismatch/);
    assert.throws(() => parseLocalDeployment({ ...manifest, contracts: {} }));
  });

  it("detects reset/empty chains and changed deployed code instead of trusting chain ID 31337", async () => {
    const { connection, client, manifest, protocol } = await deployed();
    await assertDeploymentOnChain(client, manifest);
    const empty = await network.create();
    await assert.rejects(assertDeploymentOnChain(await empty.viem.getPublicClient(), manifest));
    await connection.networkHelpers.setCode(protocol.token.address, "0x00");
    await assert.rejects(assertDeploymentOnChain(client, manifest), /code changed/);
  });

  it("rejects legacy journals, unsafe deployment paths and mislabelled deployed contracts", async () => {
    assert.throws(() => deploymentPath(root, "../outside"), /Invalid Ignition/);
    assert.throws(() => readIgnitionAddresses({ "TrustLayerPhase1#MockUSD": zeroAddress }), /Missing Phase2D/);
    const { connection, addresses } = await deployed();
    const swapped: ProtocolAddresses = { ...addresses, MockUSD: addresses.TrustEscrow, TrustEscrow: addresses.MockUSD };
    await assert.rejects(verifyDeployment(connection.viem, swapped, compiled, { deploymentId: "wrong-code", rpcUrl: "http://127.0.0.1:8545", ephemeral: true, fresh: true }), /Runtime bytecode mismatch/);
  });

  it("detects bytecode tampering outside compiler-declared immutable references", async () => {
    const { client, addresses } = await deployed();
    const code = await client.getCode({ address: addresses.MockUSD });
    assert.ok(code);
    assertRuntimeMatches(code, compiled.MockUSD);
    const corrupted = `0x${code.slice(2, 4) === "00" ? "01" : "00"}${code.slice(4)}` as Hex;
    assert.throws(() => assertRuntimeMatches(corrupted, compiled.MockUSD), /Runtime bytecode mismatch/);
  });
});
