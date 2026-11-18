import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import { getAddress, zeroAddress } from "viem";
import phase2D from "../ignition/modules/Phase2D.js";
import { readCompiledContracts } from "../scripts/lib/artifacts.js";
import { verifyDeployment } from "../scripts/lib/deployment.js";
import { assertProvisioningRpc, PROVISION_RPC_URL, PROVISION_TARGETS, provisioningRecipients, provisionLocalTokens, TOKEN_SUPPLY, type ProvisioningEnvironment } from "../scripts/lib/provisioning.js";

describe("Local-only MockUSD provisioning", async () => {
  const connection = await network.create();
  after(async () => { await connection.close(); });
  const compiled = await readCompiledContracts(fileURLToPath(new URL("../", import.meta.url)));
  async function baseFixture() {
    const p = await connection.ignition.deploy(phase2D);
    const wallets = await connection.viem.getWalletClients();
    const client = await connection.viem.getPublicClient();
    const env: ProvisioningEnvironment = Object.fromEntries(PROVISION_TARGETS.map((r, i) => [r.env, wallets[i + 1].account.address]));
    const manifest = await verifyDeployment(connection.viem, { MockUSD: p.token.address, TrustEscrow: p.escrow.address, JurorRegistry: p.registry.address, DisputeArbitration: p.arbitration.address, ProtocolTreasury: p.treasury.address }, compiled, { deploymentId: "local-provision-test", rpcUrl: PROVISION_RPC_URL, ephemeral: false, fresh: true });
    const messages: string[] = [];
    return { p, wallets, client, env, manifest, messages };
  }
  async function fixture() { return connection.networkHelpers.loadFixture(baseFixture); }
  async function run(f: Awaited<ReturnType<typeof fixture>>, env = f.env) {
    return provisionLocalTokens(connection.viem, f.manifest, compiled.MockUSD, env, PROVISION_RPC_URL, (message) => f.messages.push(message));
  }
  it("transfers the five exact targets from the original mint holder, confirms every hash and conserves fixed supply", async () => {
    const f = await fixture();
    const result = await run(f);
    assert.equal(result.holder, getAddress(f.wallets[0].account.address));
    assert.equal(result.transfers.length, 5);
    assert.deepEqual(result.recipients.map((r) => r.balance), [2000n, 100n, 200n, 200n, 200n].map((n) => n * 10n ** 6n));
    assert.equal(await f.p.token.read.balanceOf([result.holder]), TOKEN_SUPPLY - 2700n * 10n ** 6n);
    assert.equal(await f.p.token.read.totalSupply(), TOKEN_SUPPLY);
    assert.equal(await f.p.token.read.balanceOf([f.p.escrow.address]), 0n);
    assert.equal(await f.p.token.read.balanceOf([f.p.registry.address]), 0n);
    assert.equal(await f.p.token.read.balanceOf([f.p.arbitration.address]), 0n);
    assert.equal(await f.p.token.read.balanceOf([f.p.treasury.address]), 0n);
    for (const transfer of result.transfers) assert.equal((await f.client.getTransactionReceipt({ hash: transfer.hash })).status, "success");
    assert.equal(f.messages.filter((m) => m.includes(": submitted ")).length, 5);
    assert.equal(f.messages.filter((m) => m.includes(": confirmed ")).length, 5);
  });
  it("reruns without sending or mining when all balances already meet targets", async () => {
    const f = await fixture(); await run(f);
    const before = await f.client.getBlockNumber({ cacheTime: 0 });
    const result = await run(f);
    assert.equal(result.transfers.length, 0);
    assert.equal(await f.client.getBlockNumber({ cacheTime: 0 }), before);
    assert.equal(f.messages.filter((m) => m.includes(": SKIP ")).length, 5);
  });
  it("tops up only shortfalls and leaves above-target wallets unchanged", async () => {
    const f = await fixture();
    await f.p.token.write.transfer([f.wallets[1].account.address, 500n * 10n ** 6n]);
    await f.p.token.write.transfer([f.wallets[2].account.address, 150n * 10n ** 6n]);
    const result = await run(f);
    assert.equal(result.transfers.length, 4);
    assert.equal(result.transfers[0].amount, 1500n * 10n ** 6n);
    assert.equal(result.recipients[1].balance, 150n * 10n ** 6n);
  });
  it("uses on-chain mint history rather than assuming the first unlocked wallet owns tokens", async () => {
    const f = await fixture();
    const reordered = { ...connection.viem, getWalletClients: async () => [...f.wallets.slice(1), f.wallets[0]] };
    const result = await provisionLocalTokens(reordered, f.manifest, compiled.MockUSD, f.env, PROVISION_RPC_URL, () => {});
    assert.equal(result.holder, getAddress(f.wallets[0].account.address));
  });
  for (const invalid of [undefined, "not-an-address", zeroAddress, "0xf39Fd6e51aad88f6f4ce6ab8827279cfffb92266"])
    it(`rejects missing/invalid/zero/bad-checksum recipient ${String(invalid)}`, async () => {
      const f = await fixture();
      const before = await f.client.getBlockNumber({ cacheTime: 0 });
      await assert.rejects(run(f, { ...f.env, TRUSTLAYER_CLIENT: invalid }), /valid nonzero Ethereum address/);
      assert.equal(await f.client.getBlockNumber({ cacheTime: 0 }), before);
    });
  it("rejects duplicate roles regardless of address casing", async () => {
    const f = await fixture();
    assert.throws(() => provisioningRecipients({ ...f.env, TRUSTLAYER_FREELANCER: f.env.TRUSTLAYER_CLIENT!.toLowerCase() }), /five distinct/);
  });
  for (const url of ["https://127.0.0.1:8545", "http://localhost:8545", "http://127.0.0.1:18545", "https://example.com", "http://user:password@127.0.0.1:8545", "http://127.0.0.1:8545/?network=other"])
    it(`rejects a noncanonical provisioning endpoint (${new URL(url).hostname}:${new URL(url).port})`, () => {
      assert.throws(() => assertProvisioningRpc(url), /requires exactly/);
    });
  it("accepts canonical IPv4 localhost with or without the trailing slash", () => {
    assert.doesNotThrow(() => assertProvisioningRpc(PROVISION_RPC_URL));
    assert.doesNotThrow(() => assertProvisioningRpc(`${PROVISION_RPC_URL}/`));
  });
  it("rejects ephemeral or wrong-endpoint manifests before transfers", async () => {
    const f = await fixture();
    await assert.rejects(provisionLocalTokens(connection.viem, { ...f.manifest, ephemeral: true }, compiled.MockUSD, f.env, PROVISION_RPC_URL), /ephemeral/);
    await assert.rejects(provisionLocalTokens(connection.viem, { ...f.manifest, rpcUrl: "http://127.0.0.1:18545" }, compiled.MockUSD, f.env, PROVISION_RPC_URL), /requires exactly/);
  });
  it("rejects a stale verification block", async () => {
    const f = await fixture();
    const stale = structuredClone(f.manifest); stale.verifiedBlock.hash = `0x${"1".repeat(64)}`;
    await assert.rejects(provisionLocalTokens(connection.viem, stale, compiled.MockUSD, f.env, PROVISION_RPC_URL), /Verification block changed/);
  });
  it("rejects missing runtime bytecode and mismatched compiled token artifacts", async () => {
    const f = await fixture();
    const bad = structuredClone(f.manifest); bad.contracts.MockUSD.address = f.wallets[8].account.address;
    await assert.rejects(provisionLocalTokens(connection.viem, bad, compiled.MockUSD, f.env, PROVISION_RPC_URL), /code changed or missing/);
    await assert.rejects(provisionLocalTokens(connection.viem, f.manifest, { ...compiled.MockUSD, deployedBytecode: "0x00" }, f.env, PROVISION_RPC_URL), /Runtime bytecode mismatch/);
  });
  it("rejects protocol contracts as recipients", async () => {
    const f = await fixture(); await assert.rejects(run(f, { ...f.env, TRUSTLAYER_CLIENT: f.p.escrow.address }), /protocol contract/);
  });
  it("fails before any transfer when the initial holder lacks enough tokens", async () => {
    const f = await fixture();
    await f.p.token.write.transfer([f.wallets[8].account.address, TOKEN_SUPPLY - 1n]);
    const before = await f.client.getBlockNumber({ cacheTime: 0 });
    await assert.rejects(run(f), /insufficient mUSD/);
    assert.equal(await f.client.getBlockNumber({ cacheTime: 0 }), before);
  });
  it("rejects a locked or unavailable initial holder without accepting a private key", async () => {
    const f = await fixture();
    await assert.rejects(provisionLocalTokens({ ...connection.viem, getWalletClients: async () => f.wallets.slice(1) }, f.manifest, compiled.MockUSD, f.env, PROVISION_RPC_URL), /not an unlocked local RPC account/);
  });
  it("refuses a pending holder transaction instead of submitting a second top-up", async () => {
    const f = await fixture();
    const client = new Proxy(f.client, { get(target, property) { if (property === "getTransactionCount") return async ({ blockTag }: { blockTag: string }) => blockTag === "pending" ? 1 : 0; return Reflect.get(target, property); } });
    await assert.rejects(provisionLocalTokens({ ...connection.viem, getPublicClient: async () => client }, f.manifest, compiled.MockUSD, f.env, PROVISION_RPC_URL), /pending transactions/);
    assert.equal(await f.p.token.read.balanceOf([f.wallets[1].account.address]), 0n);
  });
  it("rejects a wrong RPC chain before any transfer", async () => {
    const f = await fixture();
    const client = new Proxy(f.client, { get(target, property) { if (property === "getChainId") return async () => 1; return Reflect.get(target, property); } });
    await assert.rejects(provisionLocalTokens({ ...connection.viem, getPublicClient: async () => client }, f.manifest, compiled.MockUSD, f.env, PROVISION_RPC_URL), /RPC chain does not match/);
    assert.equal(await f.p.token.read.balanceOf([f.wallets[1].account.address]), 0n);
  });
  it("requires local gas in the initial holder wallet before any transfer", async () => {
    const f = await fixture();
    const client = new Proxy(f.client, { get(target, property) { if (property === "getBalance") return async () => 0n; return Reflect.get(target, property); } });
    await assert.rejects(provisionLocalTokens({ ...connection.viem, getPublicClient: async () => client }, f.manifest, compiled.MockUSD, f.env, PROVISION_RPC_URL), /local ETH for gas/);
    assert.equal(await f.p.token.read.balanceOf([f.wallets[1].account.address]), 0n);
  });
  it("retains an uncertain transaction hash and resumes mined transfers without paying a wallet twice", async () => {
    const f = await fixture();
    const client = new Proxy(f.client, { get(target, property) { if (property === "waitForTransactionReceipt") return async () => { throw new Error("Receipt RPC failed"); }; return Reflect.get(target, property); } });
    await assert.rejects(provisionLocalTokens({ ...connection.viem, getPublicClient: async () => client }, f.manifest, compiled.MockUSD, f.env, PROVISION_RPC_URL, () => {}), /Confirmation unresolved for 0x[0-9a-f]{64}/);
    assert.equal(await f.p.token.read.balanceOf([f.wallets[1].account.address]), 2000n * 10n ** 6n);
    const resumed = await run(f);
    assert.equal(resumed.transfers.length, 4);
    assert.equal(resumed.recipients[0].balance, 2000n * 10n ** 6n);
    assert.equal(await f.p.token.read.totalSupply(), TOKEN_SUPPLY);
  });
});
