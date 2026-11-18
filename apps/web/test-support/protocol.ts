import { readFileSync } from "node:fs";
import {
  abis,
  CONTRACT_NAMES,
  type LocalDeployment,
} from "@trustlayer/contracts";
import {
  decodeFunctionData,
  encodeFunctionResult,
  keccak256,
  type Abi,
} from "viem";

// Test fixtures only: no production mock provider, contract, balance or transaction.
export const code = "0x60006000" as const;
export const accountA = "0x1111111111111111111111111111111111111111" as const;
export const accountB = "0x2222222222222222222222222222222222222222" as const;
export function fixtureManifest(): LocalDeployment {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        "../../../packages/contracts/generated/deployments/31337.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as LocalDeployment;
  manifest.ephemeral = false;
  manifest.rpcUrl = "http://127.0.0.1:8545/";
  for (const name of CONTRACT_NAMES)
    manifest.contracts[name].runtimeCodeHash = keccak256(code);
  return manifest;
}
export function blockFixture(manifest: LocalDeployment) {
  return {
    hash: manifest.verifiedBlock.hash,
    number: `0x${BigInt(manifest.verifiedBlock.number).toString(16)}`,
    timestamp: "0x65500000",
    transactions: [],
    parentHash: `0x${"0".repeat(64)}`,
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    miner: accountA,
    extraData: "0x",
    nonce: "0x0000000000000000",
    difficulty: "0x0",
    size: "0x100",
  };
}
export function rpcFixture(
  method: string,
  params: unknown[],
  manifest: LocalDeployment,
  tokenDecimals = 6,
): unknown {
  if (method === "eth_chainId") return "0x7a69";
  if (method === "eth_blockNumber")
    return `0x${BigInt(manifest.verifiedBlock.number).toString(16)}`;
  if (method === "eth_getBlockByNumber") return blockFixture(manifest);
  if (method === "eth_getCode") return code;
  if (method === "eth_getLogs") return [];
  if (method === "eth_call") {
    const call = params[0] as { to: string; data: `0x${string}` };
    const name = CONTRACT_NAMES.find(
      (name) =>
        manifest.contracts[name].address.toLowerCase() ===
        call.to.toLowerCase(),
    );
    if (!name) throw new Error("Unknown test contract");
    const abi: Abi = abis[name];
    const decoded = decodeFunctionData({ abi, data: call.data });
    const result =
      decoded.functionName === "balanceOf"
        ? (decoded.args?.[0] as string).toLowerCase() === accountB.toLowerCase()
          ? 9_876_543n
          : 123_456_789n
        : decoded.functionName === "decimals"
          ? tokenDecimals
          : decoded.functionName === "symbol"
            ? "mUSD"
            : decoded.functionName === "owner"
              ? accountA
              : decoded.functionName === "isConfigured"
                ? true
                : 0n;
    return encodeFunctionResult({
      abi,
      functionName: decoded.functionName,
      result,
    });
  }
  throw new Error(`Unexpected test RPC method ${method}`);
}
