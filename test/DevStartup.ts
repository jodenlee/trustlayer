import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  consistencyProblems,
  runName,
  selectBackup,
  type BackupCandidate,
} from "../scripts/lib/dev-plan.js";

const identity = { number: "1", hash: `0x${"a".repeat(64)}` as const };
const other = { number: "1", hash: `0x${"b".repeat(64)}` as const };
const head = (n: number, h = "c") => ({
  number: String(n),
  hash: `0x${h.repeat(64)}` as `0x${string}`,
});
function backup(
  path: string,
  mtimeMs: number,
  headNumber: number,
  id = identity,
  headHash = "c",
): BackupCandidate {
  return {
    path,
    mtimeMs,
    identity: id,
    head: head(headNumber, headHash),
    hasManifest: false,
  };
}

describe("Daily startup backup selection", () => {
  it("never selects a backup from a different chain identity", () => {
    const choice = selectBackup([backup("x", 10, 50, other)], identity);
    assert.equal(choice.kind, "none");
  });
  it("reports no backup rather than falling back to a fresh chain", () => {
    assert.equal(selectBackup([], identity).kind, "none");
  });
  it("selects the newest backup when it is also the most advanced", () => {
    const choice = selectBackup(
      [backup("old", 10, 5), backup("new", 30, 20), backup("mid", 20, 12)],
      identity,
    );
    assert.equal(choice.kind, "selected");
    assert.equal(choice.kind === "selected" && choice.backup.path, "new");
    assert.equal(choice.kind === "selected" && choice.considered, 3);
  });
  it("allows equal heads from idle checkpoints", () => {
    const choice = selectBackup(
      [backup("a", 10, 20), backup("b", 20, 20), backup("c", 30, 20)],
      identity,
    );
    assert.equal(choice.kind === "selected" && choice.backup.path, "c");
  });
  it("refuses to guess when an older backup is further ahead (forked history)", () => {
    const choice = selectBackup(
      [backup("ahead", 10, 40), backup("newest", 30, 25)],
      identity,
    );
    assert.equal(choice.kind, "ambiguous");
    assert.deepEqual(
      choice.kind === "ambiguous" && choice.candidates.map((c) => c.path),
      ["newest", "ahead"],
    );
  });
  it("refuses to guess when backups disagree about the same block", () => {
    const choice = selectBackup(
      [backup("a", 10, 25, identity, "d"), backup("b", 30, 25, identity, "e")],
      identity,
    );
    assert.equal(choice.kind, "ambiguous");
  });
  it("creates unique, valid managed run names", () => {
    const name = runName(new Date("2026-11-22T09:05:07.123Z"));
    assert.equal(name, "dev-20261122-090507");
    assert.match(name, /^[a-z][a-z0-9_-]{0,79}$/i);
    assert.equal(
      runName(new Date("2026-11-22T09:05:07Z"), "-b"),
      "dev-20261122-090507-b",
    );
  });
});

describe("Startup consistency between PostgreSQL and the restored chain", () => {
  const chain = { nextProjectId: 4n, nextDisputeId: 2n, head: 100n };
  it("accepts records that the chain contains", () => {
    assert.deepEqual(
      consistencyProblems({
        maxProjectId: 3n,
        maxDisputeId: 1n,
        maxConfirmedBlock: 100n,
        receipts: [{ hash: "0x1", block: 90n, found: true, foundBlock: 90n }],
        chain,
      }),
      [],
    );
  });
  it("accepts an empty database scope", () => {
    assert.deepEqual(consistencyProblems({ receipts: [], chain }), []);
  });
  it("rejects metadata for projects beyond the restored chain", () => {
    const problems = consistencyProblems({
      maxProjectId: 4n,
      receipts: [],
      chain,
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /project #4/);
  });
  it("rejects disputes beyond the restored chain", () => {
    assert.match(
      consistencyProblems({ maxDisputeId: 2n, receipts: [], chain })[0],
      /dispute #2/,
    );
  });
  it("rejects confirmations recorded after the restored head", () => {
    assert.match(
      consistencyProblems({ maxConfirmedBlock: 101n, receipts: [], chain })[0],
      /block 101/,
    );
  });
  it("rejects missing or relocated receipts", () => {
    assert.equal(
      consistencyProblems({
        receipts: [
          { hash: "0xmissing", found: false },
          { hash: "0xmoved", block: 50n, found: true, foundBlock: 51n },
        ],
        chain,
      }).length,
      1,
    );
  });
});
