import test from "node:test";
import assert from "node:assert/strict";
import { getContracts } from "@trustlayer/contracts";
import { accountA, accountB, fixtureManifest } from "../test-support/protocol";
import {
  ACCEPTANCE_SECONDS,
  DELIVERY_GRACE_SECONDS,
  chainDate,
  normalAllocation,
  projectActions,
  projectIdFromPath,
  projectRole,
  readProjectPage,
  validEvidenceHash,
  validateProjectDraft,
  type ChainProject,
  type ProjectDraft,
  type ReadClient,
} from "../src/lib/blockchain/projects";
import {
  assertReviewScope,
  createSessionStore,
  deploymentScope,
} from "../src/lib/blockchain/session";
import {
  createTransactionController,
  type TransactionLifecycle,
} from "../src/lib/blockchain/transactions";
import {
  executeEscrowAction,
  createEscrowProject,
  type ActionReadClient,
} from "../src/lib/blockchain/escrow-actions";
import type { ProtocolWriteContext } from "../src/lib/blockchain/hooks/use-protocol-transaction";

const now = 1_700_000_000n;
test("reviewed actions reject a different deployment snapshot before signing", () => {
  const manifest = fixtureManifest();
  const scope = deploymentScope(manifest);
  assert.doesNotThrow(() => assertReviewScope(scope, manifest));
  manifest.verifiedBlock.hash = `0x${"f".repeat(64)}`;
  assert.throws(() => assertReviewScope(scope, manifest), /deployment changed/);
});
function draft(): ProjectDraft {
  return {
    title: "Agreement",
    description: "Non-sensitive scope",
    freelancer: accountB,
    milestones: [
      { title: "Deliverable", amount: "100.123456", due: "2023-12-01" },
    ],
  };
}
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
        submittedAt: now - 100n,
        reviewEnd: now + 50n,
        evidenceHash: `0x${"2".repeat(64)}`,
        state: 1,
      },
    ],
    ...overrides,
  };
}
test("project IDs preserve zero, uint256 and values above Number.MAX_SAFE_INTEGER", () => {
  assert.equal(projectIdFromPath("0"), 0n);
  assert.equal(projectIdFromPath("9007199254740993"), 9007199254740993n);
  for (const value of ["-1", "01", "1e9", "tl-1042", String(1n << 256n)])
    assert.equal(projectIdFromPath(value), null);
});
test("creation encodes exact six-decimal amounts and only a metadata hash", () => {
  const result = validateProjectDraft(draft(), now, accountA);
  assert.deepEqual(result.amounts, [100_123_456n]);
  assert.equal(result.total, 100_123_456n);
  assert.match(result.metadataHash, /^0x[\da-f]{64}$/);
  assert.equal(
    validateProjectDraft(draft(), now, accountA).metadataHash,
    result.metadataHash,
  );
});
for (const [name, mutate] of [
  [
    "self freelancer",
    (d: ProjectDraft) => {
      d.freelancer = accountA;
    },
  ],
  [
    "zero freelancer",
    (d: ProjectDraft) => {
      d.freelancer = `0x${"0".repeat(40)}`;
    },
  ],
  [
    "invalid address",
    (d: ProjectDraft) => {
      d.freelancer = "alice.eth";
    },
  ],
  [
    "missing title",
    (d: ProjectDraft) => {
      d.title = " ";
    },
  ],
  [
    "missing scope",
    (d: ProjectDraft) => {
      d.description = "";
    },
  ],
  [
    "zero milestones",
    (d: ProjectDraft) => {
      d.milestones = [];
    },
  ],
  [
    "six milestones",
    (d: ProjectDraft) => {
      d.milestones = Array.from({ length: 6 }, () => d.milestones[0]);
    },
  ],
  [
    "zero amount",
    (d: ProjectDraft) => {
      d.milestones[0].amount = "0";
    },
  ],
  [
    "negative amount",
    (d: ProjectDraft) => {
      d.milestones[0].amount = "-1";
    },
  ],
  [
    "excess precision",
    (d: ProjectDraft) => {
      d.milestones[0].amount = "1.1234567";
    },
  ],
  [
    "overflow",
    (d: ProjectDraft) => {
      d.milestones[0].amount = String(1n << 256n);
    },
  ],
  [
    "missing description",
    (d: ProjectDraft) => {
      d.milestones[0].title = "";
    },
  ],
  [
    "invalid due date",
    (d: ProjectDraft) => {
      d.milestones[0].due = "tomorrow";
    },
  ],
  [
    "duplicate deadlines",
    (d: ProjectDraft) => {
      d.milestones.push({ ...d.milestones[0] });
    },
  ],
  [
    "nonexistent calendar date",
    (d: ProjectDraft) => {
      d.milestones[0].due = "2026-02-30";
    },
  ],
] as const)
  test(`creation rejects ${name}`, () => {
    const d = draft();
    mutate(d);
    assert.throws(() => validateProjectDraft(d, now, accountA));
  });
