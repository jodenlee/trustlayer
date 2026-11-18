import { getAddress, keccak256, toHex, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { MockUSDAbi, TrustEscrowAbi, JurorRegistryAbi, DisputeArbitrationAbi, ProtocolTreasuryAbi } from "../generated/abis.js";
import { CONTRACT_NAMES, LOCAL_CHAIN_ID, TOKEN_DECIMALS, type ContractName } from "./names.js";

export * from "./names.js";
export { MockUSDAbi, TrustEscrowAbi, JurorRegistryAbi, DisputeArbitrationAbi, ProtocolTreasuryAbi };
export const abis = { MockUSD: MockUSDAbi, TrustEscrow: TrustEscrowAbi, JurorRegistry: JurorRegistryAbi, DisputeArbitration: DisputeArbitrationAbi, ProtocolTreasury: ProtocolTreasuryAbi } as const;

export interface LocalDeployment {
  schemaVersion: 1;
  module: "TrustLayerPhase2D";
  chainId: typeof LOCAL_CHAIN_ID;
  deploymentId: string;
  rpcUrl: string;
  ephemeral: boolean;
  verifiedAt: string;
  verifiedBlock: { number: string; hash: Hex };
  token: { symbol: "mUSD"; decimals: typeof TOKEN_DECIMALS };
  contracts: Record<ContractName, { address: Address; abiHash: Hex; runtimeCodeHash: Hex }>;
  authorities: { treasuryOwner: Address; escrowConfigurator: Address; registryConfigurator: Address; treasuryConfigurator: Address };
}

function record(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a deployment object");
}
function hash(value: unknown): asserts value is Hex {
  if (typeof value !== "string" || !/^0x[\da-f]{64}$/i.test(value)) throw new Error("Invalid deployment hash");
}
function address(value: unknown): Address {
  if (typeof value !== "string") throw new Error("Invalid deployment address");
  const parsed = getAddress(value);
  if (parsed === zeroAddress) throw new Error("Zero deployment address");
  return parsed;
}

export function assertLocalRpcUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Only an uncredentialed loopback HTTP RPC is supported");
  return url.toString();
}

/// Parse untrusted JSON; chain IDs alone do not identify a particular resettable local chain.
export function parseLocalDeployment(value: unknown): LocalDeployment {
  record(value);
  if (value.schemaVersion !== 1 || value.module !== "TrustLayerPhase2D" || value.chainId !== LOCAL_CHAIN_ID) throw new Error("Unsupported deployment schema, module or chain");
  if (typeof value.deploymentId !== "string" || !/^[a-z][a-z\d_-]*$/i.test(value.deploymentId)) throw new Error("Invalid deployment ID");
  if (typeof value.rpcUrl !== "string") throw new Error("Missing deployment RPC");
  assertLocalRpcUrl(value.rpcUrl);
  if (typeof value.ephemeral !== "boolean" || typeof value.verifiedAt !== "string" || !Number.isFinite(Date.parse(value.verifiedAt))) throw new Error("Invalid deployment provenance");
  record(value.verifiedBlock);
  if (typeof value.verifiedBlock.number !== "string" || !/^\d+$/.test(value.verifiedBlock.number)) throw new Error("Invalid verification block");
  hash(value.verifiedBlock.hash);
  record(value.token);
  if (value.token.symbol !== "mUSD" || value.token.decimals !== TOKEN_DECIMALS) throw new Error("Unsupported payment token metadata");
  record(value.contracts);
  const unique = new Set<Address>();
  for (const name of CONTRACT_NAMES) {
    const entry = value.contracts[name];
    record(entry);
    const parsed = address(entry.address);
    if (unique.has(parsed)) throw new Error("Duplicate deployment address");
    unique.add(parsed);
    hash(entry.abiHash);
    hash(entry.runtimeCodeHash);
    if (entry.abiHash !== keccak256(toHex(JSON.stringify(abis[name])))) throw new Error(`ABI mismatch: ${name}; regenerate exports`);
  }
  record(value.authorities);
  for (const key of ["treasuryOwner", "escrowConfigurator", "registryConfigurator", "treasuryConfigurator"]) address(value.authorities[key]);
  return value as unknown as LocalDeployment;
}

/// Typed Viem/Wagmi contract configurations; caller must supply the wallet's current chain ID.
export function getContracts(deployment: LocalDeployment, connectedChainId: number) {
  const manifest = parseLocalDeployment(deployment);
  if (connectedChainId !== manifest.chainId) throw new Error("Wallet chain does not match deployment");
  return {
    MockUSD: { address: manifest.contracts.MockUSD.address, abi: MockUSDAbi },
    TrustEscrow: { address: manifest.contracts.TrustEscrow.address, abi: TrustEscrowAbi },
    JurorRegistry: { address: manifest.contracts.JurorRegistry.address, abi: JurorRegistryAbi },
    DisputeArbitration: { address: manifest.contracts.DisputeArbitration.address, abi: DisputeArbitrationAbi },
    ProtocolTreasury: { address: manifest.contracts.ProtocolTreasury.address, abi: ProtocolTreasuryAbi },
  } as const;
}

/// Reject stale/reset chains and changed runtime code before enabling a future wallet workflow.
export async function assertDeploymentOnChain(client: Pick<PublicClient, "getChainId" | "getBlock" | "getCode">, deployment: LocalDeployment) {
  const manifest = parseLocalDeployment(deployment);
  if (await client.getChainId() !== manifest.chainId) throw new Error("RPC chain does not match deployment");
  const block = await client.getBlock({ blockNumber: BigInt(manifest.verifiedBlock.number) });
  if (block.hash !== manifest.verifiedBlock.hash) throw new Error("Verification block changed; re-export this local deployment");
  for (const name of CONTRACT_NAMES) {
    const code = await client.getCode({ address: manifest.contracts[name].address });
    if (!code || code === "0x" || keccak256(code) !== manifest.contracts[name].runtimeCodeHash) throw new Error(`Deployed code changed or missing: ${name}`);
  }
}
