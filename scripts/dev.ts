/**
 * One-command local workflow around the Phase 5 managed-chain controller.
 *
 *   npm run dev          restore (or reuse) the managed chain, verify, start the app
 *   npm run dev:stop     back up and stop everything this tool owns
 *   npm run dev:status   show what is running and the latest backup
 *   npm run dev:init -- --name NAME [--archive-current]   first-time setup
 *
 * Safety rules (see docs/UI_REDESIGN_HANDOVER.md): never create a fresh chain
 * during routine startup, never overwrite a backup or manifest, never redeploy,
 * never stop a process it cannot prove it owns, and stop rather than guess.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  readFileSync,
  renameSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { resolve, join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  anvilBinary,
  backupChain,
  chainClient,
  chainRoot,
  checkSession,
  readBackup,
  sessionPath,
  startChain,
  stopNode,
  type ChainSession,
} from "./lib/local-chain.js";
import {
  assertDeploymentOnChain,
  parseLocalDeployment,
  type LocalDeployment,
} from "../packages/contracts/src/index.js";
import {
  consistencyProblems,
  runName,
  selectBackup,
  type BackupCandidate,
} from "./lib/dev-plan.js";
import {
  isAlive,
  listeningPid,
  processCommandLine,
  nodeProcessesMatching,
  processPath,
  samePath,
  stopTree,
} from "./lib/dev-process.js";

const CHAIN_PORT = 8545;
const RPC_URL = `http://127.0.0.1:${CHAIN_PORT}`;
const manifestPath = resolve(
  "packages/contracts/generated/deployments/31337.json",
);
const webDir = resolve("apps/web");
const devDir = join(chainRoot, "dev");
const statePath = join(devDir, "state.json");
const stopRequestPath = join(devDir, "stop-request");
const stopResultPath = join(devDir, "stop-result.json");
const windows = process.platform === "win32";

type Mode = "owned" | "adopted" | "external";
interface DevState {
  format: 1;
  wrapperPid: number;
  mode: Mode;
  runName: string;
  nodePid?: number;
  webPid?: number;
  webUrl?: string;
  restoredFrom?: string;
  startedAt: string;
}

// ---------- output ----------
const ok = (m: string) => console.log(`  ✓ ${m}`);
const info = (m: string) => console.log(`    ${m}`);
const warn = (m: string) => console.log(`  ! ${m}`);
const step = (m: string) => console.log(`\n• ${m}`);
class Stop extends Error {}
function fail(message: string, ...help: string[]): never {
  console.error(`\n  ✗ ${message}`);
  for (const line of help) console.error(`    ${line}`);
  throw new Stop(message);
}
const rel = (p: string) => relative(process.cwd(), p) || p;
const npm = windows ? "npm.cmd" : "npm";

// ---------- state ----------
function readState(): DevState | undefined {
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as DevState;
  } catch {
    return undefined;
  }
}
function writeState(state: DevState) {
  mkdirSync(devDir, { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}
function wrapperAlive(state: DevState | undefined) {
  if (!state || state.wrapperPid === process.pid || !isAlive(state.wrapperPid))
    return false;
  // Guard against PID reuse: the live process must actually be this tool.
  return /dev\.ts/.test(processCommandLine(state.wrapperPid) ?? "");
}

// ---------- configuration ----------
function readManifest(): LocalDeployment {
  if (!existsSync(manifestPath))
    fail(
      "No deployment manifest found.",
      "This looks like a first-time setup. Run:",
      `  ${npm} run dev:init -- --name dev1`,
    );
  const manifest = parseLocalDeployment(
    JSON.parse(readFileSync(manifestPath, "utf8")),
  );
  if (manifest.ephemeral)
    fail("The active manifest is from an ephemeral verification run.");
  if (!manifest.chainIdentity)
    fail(
      "The active deployment is not bound to a managed Anvil chain.",
      manifest.hardhatInstanceId
        ? "It belongs to a legacy Hardhat node, whose state cannot be saved or restored."
        : "It has no chain identity anchor.",
      "Keep using that node manually (docs/PHASE5.md), or set up a managed chain with",
      `  ${npm} run dev:init -- --name NAME --archive-current`,
    );
  return manifest;
}
function webOrigin() {
  // AUTH_ORIGIN is not secret; read only that key so SIWE works on the printed URL.
  try {
    const line = readFileSync(join(webDir, ".env.local"), "utf8")
      .split(/\r?\n/)
      .find((l) => /^\s*AUTH_ORIGIN\s*=/.test(l));
    const value = line
      ?.split("=")
      .slice(1)
      .join("=")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (value) {
      const url = new URL(value);
      if (
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname)
      )
        return url.origin;
    }
  } catch {
    /* fall through to the default */
  }
  return "http://127.0.0.1:3000";
}
function preflight() {
  step("Checking prerequisites");
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22)
    warn(`Node.js ${process.versions.node}; 22.13+ is recommended.`);
  if (!existsSync(resolve("node_modules")))
    fail("Root dependencies are not installed.", `Run: ${npm} ci`);
  if (!existsSync(join(webDir, "node_modules", "next")))
    fail(
      "App dependencies are not installed.",
      `Run: ${npm} --prefix apps/web ci`,
    );
  if (!existsSync(anvilBinary))
    fail(
      "The pinned Anvil binary was not found.",
      `Expected ${rel(anvilBinary)}. Run ${npm} ci (Windows x64), or set ANVIL_BINARY.`,
    );
  if (!existsSync(join(webDir, ".env.local")))
    warn(
      "apps/web/.env.local is missing: the app will load, but wallet sign-in needs a configured database (docs/PHASE4A.md).",
    );
  ok(`Node.js ${process.versions.node}, dependencies and Anvil present`);
}

