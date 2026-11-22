import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { DisputeArbitrationAbi, getContracts } from "@trustlayer/contracts";
import { accountA, accountB, fixtureManifest } from "../test-support/protocol";
import {
  jurorA,
  jurorB,
  jurorC,
  outsider,
} from "../test-support/arbitration-rpc";
import {
  caseStage,
  caseRole,
  caseActions,
  openingAllowed,
  settlementAllocation,
  remainingTime,
  readCase,
  readCasePage,
  openedDisputeFromReceipt,
  type DisputeRecord,
} from "../src/lib/blockchain/arbitration";
import {
  executeCaseAction,
  executeJurorAction,
  openMilestoneDispute,
  stakeAmount,
} from "../src/lib/blockchain/arbitration-actions";
import type { ActionReadClient } from "../src/lib/blockchain/escrow-actions";
import type { ChainProject, ReadClient } from "../src/lib/blockchain/projects";
import type { ProtocolWriteContext } from "../src/lib/blockchain/hooks/use-protocol-transaction";
import { createSessionStore } from "../src/lib/blockchain/session";
import { readHistoryPage } from "../src/lib/blockchain/history";

const zero = `0x${"0".repeat(64)}` as const;
const hash = `0x${"a".repeat(64)}` as const;
const unit = 1_000_000n;
function dispute(overrides: Partial<DisputeRecord> = {}): DisputeRecord {
  return {
    projectId: 0n,
    milestoneIndex: 0n,
    milestoneAmount: 100n * unit,
    client: accountA,
    freelancer: accountB,
    opener: accountA,
    jurors: [jurorA, jurorB, jurorC],
    evidenceHash: hash,
    responseHash: zero,
    openedAt: 1000n,
    responseDeadline: 44200n,
    votingDeadline: 130600n,
    finalizedAt: 0n,
    freelancerVotes: 0,
    clientVotes: 0,
    splitVotes: 0,
    status: 1,
    ruling: 0,
    fallbackApplied: false,
    freelancerBps: 0,
    ...overrides,
  };
}
function project(): ChainProject {
  return {
    id: 0n,
    client: accountA,
    freelancer: accountB,
    metadataHash: hash,
    total: 100n * unit,
    escrowRemaining: 100n * unit,
    acceptBy: 500n,
    feeBps: 100,
    currentMilestone: 0,
    milestoneCount: 1,
    state: 2,
    milestones: [
      {
        amount: 100n * unit,
        dueAt: 900n,
        submittedAt: 1000n,
        reviewEnd: 2000n,
        evidenceHash: hash,
        state: 1,
      },
    ],
  };
}
function fixture(
  options: {
    actor?: Address;
    now?: bigint;
    existing?: boolean;
    balance?: bigint;
    allowance?: bigint;
    registered?: boolean;
    available?: bigint;
    status?: 1 | 2;
    vote?: number;
    claimed?: boolean;
    noJurors?: boolean;
  } = {},
) {
  const contracts = getContracts(fixtureManifest(), 31337);
  const sent: {
    address: Address;
    functionName: string;
    args: readonly unknown[];
  }[] = [];
  const calls: string[] = [];
  const d = dispute({ status: options.status ?? 1 });
  const p = project();
  const client = {
    getBlock: async () => ({ number: 10n, timestamp: options.now ?? 1500n }),
    readContract: async (r: { functionName: string; args?: unknown[] }) => {
      calls.push(r.functionName);
      switch (r.functionName) {
        case "nextProjectId":
        case "nextDisputeId":
          return 1n;
        case "projects":
          return [
            p.client,
            p.freelancer,
            p.metadataHash,
            p.total,
            p.escrowRemaining,
            p.acceptBy,
            p.feeBps,
            p.currentMilestone,
            p.milestoneCount,
            p.state,
          ];
        case "milestones":
          return [100n * unit, 900n, 1000n, 2000n, hash, 1];
        case "getMilestoneDispute":
          return [options.existing ?? false, 0n];
        case "getDispute":
          return d;
        case "balanceOf":
          return options.balance ?? 1000n * unit;
        case "allowance":
          return options.allowance ?? 0n;
        case "previewJurors":
          if (options.noJurors) throw new Error("InsufficientEligibleJurors");
          return [jurorA, jurorB, jurorC];
        case "getJurorInfo":
          return {
            registered: options.registered ?? true,
            depositedStake: (options.available ?? 100n * unit) + 100n * unit,
            availableStake: options.available ?? 100n * unit,
            lockedStake: 100n * unit,
            activeAssignments: 1n,
          };
        case "votes":
          return options.vote ?? 0;
        case "getAssignment":
          return {
            client: accountA,
            freelancer: accountB,
            jurors: d.jurors,
            state: d.status === 2 ? 2 : 1,
          };
        case "claimableReward":
          return d.status === 2 && !options.claimed ? 4n * unit : 0n;
        case "rewardClaimed":
          return options.claimed ?? false;
        default:
          throw new Error(`Unexpected read ${r.functionName}`);
      }
    },
    simulateContract: async () => ({}),
    estimateGas: async () => 100000n,
    getGasPrice: async () => 1000n,
    getBalance: async () => 10n ** 18n,
  } as unknown as ActionReadClient;
  const context = {
    contracts,
    account: options.actor ?? accountA,
    assertCurrent: async () => {},
    wallet: {
      writeContract: async (r: (typeof sent)[number]) => {
        sent.push(r);
        return hash;
      },
    },
  } as unknown as ProtocolWriteContext;
  return { contracts, sent, calls, d, p, context, client };
}

