import { createHash, randomUUID } from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  toHex,
  type Hex,
} from "viem";
import { hardhat } from "viem/chains";

export const chainRoot = resolve(".local-chain");
export const anvilBinary =
  process.env.ANVIL_BINARY ??
  resolve("node_modules/@foundry-rs/anvil-win32-amd64/bin/anvil.exe");
export type Identity = { number: string; hash: Hex };
export type ChainSession = {
  format: 1;
  name: string;
  rpcUrl: string;
  version: string;
  identity: Identity;
  nodePid?: number;
};
export type ChainBackup = {
  format: 1;
  session: ChainSession;
  head: Identity;
  state: Hex;
  checksum: string;
  manifest?: unknown;
};
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const backupDigest = (b: Omit<ChainBackup, "checksum">) =>
  digest(
    JSON.stringify([b.format, b.session, b.head, b.state, b.manifest ?? null]),
  );
export function sessionPath(name: string) {
  if (!/^[a-z][a-z0-9_-]{0,79}$/i.test(name))
    throw new Error(
      "Use a unique alphanumeric chain name (maximum 80 characters).",
    );
  return resolve(chainRoot, "runs", name, "session.json");
}
export const chainClient = (session: Pick<ChainSession, "rpcUrl">) =>
  createPublicClient({
    chain: hardhat,
    transport: http(session.rpcUrl, { retryCount: 0, timeout: 10_000 }),
  });