// ---------- backups ----------
/** Read only the small header of a backup (session and head precede the state). */
function backupHeader(path: string): BackupCandidate | undefined {
  try {
    const fd = openSync(path, "r");
    const buffer = Buffer.alloc(8192);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    closeSync(fd);
    const text = buffer.subarray(0, length).toString("utf8");
    const end = text.indexOf(',"state":"');
    if (end < 0) return undefined;
    const header = JSON.parse(`${text.slice(0, end)}}`) as {
      format: number;
      session: ChainSession;
      head: { number: string; hash: `0x${string}` };
    };
    if (header.format !== 1 || !header.session?.identity || !header.head)
      return undefined;
    return {
      path,
      mtimeMs: statSync(path).mtimeMs,
      identity: header.session.identity,
      head: header.head,
      hasManifest: false,
    };
  } catch {
    return undefined;
  }
}
function listBackups() {
  const dir = join(chainRoot, "backups");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => backupHeader(join(dir, f)))
    .filter((b): b is BackupCandidate => !!b);
}
function backupPath(name: string) {
  return join(chainRoot, "backups", `${name}-${Date.now()}.json`);
}

// ---------- chain ----------
async function verifyChain(session: ChainSession, manifest: LocalDeployment) {
  const client = await checkSession(session);
  await assertDeploymentOnChain(client, manifest);
  return client;
}
function findSession(pid: number, manifest: LocalDeployment) {
  const runs = join(chainRoot, "runs");
  if (!existsSync(runs)) return undefined;
  for (const name of readdirSync(runs)) {
    try {
      const session = JSON.parse(
        readFileSync(join(runs, name, "session.json"), "utf8"),
      ) as ChainSession;
      if (
        session.nodePid === pid &&
        session.identity?.hash.toLowerCase() ===
          manifest.chainIdentity!.hash.toLowerCase()
      )
        return session;
    } catch {
      /* skip unreadable or initializing runs */
    }
  }
  return undefined;
}
/** True only when pid is the recorded Anvil child listening on the chain port. */
function ownsNode(pid: number | undefined) {
  return (
    !!pid &&
    isAlive(pid) &&
    listeningPid(CHAIN_PORT) === pid &&
    samePath(processPath(pid) ?? "", anvilBinary)
  );
}
async function adoptRunningChain(manifest: LocalDeployment, pid: number) {
  let version = "";
  try {
    version = (await chainClient({ rpcUrl: RPC_URL }).request({
      method: "web3_clientVersion",
    })) as string;
  } catch {
    /* not an RPC endpoint */
  }
  const image = processPath(pid) ?? "unknown process";
  if (!version.toLowerCase().startsWith("anvil/"))
    fail(
      `Port ${CHAIN_PORT} is already in use by ${image} (PID ${pid}), which is not the managed Anvil chain.`,
      version.toLowerCase().includes("hardhat")
        ? "A Hardhat node is running. Its state cannot be saved; stop it yourself if it holds nothing you need."
        : "TrustLayer will not stop a process it did not start.",
      "Free the port, then run this command again.",
    );
  const session = findSession(pid, manifest);
  if (!session)
    fail(
      `An Anvil node is running on port ${CHAIN_PORT} (PID ${pid}), but it is not a recorded run of this deployment's chain.`,
      "TrustLayer will not adopt or stop it. Stop it yourself, then run this command again.",
    );
  await verifyChain(session, manifest);
  // A live `npm run chain` controller owns its node: use it, never stop it.
  const controller = nodeProcessesMatching("local-chain.ts").length > 0;
  const mode: Mode =
    !controller && samePath(image, anvilBinary) ? "adopted" : "external";
  return { session, mode };
}