for (const [now, stage] of [
  [44199n, "Response window"],
  [44200n, "Voting open"],
  [130600n, "Voting open"],
  [130601n, "Ready to finalize"],
] as const)
  test(`case stage at ${now} uses the exact contract boundary`, () =>
    assert.equal(caseStage(dispute(), now), stage));
test("finalized status wins over time display", () =>
  assert.equal(caseStage(dispute({ status: 2 }), 1000n), "Finalized"));
test("role detection includes participants, historical jurors and outsiders", () => {
  assert.equal(caseRole(dispute(), accountA), "Client");
  assert.equal(caseRole(dispute(), accountB), "Freelancer");
  assert.equal(caseRole(dispute(), jurorA), "Juror");
  assert.equal(caseRole(dispute(), outsider), "Viewer");
});
for (const actor of [accountA, accountB])
  test(`${actor} can open through the inclusive review deadline`, () => {
    assert.equal(openingAllowed(project(), 0, actor, 2000n, false), true);
    assert.equal(openingAllowed(project(), 0, actor, 2001n, false), false);
  });
for (const state of [0, 2, 3])
  test(`milestone state ${state} cannot open another dispute`, () => {
    const p = project();
    p.milestones[0].state = state;
    assert.equal(openingAllowed(p, 0, accountA, 1500n, false), false);
  });
test("opening excludes outsiders, duplicate case zero and stale milestone indices", () => {
  assert.equal(openingAllowed(project(), 0, outsider, 1500n, false), false);
  assert.equal(openingAllowed(project(), 0, accountA, 1500n, true), false);
  assert.equal(openingAllowed(project(), 1, accountA, 1500n, false), false);
});
test("only the counterparty can record a single response strictly before deadline", () => {
  assert.equal(caseActions(dispute(), accountB, 44199n, 0, 0n).respond, true);
  for (const actor of [accountA, jurorA, outsider])
    assert.equal(caseActions(dispute(), actor, 44199n, 0, 0n).respond, false);
  assert.equal(caseActions(dispute(), accountB, 44200n, 0, 0n).respond, false);
  assert.equal(
    caseActions(dispute({ responseHash: hash }), accountB, 44199n, 0, 0n)
      .respond,
    false,
  );
});
test("juror voting includes both deadlines and excludes prior ballots", () => {
  for (const time of [44200n, 130600n])
    assert.equal(caseActions(dispute(), jurorA, time, 0, 0n).vote, true);
  for (const time of [44199n, 130601n])
    assert.equal(caseActions(dispute(), jurorA, time, 0, 0n).vote, false);
  assert.equal(caseActions(dispute(), jurorA, 50000n, 1, 0n).vote, false);
  for (const actor of [accountA, accountB, outsider])
    assert.equal(caseActions(dispute(), actor, 50000n, 0, 0n).vote, false);
});
test("finalization is permissionless strictly after voting, once", () => {
  assert.equal(
    caseActions(dispute(), outsider, 130600n, 0, 0n).finalize,
    false,
  );
  assert.equal(caseActions(dispute(), outsider, 130601n, 0, 0n).finalize, true);
  assert.equal(
    caseActions(dispute({ status: 2 }), outsider, 130601n, 0, 0n).finalize,
    false,
  );
});
test("reward controls use actual per-juror claimability and finalized status", () => {
  assert.equal(
    caseActions(dispute({ status: 2 }), jurorA, 130601n, 0, 4n * unit).claim,
    true,
  );
  assert.equal(
    caseActions(dispute({ status: 2 }), jurorA, 130601n, 0, 0n).claim,
    false,
  );
  assert.equal(
    caseActions(dispute({ status: 2 }), outsider, 130601n, 0, 4n * unit).claim,
    false,
  );
});
for (const [bps, net, refund, fee] of [
  [10000, 99000000n, 0n, 1000000n],
  [0, 0n, 100000000n, 0n],
  [5000, 49500000n, 50000000n, 500000n],
] as const)
  test(`stored allocation ${bps} bps conserves milestone principal`, () => {
    const a = settlementAllocation(100000000n, bps, 100);
    assert.equal(a.freelancerNet, net);
    assert.equal(a.clientRefund, refund);
    assert.equal(a.serviceFee, fee);
    assert.equal(net + refund + fee, a.gross);
  });
