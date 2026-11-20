import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import { assertLocalRpcUrl, assertDeploymentOnChain, parseLocalDeployment } from "../packages/contracts/src/index.js";
import { exportAbis, readCompiledContracts } from "./lib/artifacts.js";
import { deploymentPath, readIgnitionAddresses, verifyDeployment } from "./lib/deployment.js";
import { checkSession, type ChainSession } from "./lib/local-chain.js";
import { writeDeploymentExport } from "./lib/manifest-output.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const rpcUrl = assertLocalRpcUrl(process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545");
const deploymentId = process.env.TRUSTLAYER_DEPLOYMENT_ID ?? "chain-31337";
const addresses = readIgnitionAddresses(JSON.parse(await readFile(deploymentPath(root, deploymentId), "utf8")));
const connection = await network.create();
if (connection.networkName !== "localhost" || connection.networkConfig.type !== "http") throw new Error("Use the localhost HTTP network when exporting deployed addresses");
let manifest = await verifyDeployment(connection.viem, addresses, await readCompiledContracts(root), {
  deploymentId, rpcUrl, fresh: process.env.TRUSTLAYER_VERIFY_FRESH === "true", ephemeral: process.env.TRUSTLAYER_EXPORT_EPHEMERAL === "true",
});
const client = await connection.viem.getPublicClient();
if (process.env.TRUSTLAYER_ANCHOR_MANIFEST) {
  const previous = parseLocalDeployment(JSON.parse(await readFile(process.env.TRUSTLAYER_ANCHOR_MANIFEST, "utf8")));
  await assertDeploymentOnChain(client, previous);
  assert.deepEqual(previous.contracts,manifest.contracts,"Archived anchor belongs to different contracts");
  manifest = {...manifest,verifiedBlock: previous.verifiedBlock};
}
if (!manifest.ephemeral) {
  if (process.env.TRUSTLAYER_CHAIN_SESSION) {
    const session = JSON.parse(await readFile(process.env.TRUSTLAYER_CHAIN_SESSION, "utf8")) as ChainSession;
    if (new URL(session.rpcUrl).toString() !== rpcUrl) throw new Error("Managed chain session RPC differs from export RPC.");
    await checkSession(session);
    manifest = { ...manifest, chainIdentity: session.identity };
  } else {
    const metadata = await client.request({method: "hardhat_metadata"} as never) as {instanceId: `0x${string}`};
    manifest = {...manifest, hardhatInstanceId: metadata.instanceId};
  }
}
// Address exports are written only after all live configuration and bytecode checks pass.
await exportAbis(root);
const output = process.env.TRUSTLAYER_EXPORT_PATH ?? resolve(root, "packages", "contracts", "generated", "deployments", "31337.json");
const saved = await writeDeploymentExport(output, manifest, client);
console.log(`Verified ${deploymentId} on local chain 31337; retained stable anchor block ${saved.verifiedBlock.number}; five contract addresses at ${output}.`);