export function binaryVersion() {
  return execFileSync(anvilBinary, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}
export async function requireFreePort(port: number) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid local port.");
  const server = createServer();
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", ok);
  });
  await new Promise<void>((ok, fail) =>
    server.close((error) => (error ? fail(error) : ok())),
  );
}
export async function stopNode(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  child.kill();
  await closed;
}
export async function checkSession(session: ChainSession) {
  if (
    session.format !== 1 ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(session.rpcUrl)
  )
    throw new Error("Invalid managed local chain session.");
  const client = chainClient(session);
  if ((await client.getChainId()) !== 31337)
    throw new Error("Only chain 31337 is supported.");
  if (
    !(await client.request({ method: "web3_clientVersion" }))
      .toLowerCase()
      .startsWith("anvil/")
  )
    throw new Error(
      "This operation requires the approved Anvil backend; Hardhat state cannot be dumped.",
    );
  if (
    (await client.getBlock({ blockNumber: BigInt(session.identity.number) }))
      .hash !== session.identity.hash
  )
    throw new Error(
      "Fresh/reset chain detected: identity anchor mismatch. Restore the correct backup; do not rebind historical metadata.",
    );
  return client;
}
export async function readSession(name: string): Promise<ChainSession> {
  return JSON.parse(await readFile(sessionPath(name), "utf8"));
}
export async function backupChain(
  session: ChainSession,
  output: string,
  manifest?: unknown,
) {
  const client = await checkSession(session);
  if (binaryVersion() !== session.version)
    throw new Error(
      "Anvil binary version differs from this session. Use the recorded version.",
    );
  const head = await client.getBlock({ blockTag: "latest" });
  // State dumps omit the mempool, including nonce-gapped queued transactions
  // that would not appear in the executable pending block.
  const pool = (await client.request({ method: "txpool_status" } as never)) as {
    pending: Hex;
    queued: Hex;
  };
  if (BigInt(pool.pending) !== 0n || BigInt(pool.queued) !== 0n)
    throw new Error(
      "Pending or queued transactions exist. Confirm/drop them explicitly before backing up; mempool transactions are not state snapshots.",
    );
  const pending = await client.getBlock({ blockTag: "pending" });
  if (pending.transactions.length)
    throw new Error(
      "Pending transactions exist. Confirm them and stop wallet activity before backing up.",
    );
  const state = (await client.request({
    method: "anvil_dumpState",
    params: [true],
  } as never)) as Hex;
  const poolAfter = (await client.request({
    method: "txpool_status",
  } as never)) as { pending: Hex; queued: Hex };
  if (BigInt(poolAfter.pending) !== 0n || BigInt(poolAfter.queued) !== 0n)
    throw new Error(
      "Pending or queued transactions arrived during export. Pause wallet activity and retry; no backup written.",
    );
  if ((await client.getBlock({ blockTag: "latest" })).hash !== head.hash)
    throw new Error(
      "Chain advanced while exporting. Pause wallet activity and retry; no backup written.",
    );
  const fields = {
    format: 1 as const,
    session,
    head: { number: head.number.toString(), hash: head.hash! },
    state,
    ...(manifest ? { manifest } : {}),
  };
  const value: ChainBackup = { ...fields, checksum: backupDigest(fields) };
  await mkdir(resolve(output, ".."), { recursive: true });
  const file = await open(output, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  return value;
}
export async function readBackup(path: string): Promise<ChainBackup> {
  let b: ChainBackup;
  try {
    b = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(
      "Missing or unreadable backup. Nothing was started or reset.",
    );
  }
  if (!b || typeof b !== "object" || !b.session || !b.head)
    throw new Error(
      "Corrupted or incompatible backup. Nothing was started or reset.",
    );
  if (b.session?.version !== binaryVersion())
    throw new Error(
      "Incompatible Anvil version. Install the exact version recorded in the backup.",
    );
  if (
    b.format !== 1 ||
    !/^0x(?:[0-9a-f]{2})+$/i.test(b.state ?? "") ||
    b.checksum !== backupDigest(b)
  )
    throw new Error(
      "Corrupted or incompatible backup. Nothing was started or reset.",
    );
  return b;
}
/** Owns only the process it starts. Never attaches to, resets, or kills another node. */
export async function startChain(
  name: string,
  port = 8545,
  backup?: ChainBackup,
) {
  if (backup && backup.checksum !== backupDigest(backup))
    throw new Error("Corrupted backup; no node started.");
  const path = sessionPath(name);
  await requireFreePort(port);
  const version = binaryVersion();
  if (backup && backup.session.version !== version)
    throw new Error("Incompatible Anvil version.");
  await mkdir(resolve(path, ".."), { recursive: true });
  // Exclusive reservation ensures an existing run is never reused silently.
  await writeFile(path, JSON.stringify({ initializing: true }), { flag: "wx" });
  const rpcUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    anvilBinary,
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      "31337",
      "--accounts",
      "20",
      "--silent",
      "--preserve-historical-states",
    ],
    {
      windowsHide: true,
      detached: process.platform === "win32",
      stdio: "ignore",
    },
  );
  let spawnError: Error | undefined;
  child.on("error", (e) => {
    spawnError = e;
  });
  const client = chainClient({ rpcUrl });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null)
        throw new Error("Anvil exited before startup.");
      try {
        ready = (await client.getChainId()) === 31337;
      } catch {
        /* startup only */
      }
      if (ready) break;
      await delay(100);
    }
    if (!ready) throw new Error("Anvil startup timed out.");
    let identity: Identity;
    if (backup) {
      if (
        !(await client.request({
          method: "anvil_loadState",
          params: [backup.state],
        } as never))
      )
        throw new Error("Anvil refused the snapshot.");
      if (
        (await client.getBlock({ blockTag: "latest" })).hash !==
        backup.head.hash
      )
        throw new Error(
          "Restored head differs from backup; refusing recovery.",
        );
      identity = backup.session.identity;
    } else {
      const accounts = (await client.request({
        method: "eth_accounts",
      } as never)) as Hex[];
      const account = accounts[19];
      if (!account)
        throw new Error("Expected unlocked local development accounts.");
      const wallet = createWalletClient({
        account,
        chain: hardhat,
        transport: http(rpcUrl),
      });
      const hash = await wallet.sendTransaction({
        to: account,
        data: toHex(`TrustLayer local chain ${randomUUID()}`),
      });
      const receipt = await client.waitForTransactionReceipt({ hash });
      identity = {
        number: receipt.blockNumber.toString(),
        hash: receipt.blockHash,
      };
    }
    const session: ChainSession = {
      format: 1,
      name,
      rpcUrl,
      version,
      identity,
      nodePid: child.pid,
    };
    await checkSession(session);
    await writeFile(path, JSON.stringify(session, null, 2));
    return { child, client, session };
  } catch (error) {
    await stopNode(child);
    throw error;
  }
}