test("creation requires the first deadline strictly beyond the acceptance window in chain time", () => {
  const due = BigInt(
    Date.parse(`${draft().milestones[0].due}T00:00:00Z`) / 1000,
  );
  assert.throws(() =>
    validateProjectDraft(draft(), due - ACCEPTANCE_SECONDS, accountA),
  );
  assert.doesNotThrow(() =>
    validateProjectDraft(draft(), due - ACCEPTANCE_SECONDS - 1n, accountA),
  );
});
test("role detection is case-insensitive and does not grant outsider permissions", () => {
  assert.equal(projectRole(project(), accountA), "Client");
  assert.equal(projectRole(project(), accountB), "Freelancer");
  assert.equal(projectRole(project(), `0x${"3".repeat(40)}`), "Viewer");
  assert.equal(
    Object.values(projectActions(project(), `0x${"3".repeat(40)}`, now)).some(
      Boolean,
    ),
    false,
  );
});
test("funding and acceptance match roles, states and inclusive acceptance boundary", () => {
  assert.equal(
    projectActions(project({ state: 0 }), accountA, now + 100n).fund,
    true,
  );
  assert.equal(
    projectActions(project({ state: 0 }), accountA, now + 101n).fund,
    false,
  );
  assert.equal(
    projectActions(project({ state: 1 }), accountB, now + 100n).accept,
    true,
  );
  assert.equal(
    projectActions(project({ state: 1 }), accountB, now + 101n).accept,
    false,
  );
  assert.equal(
    projectActions(project({ state: 1 }), accountA, now).accept,
    false,
  );
});
test("submission permits only the current pending milestone within delivery grace", () => {
  const p = project();
  p.milestones[0].state = 0;
  assert.equal(
    projectActions(p, accountB, p.milestones[0].dueAt + DELIVERY_GRACE_SECONDS)
      .submit,
    true,
  );
  assert.equal(
    projectActions(
      p,
      accountB,
      p.milestones[0].dueAt + DELIVERY_GRACE_SECONDS + 1n,
    ).submit,
    false,
  );
  assert.equal(projectActions(p, accountA, now).submit, false);
});
test("client approval remains available after the review deadline while submitted", () => {
  assert.equal(projectActions(project(), accountA, now + 51n).approve, true);
  assert.equal(projectActions(project(), accountB, now).approve, false);
});
test("freelancer timeout release is strictly after reviewEnd", () => {
  assert.equal(projectActions(project(), accountB, now + 50n).release, false);
  assert.equal(projectActions(project(), accountB, now + 51n).release, true);
});
for (const state of [2, 3])
  test(`milestone state ${state} blocks approval, release and submission`, () => {
    const p = project();
    p.milestones[0].state = state;
    assert.equal(projectActions(p, accountA, now + 1000n).approve, false);
    assert.equal(projectActions(p, accountB, now + 1000n).release, false);
    assert.equal(projectActions(p, accountB, now).submit, false);
  });