test("partial settlement floors both gross and fee with bigint", () =>
  assert.deepEqual(settlementAllocation(101n, 5000, 100), {
    gross: 101n,
    freelancerGross: 50n,
    freelancerNet: 50n,
    serviceFee: 0n,
    clientRefund: 51n,
  }));
test("remaining time is clamped and explicitly based on chain block time", () =>
  assert.equal(
    remainingTime(100n, 101n),
    "0h 0m 0s remaining at the latest chain block",
  ));
for (const invalid of ["0", "-1", "1.0000001", "NaN", "", String(1n << 256n)])
  test(`rejects invalid stake input ${invalid}`, () =>
    assert.throws(() => stakeAmount(invalid), /positive mUSD/));
test("stake parsing retains all six decimal places", () =>
  assert.equal(stakeAmount("100.123456"), 100123456n));
test("fee approval targets arbitration for exactly 15 mUSD without opening", async () => {
  const f = fixture();
  await openMilestoneDispute(f.context, 0n, 0, hash, true, f.client);
  assert.deepEqual(
    f.sent.map((r) => r.functionName),
    ["approve"],
  );
  assert.deepEqual(f.sent[0].args, [
    f.contracts.DisputeArbitration.address,
    15000000n,
  ]);
});
test("opening needs confirmed fee allowance and actual balance", async () => {
  const noAllowance = fixture();
  await assert.rejects(
    openMilestoneDispute(
      noAllowance.context,
      0n,
      0,
      hash,
      false,
      noAllowance.client,
    ),
    /Approve 15 mUSD/,
  );
  assert.equal(noAllowance.sent.length, 0);
  const poor = fixture({ balance: 14999999n });
  await assert.rejects(
    openMilestoneDispute(poor.context, 0n, 0, hash, true, poor.client),
    /Insufficient mUSD/,
  );
  assert.equal(poor.sent.length, 0);
});
test("opening uses the reviewed index and actual openDispute method", async () => {
  const f = fixture({ allowance: 15000000n });
  await openMilestoneDispute(f.context, 0n, 0, hash, false, f.client);
  assert.deepEqual(f.sent[0].args, [0n, 0n, hash]);
  assert.equal(f.sent[0].functionName, "openDispute");
});
for (const options of [{ existing: true }, { actor: outsider }, { now: 2001n }])
  test(`fresh opening rejects ${JSON.stringify(options, (_, v) => (typeof v === "bigint" ? String(v) : v))}`, async () => {
    const f = fixture(options);
    await assert.rejects(
      openMilestoneDispute(f.context, 0n, 0, hash, false, f.client),
      /does not permit opening/,
    );
    assert.equal(f.sent.length, 0);
  });
