import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import { assertLocalRpcUrl } from "../packages/contracts/src/index.js";
import { exportAbis, readCompiledContracts } from "./lib/artifacts.js";
import { deploymentPath, readIgnitionAddresses, verifyDeployment } from "./lib/deployment.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const rpcUrl = assertLocalRpcUrl(process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545");
const deploymentId = process.env.TRUSTLAYER_DEPLOYMENT_ID ?? "chain-31337";
const addresses = readIgnitionAddresses(JSON.parse(await readFile(deploymentPath(root, deploymentId), "utf8")));
const connection = await network.create();
if (connection.networkName !== "localhost" || connection.networkConfig.type !== "http") throw new Error("Use the localhost HTTP network when exporting deployed addresses");
const manifest = await verifyDeployment(connection.viem, addresses, await readCompiledContracts(root), {
  deploymentId, rpcUrl, fresh: process.env.TRUSTLAYER_VERIFY_FRESH === "true", ephemeral: process.env.TRUSTLAYER_EXPORT_EPHEMERAL === "true",
});
// Address exports are written only after all live configuration and bytecode checks pass.
await exportAbis(root);
const output = resolve(root, "packages", "contracts", "generated", "deployments");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "31337.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Verified ${deploymentId} on local chain 31337 at block ${manifest.verifiedBlock.number}; exported five contract addresses.`);