test("service fee floors at one percent using bigint with no refund assumption", () => {
  assert.deepEqual(normalAllocation(400_000_000n, 100), {
    gross: 400_000_000n,
    serviceFee: 4_000_000n,
    freelancerNet: 396_000_000n,
  });
  assert.equal(normalAllocation(101n, 100).serviceFee, 1n);
  assert.equal(normalAllocation(1n, 100).serviceFee, 0n);
});
test("evidence accepts only a nonzero bytes32 hash and handles large contract dates safely", () => {
  assert.equal(validEvidenceHash(`0x${"1".repeat(64)}`), true);
  for (const value of [
    "private file content",
    "ipfs://private",
    "0x12",
    `0x${"0".repeat(64)}`,
  ])
    assert.equal(validEvidenceHash(value), false);
  assert.match(chainDate((1n << 64n) - 1n), /Unix seconds/);
});
test("project discovery is bounded, role filtered and paginated without any log scan", async () => {
  const requests: bigint[] = [];
  const c = getContracts(fixtureManifest(), 31337);
  const client = {
    getBlock: async () => ({ number: 10n, timestamp: now }),
    readContract: async (args: { functionName: string; args?: bigint[] }) => {
      if (args.functionName === "nextProjectId") return 45n;
      const id = args.args![0];
      requests.push(id);
      return [
        id === 30n ? accountA : accountB,
        `0x${"3".repeat(40)}`,
        `0x${"1".repeat(64)}`,
        100n,
        0n,
        now + 100n,
        100,
        0,
        0,
        0,
      ];
    },
    getLogs: () => {
      throw new Error("Unbounded scan forbidden");
    },
  } as unknown as ReadClient;
  const page = await readProjectPage(client, c, accountA, null);
  assert.deepEqual(
    page.projects.map((p) => p.id),
    [30n],
  );
  assert.equal(page.scanned, 20n);
  assert.equal(page.next?.before, 25n);
  assert.equal(requests.filter((id) => id === 44n).length, 1);
  assert.ok(requests.every((id) => id >= 25n && id < 45n));
});
test("empty discovery is a real empty page", async () => {
  const client = {
    getBlock: async () => ({ number: 10n, timestamp: now }),
    readContract: async () => 0n,
  } as unknown as ReadClient;
  const page = await readProjectPage(
    client,
    getContracts(fixtureManifest(), 31337),
    accountA,
    null,
  );
  assert.deepEqual(page.projects, []);
  assert.equal(page.next, undefined);
});
test("session requests prevent duplicate sends across page controllers and keep unconfirmed locked", () => {
  const store = createSessionStore();
  const manifest = fixtureManifest();
  const id = store.begin(manifest, accountA, { kind: "Fund escrow" });
  assert.throws(
    () => store.begin(manifest, accountA, { kind: "Fund escrow" }),
    /pending/,
  );
  store.update(id, { phase: "unconfirmed", hash: `0x${"1".repeat(64)}` });
  assert.equal(store.busyActor(31337, accountA), true);
  store.update(id, { phase: "confirmed" });
  assert.equal(store.busyActor(31337, accountA), false);
  assert.equal(createSessionStore().attempts().length, 0);
});
test("session observer preserves a mined receipt while account changes suppress stale UI updates", async () => {
  let current = true;
  const states: TransactionLifecycle[] = [];
  const observed: TransactionLifecycle[] = [];
  const hash = `0x${"1".repeat(64)}` as const;
  const controller = createTransactionController({
    validate: async () => undefined,
    isCurrent: () => current,
    publish: (s) => states.push(s),
    observe: (s) => observed.push(s),
    refresh: async () => {
      throw new Error("Should not refresh another account");
    },
    wait: async () => {
      current = false;
      return {
        status: "success" as const,
        transactionHash: hash,
        blockNumber: 10n,
      };
    },
  });
  await controller.execute(async () => hash);
  assert.equal(
    states.some((s) => s.phase === "confirmed"),
    false,
  );
  assert.equal(observed.at(-1)?.phase, "confirmed");
});