// ---------- consistency ----------
async function checkConsistency(manifest: LocalDeployment) {
  step("Checking saved project data against the chain (read-only)");
  const result = await new Promise<string>((ok_, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--env-file-if-exists=.env.local",
        "--import",
        "tsx",
        "scripts/dev-consistency.ts",
        manifestPath,
      ],
      { cwd: webDir, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", () => undefined);
    child.on("error", reject);
    child.on("close", () => ok_(out.trim().split(/\r?\n/).at(-1) ?? ""));
  });
  let parsed: {
    status: string;
    message?: string;
    maxProjectId?: string;
    maxDisputeId?: string;
    maxConfirmedBlock?: string;
    receipts?: {
      hash: string;
      block?: string;
      found: boolean;
      foundBlock?: string;
    }[];
    chain?: { nextProjectId: string; nextDisputeId: string; head: string };
    rows?: { projects: number; files: number };
  };
  try {
    parsed = JSON.parse(result);
  } catch {
    warn(
      "Could not run the consistency check; continuing with the newest checkpoint.",
    );
    return;
  }
  if (parsed.status === "unconfigured") {
    warn(
      "DATABASE_URL is not configured: skipped. Sign-in will be unavailable.",
    );
    return;
  }
  if (parsed.status === "unreachable") {
    warn(
      `Database unreachable (${parsed.message}); skipped. The newest checkpoint was restored, so nothing newer is known locally.`,
    );
    return;
  }
  if (parsed.status === "no-records") {
    ok("No saved metadata for this deployment yet");
    return;
  }
  const big = (v?: string) => (v === undefined ? undefined : BigInt(v));
  const problems = consistencyProblems({
    maxProjectId: big(parsed.maxProjectId),
    maxDisputeId: big(parsed.maxDisputeId),
    maxConfirmedBlock: big(parsed.maxConfirmedBlock),
    receipts: (parsed.receipts ?? []).map((r) => ({
      hash: r.hash,
      block: big(r.block),
      found: r.found,
      foundBlock: big(r.foundBlock),
    })),
    chain: {
      nextProjectId: BigInt(parsed.chain!.nextProjectId),
      nextDisputeId: BigInt(parsed.chain!.nextDisputeId),
      head: BigInt(parsed.chain!.head),
    },
  });
  if (problems.length) return problems;
  ok(
    `${parsed.rows?.projects ?? 0} saved project(s) and ${parsed.rows?.files ?? 0} file record(s) match the chain`,
  );
}

