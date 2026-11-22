import assert from "node:assert/strict";
import { resolve } from "node:path";
import { BaseError, ContractFunctionRevertedError, getAddress, keccak256, zeroAddress, type Address } from "viem";
import type { HardhatViemHelpers } from "@nomicfoundation/hardhat-viem/types";
import { CONTRACT_NAMES, LOCAL_CHAIN_ID, type ContractName, type LocalDeployment, assertLocalRpcUrl, parseLocalDeployment } from "../../packages/contracts/src/index.js";
import { abiHash, assertRuntimeMatches, type CompiledContracts } from "./artifacts.js";

export type ProtocolAddresses = Record<ContractName, Address>;

export function deploymentPath(root: string, id: string) {
  if (!/^[a-z][a-z\d_-]*$/i.test(id)) throw new Error("Invalid Ignition deployment ID");
  return resolve(root, "ignition", "deployments", id, "deployed_addresses.json");
}

export function readIgnitionAddresses(value: unknown): ProtocolAddresses {
  if (!value || typeof value !== "object") throw new Error("Invalid Ignition address file");
  const entries = CONTRACT_NAMES.map(name => {
    const address = (value as Record<string, unknown>)[`TrustLayerPhase2D#${name}`];
    if (typeof address !== "string" || getAddress(address) === zeroAddress) throw new Error(`Missing Phase2D address: ${name}`);
    return [name, getAddress(address)] as const;
  });
  if (new Set(entries.map(([, address]) => address)).size !== CONTRACT_NAMES.length) throw new Error("Duplicate Ignition address");
  return Object.fromEntries(entries) as ProtocolAddresses;
}

export async function getProtocolContracts(viem: HardhatViemHelpers, addresses: ProtocolAddresses) {
  const [token, escrow, registry, arbitration, treasury] = await Promise.all([
    viem.getContractAt("MockUSD", addresses.MockUSD), viem.getContractAt("TrustEscrow", addresses.TrustEscrow),
    viem.getContractAt("JurorRegistry", addresses.JurorRegistry), viem.getContractAt("DisputeArbitration", addresses.DisputeArbitration),
    viem.getContractAt("ProtocolTreasury", addresses.ProtocolTreasury),
  ]);
  return { token, escrow, registry, arbitration, treasury };
}

