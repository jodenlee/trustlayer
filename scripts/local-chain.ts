import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  backupChain,
  chainRoot,
  checkSession,
  readBackup,
  readSession,
  sessionPath,
  startChain,
  stopNode,
} from "./lib/local-chain.js";
import {
  assertDeploymentOnChain,
  parseLocalDeployment,
} from "../packages/contracts/src/index.js";

const args = process.argv.slice(2);
const operation = args[0];
const accepted = new Set([
  "--name",
  ...(operation === "restore"
    ? ["--backup"]
    : operation === "backup"
      ? ["--output"]
      : []),
]);
for (let i = 1; i < args.length; i += 2)
  if (!accepted.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--"))
    throw new Error(
      "Invalid option. Use --name, --backup or --output with an explicit value.",
    );
function option(key: string) {
  const i = args.indexOf(`--${key}`);
  return i < 0 ? undefined : args[i + 1];
}
const name = option("name");
if (!name || !["fresh", "restore", "backup", "status"].includes(operation))
  throw new Error(
    "Usage: npm run chain -- fresh|restore|backup|status --name UNIQUE_NAME [--backup PATH] [--output PATH]",
  );
const manifestPath = resolve(
  "packages/contracts/generated/deployments/31337.json",
);
async function manifestFor(session: Awaited<ReturnType<typeof readSession>>) {
  let raw;
  try {
    raw = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
  // A stale existing export must be diagnosed rather than included in a backup.
  const manifest = parseLocalDeployment(raw);
  await assertDeploymentOnChain(await checkSession(session), manifest);
  return manifest;
}
if (operation === "backup" || operation === "status") {
  const session = await readSession(name);
  const client = await checkSession(session);
  if (operation === "status") {
    console.log(
      `Managed Anvil chain 31337; identity ${session.identity.hash}; head ${await client.getBlockNumber({ cacheTime: 0 })}.`,
    );
    await manifestFor(session);
    console.log(
      "Existing deployment export matches (or no export exists yet).",
    );
  } else {
    if (!option("output"))
      throw new Error(
        "Specify a new --output backup path. Existing backups are never overwritten.",
      );
    await backupChain(
      session,
      resolve(option("output")!),
      await manifestFor(session),
    );
    console.log(
      "Immutable backup written. Stop wallet activity before shutdown.",
    );
  }
} else {
  if (operation === "restore" && !option("backup"))
    throw new Error(
      "Restore requires --backup PATH; no fresh fallback is allowed.",
    );
  const backup =
    operation === "restore"
      ? await readBackup(resolve(option("backup")!))
      : undefined;
  const run = await startChain(name, 8545, backup);
  console.log(
    `${backup ? "RESTORED" : "NEW"} local chain 31337; identity ${run.session.identity.hash}. Session: ${sessionPath(name)}`,
  );
  if (backup?.manifest) {
    try {
      await assertDeploymentOnChain(
        run.client,
        parseLocalDeployment(backup.manifest),
      );
    } catch (error) {
      await stopNode(run.child);
      throw error;
    }
    console.log(
      "Backup deployment verified. Existing manifest has NOT been overwritten; compare/recover it explicitly from the backup if needed.",
    );
  }
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    try {
      const path = resolve(chainRoot, "backups", `${name}-${Date.now()}.json`);
      await backupChain(run.session, path, await manifestFor(run.session));
      console.log(`Shutdown backup: ${path}`);
      await stopNode(run.child);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Backup failed.");
      console.error(
        "Node remains running. Resolve the failure, back up explicitly, then press Ctrl+C again.",
      );
      stopping = false;
    }
  }
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
  // Immutable periodic checkpoints bound crash loss; never write a mutable latest snapshot.
  const interval = setInterval(() => {
    if (!stopping)
      void backupChain(
        run.session,
        resolve(chainRoot, "backups", `${name}-${Date.now()}.json`),
      ).catch(() =>
        console.error(
          "Checkpoint failed. Pause wallet activity and create an explicit backup.",
        ),
      );
  }, 60_000);
  await new Promise<void>((ok) =>
    run.child.once("close", () => {
      clearInterval(interval);
      ok();
    }),
  );
}