// ---------- web ----------
async function startWeb(previous: DevState | undefined) {
  const origin = webOrigin();
  const url = new URL(origin);
  const port = Number(url.port || 80);
  const occupant = listeningPid(port);
  if (occupant) {
    const command = processCommandLine(occupant) ?? "";
    if (previous?.webPid === occupant && /next/.test(command)) {
      warn(
        `Stopping the app server left running by an earlier session (PID ${occupant}).`,
      );
      stopTree(occupant);
      for (let i = 0; i < 20 && listeningPid(port); i++) await delay(250);
    } else
      fail(
        `Port ${port} is already in use (PID ${occupant}${processPath(occupant) ? `, ${processPath(occupant)}` : ""}).`,
        "TrustLayer will not stop it. Close that program (or an older `npm run web:dev`), then run this command again.",
      );
  }
  step("Publishing the verified deployment to the app");
  await run(process.execPath, ["scripts/sync-deployment.mjs"], webDir, true);
  ok(
    "apps/web/public/deployments/31337.json updated from the verified manifest",
  );
  step("Starting the web app (Next.js dev server)");
  const child = spawn(
    process.execPath,
    [
      join(webDir, "node_modules", "next", "dist", "bin", "next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: webDir, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  const prefix = (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/))
      if (line.trim()) console.log(`  web │ ${line}`);
  };
  child.stdout?.on("data", prefix);
  child.stderr?.on("data", prefix);
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null)
      fail("The web app exited during startup. See the `web │` lines above.");
    try {
      const response = await fetch(`${origin}/sign-in`, { redirect: "manual" });
      if (response.status < 500) return { child, origin };
    } catch {
      /* still starting */
    }
    await delay(500);
  }
  stopTree(child.pid!);
  fail("The web app did not become ready within 2 minutes.");
}
function run(
  command: string,
  args: string[],
  cwd: string,
  quiet = false,
  env?: NodeJS.ProcessEnv,
) {
  return new Promise<void>((ok_, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: quiet ? "ignore" : "inherit",
      env: env ?? process.env,
      shell: windows && /\.cmd$/i.test(command),
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? ok_()
        : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`)),
    );
  });
}

// ---------- shutdown ----------
async function finalBackup(
  session: ChainSession,
  manifest: LocalDeployment,
  name: string,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    const path = backupPath(name);
    try {
      await backupChain(session, path, manifest);
      await readBackup(path); // re-read: checksum and version must verify
      return path;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : "";
      if (!/pending|queued|advanced|arrived/i.test(message)) break;
      if (attempt === 0) info("Waiting for pending transactions to confirm…");
      await delay(2000);
    }
  }
  throw lastError;
}
async function waitPortFree(port: number, seconds: number) {
  for (let i = 0; i < seconds * 4 && listeningPid(port); i++) await delay(250);
  return !listeningPid(port);
}

// ---------- commands ----------
async function start(argv: string[]) {
  const explicitBackup = option(argv, "--backup");
  const noWeb = argv.includes("--no-web");
  console.log("TrustLayer — starting the local environment");
  preflight();
  const manifest = readManifest();
  const previous = readState();
  if (wrapperAlive(previous))
    fail(
      `TrustLayer is already running (PID ${previous!.wrapperPid}).`,
      `Open ${previous!.webUrl ?? "the app"} or stop it with: ${npm} run dev:stop`,
    );
  ok(`Deployment ${manifest.deploymentId} on chain ${manifest.chainId}`);

  step("Locating the TrustLayer blockchain");
  let session: ChainSession;
  let mode: Mode;
  let child: ChildProcess | undefined;
  let restoredFrom: string | undefined;
  let name: string;
  const occupant = listeningPid(CHAIN_PORT);
  if (occupant) {
    ({ session, mode } = await adoptRunningChain(manifest, occupant));
    name = session.name;
    ok(
      mode === "adopted"
        ? `Reusing the chain that is still running from an earlier session (PID ${occupant}); no restore needed`
        : `Using a managed chain run by another terminal (PID ${occupant}); it stays under that terminal's control`,
    );
  } else {
    const choice = explicitBackup
      ? (() => {
          const header = backupHeader(resolve(explicitBackup));
          if (!header) fail(`Cannot read backup ${explicitBackup}.`);
          return selectBackup([header], manifest.chainIdentity!);
        })()
      : selectBackup(listBackups(), manifest.chainIdentity!);
    if (choice.kind === "none")
      fail(
        choice.reason,
        "A new chain is never created automatically, because it would orphan saved projects.",
        "If the chain is truly lost, see 'Recovery' in docs/UI_REDESIGN_HANDOVER.md.",
      );
    if (choice.kind === "ambiguous")
      fail(
        choice.reason,
        "Choose the correct one explicitly:",
        ...choice.candidates.map(
          (c) =>
            `  ${npm} run dev -- --backup ${rel(c.path)}   (block ${c.head.number}, ${new Date(c.mtimeMs).toLocaleString()})`,
        ),
      );
    const backup = await readBackup(choice.backup.path).catch((error) =>
      fail(
        `The newest backup could not be loaded: ${error instanceof Error ? error.message : "unknown error"}`,
        "It was not skipped silently. Investigate it, or pass an older one with --backup PATH after checking it is safe.",
      ),
    );
    if (backup.manifest) {
      const saved = parseLocalDeployment(backup.manifest);
      if (
        saved.deploymentId !== manifest.deploymentId ||
        saved.verifiedBlock.hash !== manifest.verifiedBlock.hash ||
        JSON.stringify(saved.contracts) !== JSON.stringify(manifest.contracts)
      )
        fail(
          "The backup's saved deployment differs from the active manifest.",
          "Nothing was started. Compare the two before deciding which one is correct.",
        );
    }
    name = runName(new Date());
    if (existsSync(sessionPath(name))) name = runName(new Date(), "-b");
    info(
      `Restoring ${rel(choice.backup.path)} (block ${choice.backup.head.number}, saved ${new Date(choice.backup.mtimeMs).toLocaleString()})`,
    );
    const started = await startChain(name, CHAIN_PORT, backup);
    session = started.session;
    child = started.child;
    mode = "owned";
    restoredFrom = choice.backup.path;
    ok(`Restored the chain (identity ${session.identity.hash.slice(0, 10)}…)`);
  }
  const state: DevState = {
    format: 1,
    wrapperPid: process.pid,
    mode,
    runName: name,
    nodePid: session.nodePid,
    restoredFrom,
    startedAt: new Date().toISOString(),
  };
  writeState(state);

  let web: ChildProcess | undefined;
  let stopping = false;
  let checkpointing = false;
  try {
    const client = await verifyChain(session, manifest);
    ok(
      `Chain identity, deployed contracts and manifest verified (head block ${await client.getBlockNumber({ cacheTime: 0 })})`,
    );
    const problems = await checkConsistency(manifest);
    if (problems?.length)
      fail(
        "Saved project data is newer than this chain checkpoint:",
        ...problems.map((p) => `- ${p}`),
        "Continuing could reuse project or dispute IDs. Nothing was changed.",
        mode === "owned"
          ? "Restore a newer backup with --backup PATH, or see 'Recovery' in docs/UI_REDESIGN_HANDOVER.md."
          : "Investigate before using the app.",
      );
    if (!noWeb) {
      const started = await startWeb(previous);
      web = started.child;
      state.webPid = web.pid;
      state.webUrl = started.origin;
      writeState(state);
    }
  } catch (error) {
    if (web?.pid) stopTree(web.pid);
    if (mode === "owned" && child) {
      // Freshly restored and unchanged: identical to its backup, safe to stop.
      await stopNode(child);
      rmSync(statePath, { force: true });
    } else if (mode === "adopted")
      // Keep the record so `dev:stop` can still back up and stop the orphan.
      writeState({ ...state, wrapperPid: 0, webPid: undefined });
    else rmSync(statePath, { force: true });
    throw error;
  }

  const origin = state.webUrl;
  console.log(`
  ──────────────────────────────────────────────────────────────
  TrustLayer is running
    App         ${origin ?? "(not started: --no-web)"}
    Blockchain  ${RPC_URL}  (Anvil, chain 31337${restoredFrom ? `, restored from ${rel(restoredFrom)}` : ""})
    Deployment  ${manifest.deploymentId}
    Stop        Ctrl+C here, or "${npm} run dev:stop" in another terminal
  ──────────────────────────────────────────────────────────────
`);
  if (mode === "external")
    warn(
      "The chain belongs to another terminal; this session will not back it up or stop it.",
    );

  let lastHead = await chainClient(session)
    .getBlock({ blockTag: "latest" })
    .then((b) => b.hash)
    .catch(() => undefined);
  const checkpoint = setInterval(async () => {
    if (stopping || checkpointing || mode === "external") return;
    checkpointing = true;
    try {
      const head = (await chainClient(session).getBlock({ blockTag: "latest" }))
        .hash;
      if (head !== lastHead) {
        // Immutable checkpoints only when the chain changed (idle chains add no files).
        await backupChain(session, backupPath(name));
        lastHead = head;
        info(`checkpoint saved (${new Date().toLocaleTimeString()})`);
      }
    } catch (error) {
      warn(
        `Checkpoint skipped: ${error instanceof Error ? error.message.split(".")[0] : "error"}. Retrying in a minute.`,
      );
    } finally {
      checkpointing = false;
    }
  }, 60_000);
  const stopPoll = setInterval(() => {
    if (existsSync(stopRequestPath))
      void shutdown("stop requested by dev:stop");
  }, 1000);

  async function shutdown(reason: string) {
    if (stopping) return;
    stopping = true;
    clearInterval(stopPoll);
    clearInterval(checkpoint);
    rmSync(stopRequestPath, { force: true });
    console.log(`\n• Stopping TrustLayer (${reason})`);
    while (checkpointing) await delay(100);
    if (web?.pid) {
      stopTree(web.pid);
      ok("Web app stopped");
    }
    const result = {
      ok: true,
      backup: undefined as string | undefined,
      message: "",
    };
    if (mode === "external") {
      result.message = "Chain left running under its own terminal.";
      ok(result.message);
    } else {
      try {
        const path = await finalBackup(session, manifest, name);
        result.backup = path;
        ok(`Backup saved and verified: ${rel(path)}`);
        if (mode === "owned" && child) await stopNode(child);
        else if (ownsNode(session.nodePid)) process.kill(session.nodePid!);
        if (await waitPortFree(CHAIN_PORT, 10)) ok("Blockchain stopped");
        else
          warn("The chain process did not exit; check `npm run dev:status`.");
        rmSync(statePath, { force: true });
      } catch (error) {
        result.ok = false;
        result.message =
          error instanceof Error ? error.message : "Backup failed.";
        console.error(`  ✗ Backup failed: ${result.message}`);
        console.error(
          `    The blockchain is still running, so nothing was lost. Resolve the problem, then run: ${npm} run dev:stop`,
        );
        if (/queued/i.test(result.message))
          console.error(
            `    Queued (nonce-gapped) transactions never confirm on their own. List them with: ${npm} run dev:drop-queued`,
          );
        writeState({ ...state, wrapperPid: 0, webPid: undefined });
      }
    }
    writeFileSync(
      stopResultPath,
      JSON.stringify({ ...result, at: Date.now() }),
    );
    process.exit(result.ok ? 0 : 1);
  }
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const)
    process.on(
      signal,
      () => void shutdown(signal === "SIGHUP" ? "terminal closed" : "Ctrl+C"),
    );
  web?.on("exit", (code) => {
    if (!stopping)
      warn(
        `The web app exited (code ${code}). The blockchain is still running; press Ctrl+C to back it up and stop.`,
      );
  });
}

