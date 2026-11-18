import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, http } from "viem";
import { CONTRACT_NAMES, parseLocalDeployment } from "../packages/contracts/src/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = resolve(root, "node_modules", "hardhat", "dist", "src", "cli.js");
const output = resolve(root, "reports", "phase2e");
await mkdir(output, { recursive: true });
const port = Number(process.env.TRUSTLAYER_VERIFY_PORT ?? "18545");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local verification port");
const rpcUrl = `http://127.0.0.1:${port}`;
const rpc = createPublicClient({ transport: http(rpcUrl, { timeout: 1500, retryCount: 0 }) });
const abort = new AbortController();
const interrupt = () => abort.abort();
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolveReady, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolveReady); });
  await new Promise<void>((resolveClosed, reject) => server.close(error => error ? reject(error) : resolveClosed()));
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  child.kill();
  const result = await Promise.race([closed.then(() => true), delay(5000).then(() => false)]);
  if (!result) { child.kill("SIGKILL"); await closed; }
}

async function command(args: string[], env: NodeJS.ProcessEnv, logName: string) {
  const log = createWriteStream(resolve(output, logName));
  const child = spawn(process.execPath, [cli, ...args], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], signal: abort.signal });
  let tail = "";
  for (const stream of [child.stdout, child.stderr]) stream!.on("data", chunk => { log.write(chunk); tail = (tail + chunk.toString()).slice(-4500); });
  try {
    const [code] = await once(child, "close");
    if (code !== 0) throw new Error(`Hardhat ${args.join(" ")} failed (${String(code)}):\n${tail}`);
  } finally { await stop(child); log.end(); await finished(log); }
}

const runs = [];
try {
  for (let index = 1; index <= 2; ++index) {
    await availablePort(); // Never attach to or stop an existing user's node.
    const deploymentId = `phase2e-${process.pid}-${Date.now()}-${index}`;
    const env = { ...process.env, LOCAL_RPC_URL: rpcUrl, TRUSTLAYER_DEPLOYMENT_ID: deploymentId,
      TRUSTLAYER_VERIFY_FRESH: "true", TRUSTLAYER_EXPORT_EPHEMERAL: "true", CI: "true" };
    const nodeLog = createWriteStream(resolve(output, `node-${index}.log`));
    const node = spawn(process.execPath, [cli, "node", "--hostname", "127.0.0.1", "--port", String(port), "--chain-id", "31337"],
      { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], signal: abort.signal });
    let started = false;
    let nodeError: Error | undefined;
    node.on("error", error => { nodeError = error; });
    for (const stream of [node.stdout, node.stderr]) stream!.on("data", chunk => {
      nodeLog.write(chunk); // Hardhat's known demo keys stay in ignored logs, never in exports or reports.
      if (chunk.toString().includes("Started HTTP and WebSocket")) started = true;
    });
    try {
      const deadline = Date.now() + 30000;
      let ready = false;
      while (Date.now() < deadline && !abort.signal.aborted) {
        if (nodeError) throw nodeError;
        if (node.exitCode !== null || node.signalCode !== null) throw new Error(`Verification node exited; inspect reports/phase2e/node-${index}.log`);
        if (started) {
          try { ready = await rpc.getChainId() === 31337 && await rpc.getBlockNumber({ cacheTime: 0 }) === 0n; } catch { /* transient startup only */ }
          if (ready) break;
        }
        await delay(200);
      }
      if (!ready) throw new Error("Fresh local node did not become ready at genesis");
      console.log(`Local run ${index}: fresh node ready; deploying the actual Phase2D Ignition module.`);
      const deployArgs = ["ignition", "deploy", "ignition/modules/Phase2D.ts", "--network", "localhost", "--deployment-id", deploymentId];
      await command(deployArgs, env, `deploy-${index}.log`);
      await command(["run", "scripts/export-contracts.ts", "--network", "localhost", "--no-compile"], env, `export-${index}.log`);
      const manifestPath = resolve(root, "packages", "contracts", "generated", "deployments", "31337.json");
      const first = parseLocalDeployment(JSON.parse(await readFile(manifestPath, "utf8")));
      // Re-running the same journal must resume without re-sending any one-time configuration call.
      await command(deployArgs, env, `resume-${index}.log`);
      await command(["run", "scripts/export-contracts.ts", "--network", "localhost", "--no-compile"], env, `resume-export-${index}.log`);
      const resumed = parseLocalDeployment(JSON.parse(await readFile(manifestPath, "utf8")));
      assert.deepEqual(resumed.contracts, first.contracts);
      assert.deepEqual(resumed.verifiedBlock, first.verifiedBlock, "Idempotent deployment mined additional transactions");
      runs.push({ ...resumed, idempotentResumeVerified: true });
      console.log(`Local run ${index}: all references, bytecode, zero balances, four one-time configuration events and idempotent resume verified.`);
    } finally {
      await stop(node);
      nodeLog.end();
      await finished(nodeLog);
      await availablePort();
      console.log(`Local run ${index}: owned verification node stopped; port ${port} released.`);
    }
  }
  for (const name of CONTRACT_NAMES) assert.deepEqual(runs[0].contracts[name], runs[1].contracts[name], `Clean-chain reproducibility failed: ${name}`);
  await writeFile(resolve(output, "verification.json"), `${JSON.stringify({ chainId: 31337, module: "TrustLayerPhase2D", reproducible: true, nodesStopped: true, runs }, null, 2)}\n`);
  console.log("Two clean CLI deployments and their idempotent resumes passed. Public report: reports/phase2e/verification.json");
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