test("juror shortage cannot send or collect a fee", async () => {
  const f = fixture({ allowance: 15000000n, noJurors: true });
  await assert.rejects(
    openMilestoneDispute(f.context, 0n, 0, hash, false, f.client),
    /three eligible jurors/,
  );
  assert.equal(f.sent.length, 0);
});
test("registration is a separate token-free operation", async () => {
  const f = fixture({ registered: false, balance: 0n });
  await executeJurorAction(f.context, "register", 0n, f.client);
  assert.equal(f.sent[0].functionName, "registerJuror");
  assert.equal(f.calls.includes("balanceOf"), false);
});
test("duplicate registration and unregistered deposits are rejected", async () => {
  const f = fixture();
  await assert.rejects(
    executeJurorAction(f.context, "register", 0n, f.client),
    /already registered/,
  );
  const u = fixture({ registered: false });
  await assert.rejects(
    executeJurorAction(u.context, "deposit", unit, u.client),
    /Register this wallet/,
  );
});
test("stake approval targets registry exactly and never deposits", async () => {
  const f = fixture();
  await executeJurorAction(f.context, "approveStake", 100n * unit, f.client);
  assert.deepEqual(f.sent[0].args, [
    f.contracts.JurorRegistry.address,
    100n * unit,
  ]);
  assert.equal(f.sent[0].functionName, "approve");
});
test("deposits need balance and confirmed registry allowance", async () => {
  const f = fixture();
  await assert.rejects(
    executeJurorAction(f.context, "deposit", 100n * unit, f.client),
    /Approve the stake amount/,
  );
  const p = fixture({ balance: 1n });
  await assert.rejects(
    executeJurorAction(p.context, "deposit", 100n * unit, p.client),
    /Insufficient mUSD/,
  );
  const s = fixture({ allowance: 100n * unit });
  await executeJurorAction(s.context, "deposit", 100n * unit, s.client);
  assert.equal(s.sent[0].functionName, "depositStake");
});
test("withdrawal rereads unlocked stake and never withdraws locked collateral", async () => {
  const f = fixture({ available: 50n * unit });
  await assert.rejects(
    executeJurorAction(f.context, "withdraw", 51n * unit, f.client),
    /unlocked stake/,
  );
  await executeJurorAction(f.context, "withdraw", 50n * unit, f.client);
  assert.deepEqual(f.sent[0].args, [50n * unit]);
  assert.equal(f.sent[0].functionName, "withdrawStake");
});
for (const value of [1, 2, 3])
  test(`assigned juror casts public vote ${value} through the real method`, async () => {
    const f = fixture({ actor: jurorA, now: 44200n });
    await executeCaseAction(f.context, "vote", 0n, value, f.client);
    assert.deepEqual(f.sent[0].args, [0n, value]);
    assert.equal(f.sent[0].functionName, "castVote");
  });
for (const options of [
  { actor: outsider, now: 50000n },
  { actor: jurorA, now: 44199n },
  { actor: jurorA, now: 130601n },
  { actor: jurorA, now: 50000n, vote: 1 },
])
  test(`fresh voting rejects unauthorized, early, late or duplicate state ${JSON.stringify(options, (_, v) => (typeof v === "bigint" ? String(v) : v))}`, async () => {
    const f = fixture(options);
    await assert.rejects(
      executeCaseAction(f.context, "vote", 0n, 1, f.client),
      /does not permit/,
    );
    assert.equal(f.sent.length, 0);
  });