async function stop() {
  const state = readState();
  if (!state) {
    console.log("No TrustLayer dev session is recorded; nothing to stop.");
    const pid = listeningPid(CHAIN_PORT);
    if (pid)
      console.log(
        `Port ${CHAIN_PORT} is in use by PID ${pid}. If it is a 'npm run chain' controller, press Ctrl+C in that terminal.`,
      );
    return;
  }
  if (wrapperAlive(state)) {
    console.log(
      `Asking the running session (PID ${state.wrapperPid}) to back up and stop…`,
    );
    rmSync(stopResultPath, { force: true });
    const requested = Date.now();
    writeFileSync(stopRequestPath, String(requested));
    for (let i = 0; i < 480; i++) {
      await delay(250);
      if (existsSync(stopResultPath)) {
        const result = JSON.parse(readFileSync(stopResultPath, "utf8")) as {
          ok: boolean;
          backup?: string;
          message: string;
          at: number;
        };
        if (result.at < requested) continue;
        if (result.ok) {
          console.log(
            `✓ Stopped.${result.backup ? ` Backup: ${rel(result.backup)}` : ""}`,
          );
          return;
        }
        fail(
          `Stop failed: ${result.message}`,
          "The blockchain is still running.",
        );
      }
      if (!isAlive(state.wrapperPid)) break;
    }
    if (isAlive(state.wrapperPid))
      fail("The running session did not respond within 2 minutes.");
  }
  // The terminal that started TrustLayer is gone (closed or crashed).
  console.log(
    "The terminal that started TrustLayer is no longer running; cleaning up.",
  );
  if (state.webPid && /next/.test(processCommandLine(state.webPid) ?? "")) {
    stopTree(state.webPid);
    console.log(`✓ Stopped the leftover web app (PID ${state.webPid})`);
  }
  if (state.mode !== "external" && ownsNode(state.nodePid)) {
    const manifest = readManifest();
    const session = findSession(state.nodePid!, manifest);
    if (!session)
      fail(
        "Cannot find the session record for the running chain; it was left running.",
      );
    const path = await finalBackup(session, manifest, state.runName);
    console.log(`✓ Backup saved and verified: ${rel(path)}`);
    process.kill(state.nodePid!);
    if (await waitPortFree(CHAIN_PORT, 10)) console.log("✓ Blockchain stopped");
  } else if (
    state.nodePid &&
    isAlive(state.nodePid) &&
    state.mode !== "external"
  )
    fail(
      `PID ${state.nodePid} is alive but could not be verified as the TrustLayer chain; it was left running.`,
    );
  else
    console.log(
      "The blockchain was not running. The latest checkpoint will be restored next time.",
    );
  rmSync(statePath, { force: true });
}

