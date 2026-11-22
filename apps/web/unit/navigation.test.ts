import test from "node:test";
import assert from "node:assert/strict";
import { accountA, accountB } from "../test-support/protocol";
import {
  DEFAULT_DESTINATION,
  hasSessionCookie,
  isProtectedPath,
  safeDestination,
  signInUrl,
} from "../src/lib/auth-routing";
import { attentionItems } from "../src/lib/attention";
import { timeUntil } from "../src/lib/format";
import type { ChainProject } from "../src/lib/blockchain/projects";
import type { ChainCase } from "../src/lib/blockchain/arbitration";

test("protected paths cover the workspace but not sign-in or APIs", () => {
  for (const path of [
    "/dashboard",
    "/projects",
    "/projects/12",
    "/projects/new",
    "/disputes/0",
    "/juror",
    "/transactions",
    "/settings",
  ])
    assert.equal(isProtectedPath(path), true, path);
  for (const path of [
    "/",
    "/sign-in",
    "/api/auth/session",
    "/projectsx",
    "/deployments/31337.json",
  ])
    assert.equal(isProtectedPath(path), false, path);
});

test("post-sign-in destinations stay inside the application", () => {
  assert.equal(
    safeDestination("/projects/3?tab=files"),
    "/projects/3?tab=files",
  );
  for (const unsafe of [
    null,
    "",
    "https://evil.example/",
    "//evil.example/dashboard",
    "/\\evil.example",
    "javascript:alert(1)",
    "/sign-in",
    "/api/profile",
    "/dashboard\n",
    `/projects/${"a".repeat(600)}`,
  ])
    assert.equal(safeDestination(unsafe), DEFAULT_DESTINATION, String(unsafe));
  assert.equal(signInUrl("/disputes/4"), "/sign-in?next=%2Fdisputes%2F4");
  assert.equal(signInUrl("/dashboard"), "/sign-in");
  assert.equal(signInUrl("https://evil.example"), "/sign-in");
});

test("only well-formed session cookies count as an optimistic sign-in hint", () => {
  const token = "a".repeat(64);
  assert.equal(
    hasSessionCookie((n) => (n === "tl_session" ? token : undefined)),
    true,
  );
  assert.equal(
    hasSessionCookie((n) => (n === "__Host-tl_session" ? token : undefined)),
    true,
  );
  assert.equal(
    hasSessionCookie(() => undefined),
    false,
  );
  assert.equal(
    hasSessionCookie(() => "not-a-token"),
    false,
  );
  assert.equal(
    hasSessionCookie(() => "A".repeat(64)),
    false,
  );
});

const now = 1_000_000n;
function project(overrides: Partial<ChainProject> = {}): ChainProject {
  return {
    id: 0n,
    client: accountA,
    freelancer: accountB,
    metadataHash: `0x${"1".repeat(64)}`,
    total: 100_000_000n,
    escrowRemaining: 100_000_000n,
    acceptBy: now + 100n,
    feeBps: 100,
    currentMilestone: 0,
    milestoneCount: 1,
    state: 2,
    milestones: [
      {
        amount: 100_000_000n,
        dueAt: now + 100n,
        submittedAt: 0n,
        reviewEnd: 0n,
        evidenceHash: `0x${"0".repeat(64)}`,
        state: 0,
      },
    ],
    ...overrides,
  };
}

test("attention items follow the same on-chain permissions as the action buttons", () => {
  const unfunded = project({ id: 1n, state: 0 });
  assert.deepEqual(
    attentionItems([unfunded], [], accountA, now, now).map((i) => i.kind),
    ["fund"],
  );
  assert.deepEqual(attentionItems([unfunded], [], accountB, now, now), []);
  const funded = project({ id: 2n, state: 1 });
  assert.deepEqual(
    attentionItems([funded], [], accountB, now, now).map((i) => i.kind),
    ["accept"],
  );
  // Expired acceptance windows produce no action.
  assert.deepEqual(attentionItems([funded], [], accountB, now + 101n, now), []);
  const active = project({ id: 3n });
  assert.deepEqual(
    attentionItems([active], [], accountB, now, now).map((i) => i.kind),
    ["submit"],
  );
  const submitted = project({
    id: 4n,
    milestones: [
      {
        ...project().milestones[0],
        state: 1,
        submittedAt: now - 10n,
        reviewEnd: now + 50n,
      },
    ],
  });
  const review = attentionItems([submitted], [], accountA, now, now);
  assert.equal(review[0].kind, "approve");
  assert.equal(review[0].href, "/projects/4");
  assert.equal(review[0].amount, 100_000_000n);
  // Timeout release only strictly after the review deadline.
  assert.deepEqual(
    attentionItems([submitted], [], accountB, now + 50n, now),
    [],
  );
  assert.deepEqual(
    attentionItems([submitted], [], accountB, now + 51n, now).map(
      (i) => i.kind,
    ),
    ["release"],
  );
});

test("dispute attention items respect roles and deadlines, sorted by urgency", () => {
  const juror = `0x${"9".repeat(40)}` as const;
  const dispute = {
    projectId: 7n,
    milestoneIndex: 0n,
    client: accountA,
    freelancer: accountB,
    opener: accountA,
    status: 1,
    responseDeadline: now + 10n,
    votingDeadline: now + 100n,
    responseHash: `0x${"0".repeat(64)}`,
    jurors: [juror, `0x${"8".repeat(40)}`, `0x${"7".repeat(40)}`],
  };
  const c = {
    id: 5n,
    dispute,
    vote: 0,
    claimable: 0n,
  } as unknown as ChainCase;
  // The non-opening participant responds; the opener cannot.
  assert.deepEqual(
    attentionItems([], [c], accountB, now, now).map((i) => i.kind),
    ["respond"],
  );
  assert.deepEqual(attentionItems([], [c], accountA, now, now), []);
  // Jurors vote from the response deadline through the voting deadline.
  assert.deepEqual(attentionItems([], [c], juror, now, now), []);
  assert.deepEqual(
    attentionItems([], [c], juror, now, now + 10n).map((i) => i.kind),
    ["vote"],
  );
  assert.deepEqual(
    attentionItems([], [c], juror, now, now + 101n).map((i) => i.kind),
    ["finalize"],
  );
  const sorted = attentionItems(
    [project({ id: 1n, state: 0, acceptBy: now + 500n })],
    [c],
    accountA,
    now,
    now + 101n,
  );
  assert.deepEqual(
    sorted.map((i) => i.kind),
    ["fund", "finalize"],
  );
});

test("chain-time countdowns never use the browser clock", () => {
  assert.equal(timeUntil(100n, 100n), "deadline passed");
  assert.equal(timeUntil(100n + 30n, 100n), "under a minute left");
  assert.equal(timeUntil(100n + 45n * 60n, 100n), "45m left");
  assert.equal(timeUntil(100n + 3n * 3600n + 120n, 100n), "3h 2m left");
  assert.equal(timeUntil(100n + 2n * 86400n + 3600n, 100n), "2d 1h left");
});
