/**
 * Pure decision logic for the one-command local workflow (scripts/dev.ts).
 * Kept free of I/O so every safety rule is unit-tested in test/DevStartup.ts.
 */
import type { Identity } from "./local-chain.js";

export interface BackupCandidate {
  path: string;
  /** File modification time; backups are created exclusively and never rewritten. */
  mtimeMs: number;
  identity: Identity;
  head: Identity;
  hasManifest: boolean;
}
export type BackupChoice =
  | { kind: "selected"; backup: BackupCandidate; considered: number }
  | { kind: "none"; reason: string }
  | { kind: "ambiguous"; reason: string; candidates: BackupCandidate[] };

const sameIdentity = (a: Identity, b: Identity) =>
  a.number === b.number && a.hash.toLowerCase() === b.hash.toLowerCase();

/**
 * Choose the backup to restore for the chain the active manifest is bound to.
 * Only backups of that exact chain identity are eligible. The newest backup
 * must also be the furthest-advanced one; otherwise an older checkpoint was
 * restored and continued at some point (a fork in history), and choosing
 * automatically could silently discard work, so the caller must decide.
 */
export function selectBackup(
  candidates: BackupCandidate[],
  identity: Identity,
): BackupChoice {
  const matching = candidates.filter((c) => sameIdentity(c.identity, identity));
  if (!matching.length)
    return {
      kind: "none",
      reason: candidates.length
        ? "Backups exist, but none belong to the chain this deployment manifest is bound to."
        : "No chain backups were found.",
    };
  const byTime = [...matching].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const newest = byTime[0];
  const highest = matching.reduce(
    (max, c) => (BigInt(c.head.number) > max ? BigInt(c.head.number) : max),
    0n,
  );
  if (BigInt(newest.head.number) < highest) {
    const ahead = matching.filter(
      (c) => BigInt(c.head.number) > BigInt(newest.head.number),
    );
    return {
      kind: "ambiguous",
      reason: `The newest backup (head block ${newest.head.number}) is behind ${ahead.length} older backup(s) that reached block ${highest}. History may have forked after an earlier restore.`,
      candidates: [newest, ...ahead],
    };
  }
  // Same head number but a different head hash in an equally-new file is a fork too.
  const conflicting = matching.filter(
    (c) =>
      c.head.number === newest.head.number &&
      c.head.hash.toLowerCase() !== newest.head.hash.toLowerCase(),
  );
  if (conflicting.length)
    return {
      kind: "ambiguous",
      reason: `Backups disagree about block ${newest.head.number}: the chain history forked.`,
      candidates: [newest, ...conflicting],
    };
  return { kind: "selected", backup: newest, considered: matching.length };
}

/** A unique, valid managed-chain run name (see sessionPath in local-chain.ts). */
export function runName(now: Date, suffix = "") {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
  return `dev-${stamp}${suffix}`;
}

export interface ConsistencyInput {
  /** Highest on-chain IDs referenced by PostgreSQL rows for this deployment scope. */
  maxProjectId?: bigint;
  maxDisputeId?: bigint;
  maxConfirmedBlock?: bigint;
  /** Recorded receipts: transaction hash and the block PostgreSQL recorded. */
  receipts: {
    hash: string;
    block?: bigint;
    found: boolean;
    foundBlock?: bigint;
  }[];
  chain: { nextProjectId: bigint; nextDisputeId: bigint; head: bigint };
}
/**
 * Off-chain records must never be ahead of the restored chain: restoring an
 * older checkpoint would let new projects/disputes reuse IDs that PostgreSQL
 * and private Storage already associate with other work.
 */
export function consistencyProblems(input: ConsistencyInput): string[] {
  const problems: string[] = [];
  const { chain } = input;
  if (
    input.maxProjectId !== undefined &&
    input.maxProjectId >= chain.nextProjectId
  )
    problems.push(
      `PostgreSQL has metadata for project #${input.maxProjectId}, but the restored chain only has ${chain.nextProjectId} project(s).`,
    );
  if (
    input.maxDisputeId !== undefined &&
    input.maxDisputeId >= chain.nextDisputeId
  )
    problems.push(
      `PostgreSQL references dispute #${input.maxDisputeId}, but the restored chain only has ${chain.nextDisputeId} dispute(s).`,
    );
  if (
    input.maxConfirmedBlock !== undefined &&
    input.maxConfirmedBlock > chain.head
  )
    problems.push(
      `PostgreSQL recorded a confirmation at block ${input.maxConfirmedBlock}, beyond the restored head ${chain.head}.`,
    );
  const missing = input.receipts.filter(
    (r) =>
      !r.found ||
      (r.block !== undefined &&
        r.foundBlock !== undefined &&
        r.block !== r.foundBlock),
  );
  if (missing.length)
    problems.push(
      `${missing.length} recorded transaction receipt(s) are missing from the restored chain (first: ${missing[0].hash}).`,
    );
  return problems;
}