async function status() {
  const state = readState();
  const manifest = existsSync(manifestPath) ? readManifest() : undefined;
  console.log("TrustLayer local environment");
  console.log(
    `  Session     ${state ? (wrapperAlive(state) ? `running (PID ${state.wrapperPid}, ${state.mode} chain)` : `stale record (${state.mode} chain)`) : "not running"}`,
  );
  if (state?.webUrl) console.log(`  App         ${state.webUrl}`);
  const pid = listeningPid(CHAIN_PORT);
  if (pid && manifest?.chainIdentity) {
    try {
      const client = chainClient({ rpcUrl: RPC_URL });
      const anchor = await client.getBlock({
        blockNumber: BigInt(manifest.chainIdentity.number),
      });
      const matches = anchor.hash === manifest.chainIdentity.hash;
      console.log(
        `  Blockchain  PID ${pid}, head ${await client.getBlockNumber({ cacheTime: 0 })}, ${matches ? "identity matches the manifest" : "DIFFERENT chain identity"}`,
      );
      const pool = await readPool().catch(() => undefined);
      if (pool?.length)
        console.log(
          `  Mempool     ${pool.filter((t) => t.status === "pending").length} pending, ${pool.filter((t) => t.status === "queued").length} queued (nonce-gapped: see ${npm} run dev:drop-queued)`,
        );
    } catch {
      console.log(
        `  Blockchain  port ${CHAIN_PORT} in use by PID ${pid} (not a readable chain)`,
      );
    }
  } else
    console.log(
      `  Blockchain  ${pid ? `port in use by PID ${pid}` : "stopped"}`,
    );
  if (manifest?.chainIdentity) {
    const choice = selectBackup(listBackups(), manifest.chainIdentity);
    console.log(
      `  Restore     ${choice.kind === "selected" ? `${rel(choice.backup.path)} (block ${choice.backup.head.number}, ${choice.considered} backups)` : choice.reason}`,
    );
  }
}

