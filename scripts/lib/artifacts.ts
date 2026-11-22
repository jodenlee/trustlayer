import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { keccak256, toHex, type Abi, type Hex } from "viem";
import { formatAbiItem } from "viem/utils";
import { CONTRACT_NAMES, type ContractName } from "../../packages/contracts/src/names.js";

export interface CompiledContract {
  contractName: string;
  abi: Abi;
  deployedBytecode: Hex;
  immutableReferences?: Record<string, { start: number; length: number }[]>;
}
export type CompiledContracts = Record<ContractName, CompiledContract>;

export async function readCompiledContracts(root: string): Promise<CompiledContracts> {
  const entries = await Promise.all(CONTRACT_NAMES.map(async name => {
    const artifact = JSON.parse(await readFile(resolve(root, "artifacts", "contracts", `${name}.sol`, `${name}.json`), "utf8")) as CompiledContract;
    if (artifact.contractName !== name || !Array.isArray(artifact.abi)) throw new Error(`Invalid compiled artifact: ${name}`);
    return [name, artifact] as const;
  }));
  return Object.fromEntries(entries) as CompiledContracts;
}

export function abiHash(abi: Abi): Hex { return keccak256(toHex(JSON.stringify(abi))); }

export function buildInventory(compiled: CompiledContracts) {
  return Object.fromEntries(CONTRACT_NAMES.map(name => {
    const abi = compiled[name].abi;
    return [name, {
      abiHash: abiHash(abi),
      constructor: abi.find(item => item.type === "constructor") ?? null,
      reads: abi.filter(item => item.type === "function" && ["view", "pure"].includes(item.stateMutability)).map(item => ({ signature: formatAbiItem(item), ...item })),
      writes: abi.filter(item => item.type === "function" && !["view", "pure"].includes(item.stateMutability)).map(item => ({ signature: formatAbiItem(item), ...item })),
      events: abi.filter(item => item.type === "event").map(item => ({ signature: formatAbiItem(item), ...item })),
      errors: abi.filter(item => item.type === "error").map(item => ({ signature: formatAbiItem(item), ...item })),
    }];
  }));
}

export async function exportAbis(root: string) {
  const compiled = await readCompiledContracts(root);
  const output = resolve(root, "packages", "contracts", "generated");
  await mkdir(resolve(output, "abi"), { recursive: true });
  for (const name of CONTRACT_NAMES) await writeFile(resolve(output, "abi", `${name}.json`), `${JSON.stringify(compiled[name].abi, null, 2)}\n`);
  const source = "// Generated from Hardhat artifacts by npm run export:abis. Do not edit.\n" +
    CONTRACT_NAMES.map(name => `export const ${name}Abi = ${JSON.stringify(compiled[name].abi, null, 2)} as const;\n`).join("\n");
  await writeFile(resolve(output, "abis.ts"), source);
  await writeFile(resolve(output, "inventory.json"), `${JSON.stringify(buildInventory(compiled), null, 2)}\n`);
  return compiled;
}

/// Compare compiled runtime including metadata, ignoring only compiler-declared immutable slots.
export function assertRuntimeMatches(actual: Hex, artifact: CompiledContract) {
  if (!/^0x[0-9a-f]*$/i.test(actual) || !/^0x[0-9a-f]*$/i.test(artifact.deployedBytecode) || actual.length !== artifact.deployedBytecode.length || actual === "0x") throw new Error(`Runtime bytecode mismatch: ${artifact.contractName}`);
  const expected = Buffer.from(artifact.deployedBytecode.slice(2), "hex");
  const deployed = Buffer.from(actual.slice(2), "hex");
  const ignored = new Set<number>();
  for (const ranges of Object.values(artifact.immutableReferences ?? {})) for (const range of ranges) {
    if (range.start < 0 || range.length <= 0 || range.start + range.length > expected.length) throw new Error("Invalid immutable reference");
    for (let index = range.start; index < range.start + range.length; ++index) ignored.add(index);
  }
  for (let index = 0; index < expected.length; ++index) {
    if (!ignored.has(index) && expected[index] !== deployed[index]) throw new Error(`Runtime bytecode mismatch: ${artifact.contractName}`);
  }
}
