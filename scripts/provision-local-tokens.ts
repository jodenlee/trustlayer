import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import { parseLocalDeployment } from "../packages/contracts/src/index.js";
import { readCompiledContracts } from "./lib/artifacts.js";
import { assertProvisioningRpc, PROVISION_RPC_URL, provisioningRecipients, provisionLocalTokens } from "./lib/provisioning.js";

// Only explicit public recipient addresses; signing uses the existing unlocked local mint holder.
provisioningRecipients(process.env);
assertProvisioningRpc(process.env.LOCAL_RPC_URL ?? PROVISION_RPC_URL);
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = parseLocalDeployment(JSON.parse(await readFile(new URL("../packages/contracts/generated/deployments/31337.json", import.meta.url), "utf8")));
if (!manifest.chainIdentity && !manifest.hardhatInstanceId) throw new Error("Upgrade the legacy deployment binding with its original anchor before provisioning. See docs/PHASE5.md.");
const connection = await network.create();
try {
  if (connection.networkName !== "localhost" || connection.networkConfig.type !== "http")
    throw new Error("Run this local-only script with --network localhost.");
  const rpcUrl = await connection.networkConfig.url.getUrl();
  assertProvisioningRpc(rpcUrl);
  await provisionLocalTokens(connection.viem, manifest, (await readCompiledContracts(root)).MockUSD, process.env, rpcUrl);
} finally { await connection.close(); }