async function init(argv: string[]) {
  const name = option(argv, "--name");
  if (!name)
    fail(`Usage: ${npm} run dev:init -- --name NAME [--archive-current]`);
  console.log(`TrustLayer — first-time setup of a NEW local chain "${name}"`);
  preflight();
  if (!existsSync(resolve("artifacts")))
    fail("Contracts are not compiled.", `Run: ${npm} run compile`);
  if (wrapperAlive(readState()) || listeningPid(CHAIN_PORT))
    fail(
      `Port ${CHAIN_PORT} is in use or TrustLayer is running. Stop it first (${npm} run dev:stop).`,
    );
  sessionPath(name); // validates the name
  if (existsSync(sessionPath(name)))
    fail(`A chain run named "${name}" already exists. Choose a new name.`);
  const deploymentId = `trustlayer-${name}`;
  if (existsSync(resolve("ignition", "deployments", deploymentId)))
    fail(
      `Ignition deployment ${deploymentId} already exists. Choose a new name.`,
    );
  if (existsSync(manifestPath)) {
    if (!argv.includes("--archive-current"))
      fail(
        "An active deployment manifest already exists.",
        "Creating a new chain starts a new, empty deployment; existing projects stay with the old one.",
        `If that is what you want, re-run with --archive-current to move the current manifest to .local-chain/archive/.`,
        `For everyday startup use: ${npm} run dev`,
      );
    mkdirSync(join(chainRoot, "archive"), { recursive: true });
    const archived = join(chainRoot, "archive", `31337-${Date.now()}.json`);
    if (existsSync(archived))
      fail("Archive destination exists; nothing was moved.");
    renameSync(manifestPath, archived);
    ok(`Archived the previous manifest to ${rel(archived)}`);
    info(
      `To undo: Move-Item -LiteralPath '${archived}' -Destination '${manifestPath}'`,
    );
  }
  step("Starting a NEW chain");
  const { child, session } = await startChain(name, CHAIN_PORT);
  ok(`New chain identity ${session.identity.hash.slice(0, 10)}…`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LOCAL_RPC_URL: RPC_URL,
    TRUSTLAYER_DEPLOYMENT_ID: deploymentId,
    TRUSTLAYER_CHAIN_SESSION: sessionPath(name),
  };
  delete env.TRUSTLAYER_ANCHOR_MANIFEST;
  delete env.TRUSTLAYER_EXPORT_EPHEMERAL;
  delete env.TRUSTLAYER_EXPORT_PATH;
  const npx = windows ? "npx.cmd" : "npx";
  try {
    step("Deploying contracts (Ignition, Phase2D)");
    await run(
      npx,
      [
        "hardhat",
        "ignition",
        "deploy",
        "ignition/modules/Phase2D.ts",
        "--network",
        "localhost",
        "--deployment-id",
        deploymentId,
      ],
      process.cwd(),
      false,
      env,
    );
    step("Exporting and verifying the deployment");
    await run(npm, ["run", "export:contracts"], process.cwd(), false, env);
    await run(process.execPath, ["scripts/sync-deployment.mjs"], webDir, true);
    ok("Deployment exported and published to the app");
    if (process.env.TRUSTLAYER_CLIENT) {
      step("Provisioning development wallets");
      await run(npm, ["run", "provision:wallets"], process.cwd(), false, env);
    } else
      info(
        "Wallet provisioning skipped (set TRUSTLAYER_CLIENT, _FREELANCER, _JUROR_1.._3 to fund wallets; see docs/PHASE5.md).",
      );
    const manifest = readManifest();
    const path = await finalBackup(session, manifest, name);
    ok(`Initial backup saved: ${rel(path)}`);
  } catch (error) {
    console.error(
      `  ✗ Setup failed: ${error instanceof Error ? error.message : "unknown error"}. The new chain is being stopped; nothing else was changed.`,
    );
    await stopNode(child);
    throw new Stop("setup failed");
  }
  await stopNode(child);
  console.log(
    `\n✓ Setup complete. Start TrustLayer any time with: ${npm} run dev`,
  );
}

type PoolEntry = { hash: `0x${string}`; nonce: string; from: string };
async function readPool() {
  const client = chainClient({ rpcUrl: RPC_URL });
  const content = (await client.request({
    method: "txpool_content",
  } as never)) as Record<
    "pending" | "queued",
    Record<string, Record<string, PoolEntry>>
  >;
  const list = (status: "pending" | "queued") =>
    Object.values(content[status] ?? {}).flatMap((byNonce) =>
      Object.values(byNonce).map((t) => ({ ...t, status })),
    );
  return [...list("pending"), ...list("queued")];
}
/**
 * Explicit operator recovery: remove named transactions that are stuck behind
 * a nonce gap from the managed node's mempool. Only mempool entries are
 * touched (never chain state, balances or nonces), and each hash must be
 * verified as unmined, receipt-less and nonce-gapped first.
 */