export async function verifyDeployment(viem: HardhatViemHelpers, addresses: ProtocolAddresses, compiled: CompiledContracts,
  options: { deploymentId: string; rpcUrl: string; ephemeral: boolean; fresh: boolean }) {
  const client = await viem.getPublicClient();
  assert.equal(await client.getChainId(), LOCAL_CHAIN_ID, "Only local chain 31337 is supported");
  assertLocalRpcUrl(options.rpcUrl);
  deploymentPath(".", options.deploymentId);
  assert.equal(new Set(Object.values(addresses).map(address => getAddress(address))).size, 5, "Five distinct contract addresses required");
  const snapshot = await client.getBlock();
  if (!snapshot.hash || snapshot.number === null) throw new Error("Missing verification block");
  const { token, escrow, registry, arbitration, treasury } = await getProtocolContracts(viem, addresses);
  const contracts = {} as LocalDeployment["contracts"];
  for (const name of CONTRACT_NAMES) {
    const code = await client.getCode({ address: addresses[name] });
    if (!code || code === "0x") throw new Error(`Missing deployed code: ${name}`);
    assertRuntimeMatches(code, compiled[name]);
    contracts[name] = { address: getAddress(addresses[name]), abiHash: abiHash(compiled[name].abi), runtimeCodeHash: keccak256(code) };
  }
  const references = await Promise.all([
    escrow.read.paymentToken(), registry.read.stakingToken(), arbitration.read.paymentToken(), treasury.read.paymentToken(),
    escrow.read.treasury(), arbitration.read.protocolTreasury(), treasury.read.escrow(), treasury.read.arbitration(),
    arbitration.read.escrow(), arbitration.read.registry(), escrow.read.arbitrationContract(), registry.read.arbitrationContract(),
  ]);
  const expected = [addresses.MockUSD, addresses.MockUSD, addresses.MockUSD, addresses.MockUSD,
    addresses.ProtocolTreasury, addresses.ProtocolTreasury, addresses.TrustEscrow, addresses.DisputeArbitration,
    addresses.TrustEscrow, addresses.JurorRegistry, addresses.DisputeArbitration, addresses.DisputeArbitration];
  assert.deepEqual(references.map(address => getAddress(address)), expected.map(address => getAddress(address)), "Contract reference/configuration mismatch");
  assert.equal(await escrow.read.usesProtocolTreasury(), true);
  assert.equal(await arbitration.read.isConfigured(), true);
  assert.equal(await token.read.decimals(), 6);
  assert.equal(await token.read.symbol(), "mUSD");
  const unit = 10n ** 6n;
  assert.deepEqual(await Promise.all([
    escrow.read.SERVICE_FEE_BPS(), escrow.read.ACCEPTANCE_WINDOW(), escrow.read.DELIVERY_GRACE(), escrow.read.REVIEW_WINDOW(),
    registry.read.MIN_STAKE(), registry.read.STAKE_PER_DISPUTE(), registry.read.JURORS_PER_DISPUTE(),
    arbitration.read.DISPUTE_FEE(), arbitration.read.JUROR_FEE_PORTION(), arbitration.read.PROTOCOL_FEE_PORTION(), arbitration.read.JUROR_REWARD(),
    arbitration.read.RESPONSE_WINDOW(), arbitration.read.VOTING_WINDOW(), treasury.read.DISPUTE_PROTOCOL_FEE(),
  ]), [100, 7n * 86400n, 48n * 3600n, 72n * 3600n, 100n * unit, 100n * unit, 3n, 15n * unit, 12n * unit, 3n * unit, 4n * unit, 12n * 3600n, 24n * 3600n, 3n * unit]);
  const [treasuryOwner, escrowConfigurator, registryConfigurator, treasuryConfigurator] = await Promise.all([
    treasury.read.owner(), escrow.read.arbitrationConfigurator(), registry.read.arbitrationConfigurator(), arbitration.read.treasuryConfigurator(),
  ]);
  const authorities = { treasuryOwner, escrowConfigurator, registryConfigurator, treasuryConfigurator };
  for (const address of Object.values(authorities)) assert.notEqual(address, zeroAddress, "Missing configuration/treasury authority");

  const events = await Promise.all([
    client.getContractEvents({ address: escrow.address, abi: escrow.abi, eventName: "ArbitrationContractConfigured", fromBlock: 0n }),
    client.getContractEvents({ address: registry.address, abi: registry.abi, eventName: "ArbitrationContractConfigured", fromBlock: 0n }),
    client.getContractEvents({ address: treasury.address, abi: treasury.abi, eventName: "SourcesConfigured", fromBlock: 0n }),
    client.getContractEvents({ address: arbitration.address, abi: arbitration.abi, eventName: "ProtocolTreasuryConfigured", fromBlock: 0n }),
  ]);
  for (const logs of events) assert.equal(logs.length, 1, "Each one-time configuration event must occur exactly once");
  const attempts = [
    client.simulateContract({ address: escrow.address, abi: escrow.abi, functionName: "setArbitrationContract", args: [arbitration.address], account: escrowConfigurator }),
    client.simulateContract({ address: registry.address, abi: registry.abi, functionName: "setArbitrationContract", args: [arbitration.address], account: registryConfigurator }),
    client.simulateContract({ address: arbitration.address, abi: arbitration.abi, functionName: "setProtocolTreasury", args: [treasury.address], account: treasuryConfigurator }),
    client.simulateContract({ address: treasury.address, abi: treasury.abi, functionName: "configureSources", args: [escrow.address, arbitration.address], account: treasuryOwner }),
  ];
  await Promise.all(attempts.map(attempt => assert.rejects(attempt, error => {
    if (!(error instanceof BaseError)) return false;
    const cause = error.walk(inner => inner instanceof ContractFunctionRevertedError);
    return cause instanceof ContractFunctionRevertedError && cause.data?.errorName === "InvalidState";
  })));
  if (options.fresh) {
    assert.equal(treasuryOwner, escrowConfigurator, "Fresh module treasury owner must be the deployer");
    assert.equal(registryConfigurator, escrowConfigurator);
    assert.equal(treasuryConfigurator, escrowConfigurator);
    assert.equal(await treasury.read.pendingOwner(), zeroAddress);
    const counters = await Promise.all([
      escrow.read.nextProjectId(), escrow.read.totalEscrowLiability(), registry.read.registeredJurorCount(), registry.read.totalStaked(), registry.read.totalLockedStake(),
      arbitration.read.nextDisputeId(), arbitration.read.totalDisputeFeesHeld(), arbitration.read.pendingJurorFees(), arbitration.read.pendingProtocolFees(),
      arbitration.read.reservedJurorRewards(), arbitration.read.totalJurorRewardsReserved(), arbitration.read.totalJurorRewardsClaimed(), arbitration.read.totalProtocolFeesTransferred(),
      treasury.read.availableRevenue(), treasury.read.totalRevenueReceived(), treasury.read.totalWithdrawn(),
      ...[escrow.address, registry.address, arbitration.address, treasury.address].map(address => token.read.balanceOf([address])),
    ]);
    assert.ok(counters.every(value => value === 0n), "Fresh deployment contains existing funds or protocol state");
    assert.equal(await token.read.totalSupply(), 1_000_000n * unit);
    assert.equal(await token.read.balanceOf([escrowConfigurator]), await token.read.totalSupply());
  }
  assert.equal(await client.getBlockNumber({ cacheTime: 0 }), snapshot.number, "Chain advanced during export; retry after transactions settle");
  const manifest = parseLocalDeployment({
    schemaVersion: 1, module: "TrustLayerPhase2D", chainId: LOCAL_CHAIN_ID, deploymentId: options.deploymentId,
    rpcUrl: assertLocalRpcUrl(options.rpcUrl), ephemeral: options.ephemeral, verifiedAt: new Date().toISOString(),
    verifiedBlock: { number: snapshot.number.toString(), hash: snapshot.hash }, token: { symbol: "mUSD", decimals: 6 }, contracts, authorities,
  });
  return { ...manifest, verification: { freshStateVerified: options.fresh, configurationEventCounts: events.map(logs => logs.length), repeatedConfigurationRejected: true, runtimeMatchesCompiledArtifacts: true } };
}