test("respond and finalize use contract functions without supplying a verdict", async () => {
  const f = fixture({ actor: accountB });
  await executeCaseAction(f.context, "respond", 0n, hash, f.client);
  assert.equal(f.sent[0].functionName, "respondToDispute");
  const p = fixture({ actor: outsider, now: 130601n });
  await executeCaseAction(p.context, "finalize", 0n, undefined, p.client);
  assert.equal(p.sent[0].functionName, "finalizeDispute");
  assert.deepEqual(p.sent[0].args, [0n]);
});
test("claims call arbitration without a recipient and prevent duplicates", async () => {
  const f = fixture({ actor: jurorA, status: 2 });
  await executeCaseAction(f.context, "claim", 0n, undefined, f.client);
  assert.equal(f.sent[0].functionName, "claimJurorReward");
  assert.deepEqual(f.sent[0].args, [0n]);
  const c = fixture({ actor: jurorA, status: 2, claimed: true });
  await assert.rejects(
    executeCaseAction(c.context, "claim", 0n, undefined, c.client),
    /does not permit/,
  );
});
test("nonexistent case IDs fail before contract struct reads", async () => {
  const f = fixture();
  await assert.rejects(
    readCase(f.client, f.contracts, 1n, accountA),
    /does not exist/,
  );
  assert.equal(f.calls.includes("getDispute"), false);
});
test("discovery scans at most twenty IDs at a pinned block and includes participant/juror roles", async () => {
  const f = fixture();
  const ids: bigint[] = [];
  const client = {
    ...f.client,
    readContract: async (r: { functionName: string; args: bigint[] }) => {
      if (r.functionName === "nextDisputeId") return 45n;
      if (r.functionName === "getDispute") {
        ids.push(r.args[0]);
        return r.args[0] === 30n
          ? dispute()
          : dispute({
              client: outsider,
              freelancer: outsider,
              jurors: [outsider, outsider, outsider],
            });
      }
      return f.client.readContract(
        r as unknown as Parameters<typeof f.client.readContract>[0],
      );
    },
    getLogs: async () => {
      throw new Error("Discovery must not scan logs");
    },
  } as unknown as ReadClient;
  const page = await readCasePage(client, f.contracts, jurorA, null);
  assert.deepEqual(
    page.cases.map((c) => c.id),
    [30n],
  );
  assert.equal(page.scanned, 20n);
  assert.equal(page.next?.before, 25n);
  assert.ok(ids.every((id) => id >= 25n && id <= 44n));
});
test("opening ID comes from the matching receipt event, including zero", () => {
  const f = fixture();
  const log: Log = {
    blockHash: hash,
    blockNumber: 10n,
    logIndex: 0,
    transactionHash: hash,
    transactionIndex: 0,
    removed: false,
    address: f.contracts.DisputeArbitration.address,
    topics: encodeEventTopics({
      abi: DisputeArbitrationAbi,
      eventName: "DisputeOpened",
      args: { disputeId: 0n, projectId: 0n, milestoneIndex: 0n },
    }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      [
        { type: "address" },
        { type: "bytes32" },
        { type: "uint64" },
        { type: "uint64" },
      ],
      [accountA, hash, 44200n, 130600n],
    ),
  };
  assert.equal(
    openedDisputeFromReceipt(
      [log],
      f.contracts.DisputeArbitration.address,
      0n,
      0,
      accountA,
    ),
    0n,
  );
  assert.throws(
    () => openedDisputeFromReceipt([log], outsider, 0n, 0, accountA),
    /could not be verified/,
  );
  assert.throws(
    () =>
      openedDisputeFromReceipt(
        [log],
        f.contracts.DisputeArbitration.address,
        1n,
        0,
        accountA,
      ),
    /could not be verified/,
  );
});

test("session form input survives remounts while remaining scoped and memory-only", () => {
  const store = createSessionStore();
  store.setInput("deploymentA:walletA:deposit", "10.123456");
  assert.equal(store.input("deploymentA:walletA:deposit"), "10.123456");
  assert.equal(store.input("deploymentA:walletB:deposit", "100"), "100");
  assert.equal(store.input("deploymentB:walletA:deposit", "100"), "100");
  assert.equal(createSessionStore().input("deploymentA:walletA:deposit"), "");
});
test("protocol event history reads explicit 200-block pages for all three event contracts", async () => {
  const f = fixture();
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  const client = {
    ...f.client,
    getBlock: async () => ({ number: 500n, timestamp: 1000n }),
    getLogs: async (r: { fromBlock: bigint; toBlock: bigint }) => {
      ranges.push(r);
      return [];
    },
    getContractEvents: async (r: { fromBlock: bigint; toBlock: bigint }) => {
      ranges.push(r);
      return [];
    },
  } as unknown as ReadClient;
  const page = await readHistoryPage(
    client,
    f.contracts,
    jurorA,
    [0n],
    1n,
    undefined,
    [0n],
  );
  assert.equal(page.fromBlock, 301n);
  assert.equal(page.toBlock, 500n);
  assert.equal(page.next, 300n);
  assert.equal(ranges.length, 4);
  assert.ok(ranges.every((r) => r.fromBlock === 301n && r.toBlock === 500n));
});
test("dense protocol history fails explicitly rather than returning a truncated page", async () => {
  const f = fixture();
  const client = {
    ...f.client,
    getBlock: async () => ({ number: 500n, timestamp: 1000n }),
    getLogs: async () => Array(2001).fill({}),
    getContractEvents: async () => [],
  } as unknown as ReadClient;
  await assert.rejects(
    readHistoryPage(client, f.contracts, jurorA, [0n], 1n, undefined, [0n]),
    /too dense/,
  );
});