function actionFixture(balance: bigint, allowance: bigint, eth = 10n ** 18n) {
  const c = getContracts(fixtureManifest(), 31337);
  const sent: { functionName: string; args: readonly unknown[] }[] = [];
  const context = {
    contracts: c,
    account: accountA,
    assertCurrent: async () => {},
    wallet: {
      writeContract: async (request: {
        functionName: string;
        args: readonly unknown[];
      }) => {
        sent.push(request);
        return `0x${"1".repeat(64)}`;
      },
    },
  } as unknown as ProtocolWriteContext;
  const client = {
    getBlock: async () => ({ number: 10n, timestamp: now }),
    readContract: async (request: { functionName: string }) =>
      request.functionName === "nextProjectId"
        ? 1n
        : request.functionName === "projects"
          ? [
              accountA,
              accountB,
              `0x${"1".repeat(64)}`,
              100_000_000n,
              0n,
              now + 100n,
              100,
              0,
              0,
              0,
            ]
          : request.functionName === "balanceOf"
            ? balance
            : allowance,
    simulateContract: async () => ({}),
    estimateGas: async () => 100_000n,
    getGasPrice: async () => 1_000_000_000n,
    getBalance: async () => eth,
  } as unknown as ActionReadClient;
  return { c, context, client, sent };
}
test("insufficient mUSD prevents allowance and funding requests", async () => {
  const f = actionFixture(99n, 0n);
  await assert.rejects(
    executeEscrowAction(f.context, "approveToken", 0n, undefined, f.client),
    /Insufficient mUSD/,
  );
  assert.equal(f.sent.length, 0);
});

test("creation with zero mUSD uses the real createProject call without token reads or funding", async () => {
  const f = actionFixture(0n, 0n);
  f.client.readContract = (async () => {
    throw new Error("Creation must not require token balance or allowance");
  }) as typeof f.client.readContract;
  await createEscrowProject(f.context, draft(), f.client);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].functionName, "createProject");
  assert.deepEqual(f.sent[0].args.slice(0, 3), [
    accountB,
    [100123456n],
    [1701388800n],
  ]);
});

test("creation with zero ETH reports insufficient gas without a wallet submission", async () => {
  const f = actionFixture(0n, 0n, 0n);
  await assert.rejects(
    createEscrowProject(f.context, draft(), f.client),
    /Insufficient local ETH for gas/,
  );
  assert.deepEqual(f.sent, []);
});
test("exact allowance approval never calls fundProject", async () => {
  const f = actionFixture(200_000_000n, 0n);
  await executeEscrowAction(f.context, "approveToken", 0n, undefined, f.client);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].functionName, "approve");
  assert.deepEqual(f.sent[0].args, [f.c.TrustEscrow.address, 100_000_000n]);
});
test("funding requires a confirmed sufficient on-chain allowance", async () => {
  const f = actionFixture(200_000_000n, 0n);
  await assert.rejects(
    executeEscrowAction(f.context, "fund", 0n, undefined, f.client),
    /Approve the required/,
  );
  assert.equal(f.sent.length, 0);
  const funded = actionFixture(200_000_000n, 100_000_000n);
  await executeEscrowAction(
    funded.context,
    "fund",
    0n,
    undefined,
    funded.client,
  );
  assert.equal(funded.sent[0].functionName, "fundProject");
});
for (const kind of ["submit", "approve", "release"] as const)
  test(`${kind} cannot target a different milestone than the one reviewed`, async () => {
    const f = actionFixture(200_000_000n, 0n);
    await assert.rejects(
      executeEscrowAction(f.context, kind, 0n, undefined, f.client, 1),
      /current milestone changed since review/,
    );
    assert.equal(f.sent.length, 0);
  });

test("insufficient local gas prevents the wallet submission", async () => {
  const f = actionFixture(200_000_000n, 0n, 0n);
  await assert.rejects(
    executeEscrowAction(f.context, "approveToken", 0n, undefined, f.client),
    /Insufficient local ETH/,
  );
  assert.equal(f.sent.length, 0);
});