async function dropQueued(argv: string[]) {
  const manifest = readManifest();
  const pid = listeningPid(CHAIN_PORT);
  if (!pid)
    fail("The local chain is not running. Start it with: " + npm + " run dev");
  const session = findSession(pid, manifest);
  if (!session)
    fail(
      `Port ${CHAIN_PORT} is not a recorded run of this deployment's chain; nothing was changed.`,
    );
  const client = await verifyChain(session, manifest);
  const hashes = argv
    .map((value, i) => (argv[i - 1] === "--hash" ? value : undefined))
    .filter((v): v is string => !!v);
  const pool = await readPool();
  const queued = pool.filter((t) => t.status === "queued");
  if (!hashes.length) {
    if (!queued.length) {
      console.log("No queued (nonce-gapped) transactions in the local node.");
      return;
    }
    console.log(
      "Queued transactions that cannot be mined (nothing was changed):",
    );
    for (const t of queued)
      console.log(`  ${t.hash}  from ${t.from}  nonce ${BigInt(t.nonce)}`);
    console.log(`
To remove specific ones: ${npm} run dev:drop-queued -- --hash 0x... [--hash 0x...]`);
    return;
  }
  for (const hash of hashes) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
      fail(`Invalid transaction hash: ${hash}`);
    const entry = queued.find(
      (t) => t.hash.toLowerCase() === hash.toLowerCase(),
    );
    if (!entry)
      fail(
        `${hash} is not a queued transaction in the local node; nothing was changed.`,
      );
    const receipt = await client
      .getTransactionReceipt({ hash: hash as `0x${string}` })
      .catch(() => undefined);
    if (receipt)
      fail(`${hash} has a receipt (it was mined); it will not be dropped.`);
    const tx = await client.getTransaction({ hash: hash as `0x${string}` });
    const expected = await client.getTransactionCount({
      address: tx.from,
      blockTag: "latest",
    });
    if (tx.blockNumber !== null || tx.nonce <= expected)
      fail(
        `${hash} (nonce ${tx.nonce}) is not behind a nonce gap (chain expects ${expected}); it will not be dropped.`,
      );
  }
  // Anvil 1.7.1 ignores anvil_dropTransaction for queued entries; the only
  // pool-only removal is per sender. Use it only when every pooled entry of
  // that sender was named and verified above.
  const senders = new Set(
    queued
      .filter((t) =>
        hashes.some((h) => h.toLowerCase() === t.hash.toLowerCase()),
      )
      .map((t) => t.from.toLowerCase()),
  );
  for (const sender of senders) {
    const entries = pool.filter((t) => t.from.toLowerCase() === sender);
    const unnamed = entries.filter(
      (t) => !hashes.some((h) => h.toLowerCase() === t.hash.toLowerCase()),
    );
    if (unnamed.length)
      fail(
        `${sender} has other pooled transactions that were not named; nothing was changed:`,
        ...unnamed.map(
          (t) => `  ${t.hash} (${t.status}, nonce ${BigInt(t.nonce)})`,
        ),
      );
    await client.request({
      method: "anvil_removePoolTransactions",
      params: [sender],
    } as never);
    const remaining = (await readPool()).filter(
      (t) => t.from.toLowerCase() === sender,
    );
    if (remaining.length)
      fail(`The node did not remove the queued transactions of ${sender}.`);
    for (const t of entries)
      console.log(
        `✓ Removed queued transaction ${t.hash} (nonce ${BigInt(t.nonce)}; it never executed).`,
      );
  }
  console.log(
    "Next: in MetaMask (local network, this account) use Settings → Advanced → Clear activity and nonce data, then reload TrustLayer.",
  );
}

function option(argv: string[], key: string) {
  const i = argv.indexOf(key);
  return i >= 0 ? argv[i + 1] : undefined;
}

const [command = "start", ...rest] = process.argv.slice(2);
try {
  if (command === "start") await start(rest);
  else if (command === "stop") await stop();
  else if (command === "status") await status();
  else if (command === "init") await init(rest);
  else if (command === "drop-queued") await dropQueued(rest);
  else fail(`Unknown command "${command}". Use start, stop, status or init.`);
} catch (error) {
  if (!(error instanceof Stop))
    console.error(
      `\n  ✗ ${error instanceof Error ? error.message : String(error)}`,
    );
  process.exitCode = 1;
  // Exit explicitly: a failed startup must not leave timers holding the process.
  setTimeout(() => process.exit(1), 50);
}
