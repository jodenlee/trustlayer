import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMUSD, parseMUSD } from "../src/lib/format";
import {
  loadManifest,
  validateManifest,
  verifyManifest,
  type VerificationClient,
} from "../src/lib/blockchain/deployment";
import { describeError, IntegrationError } from "../src/lib/blockchain/errors";
import {
  createTransactionController,
  requestWalletSignature,
  type TransactionLifecycle,
  type TransactionDependencies,
} from "../src/lib/blockchain/transactions";
import { code, fixtureManifest } from "../test-support/protocol";
import type { Hash } from "viem";
test("stale MetaMask nonce failures give local recovery guidance without exposing RPC details", () => {
  for (const error of [
    { name: "NonceTooLowError" },
    { cause: { message: "nonce too high: private RPC details" } },
    { message: "nonce has already been used" },
  ]) {
    const result = describeError(error);
    assert.equal(result.kind, "rpc");
    assert.match(result.message, /confirmed fresh-chain reset/);
    assert.match(result.message, /do not resend an uncertain transaction/);
    assert.ok(!result.message.includes("private RPC details"));
  }
});
test("random chain anchors reject deterministic fresh chains even when code and chain ID match", async () => {
  const manifest = {
    ...fixtureManifest(),
    chainIdentity: { number: "1", hash: `0x${"2".repeat(64)}` as Hash },
  };
  await assert.rejects(
    verifyManifest(
      {
        getChainId: async () => 31337,
        getBlock: async () => ({ hash: manifest.verifiedBlock.hash }) as never,
        getCode: async () => code,
      },
      manifest,
    ),
    /validation failed/,
  );
});
test("legacy Hardhat process identity cannot silently authenticate a reset instance", async () => {
  const manifest = {
    ...fixtureManifest(),
    hardhatInstanceId: `0x${"2".repeat(64)}` as Hash,
  };
  await assert.rejects(
    verifyManifest(
      {
        getChainId: async () => 31337,
        getBlock: async () => ({ hash: manifest.verifiedBlock.hash }) as never,
        getCode: async () => code,
        request: (async () => ({
          instanceId: `0x${"3".repeat(64)}`,
        })) as VerificationClient["request"],
      },
      manifest,
    ),
    /validation failed/,
  );
});

test("accepts complete non-ephemeral local metadata and original generated ABIs", () => {
  const manifest = fixtureManifest();
  assert.equal(validateManifest(manifest).chainId, 31337);
  assert.equal(Object.keys(manifest.contracts).length, 5);
});
const invalidCases: [
  string,
  (m: ReturnType<typeof fixtureManifest>) => unknown,
][] = [
  [
    "unbound legacy chain",
    (m) => {
      delete m.chainIdentity;
      delete m.hardhatInstanceId;
      return m;
    },
  ],
  ["missing", () => undefined],
  ["empty", () => ({})],
  ["ephemeral", (m) => ({ ...m, ephemeral: true })],
  ["wrong chain", (m) => ({ ...m, chainId: 1 })],
  ["wrong RPC port", (m) => ({ ...m, rpcUrl: "http://127.0.0.1:18545" })],
  ["remote RPC", (m) => ({ ...m, rpcUrl: "https://example.com" })],
  [
    "missing contract",
    (m) => {
      delete (m.contracts as Partial<typeof m.contracts>).TrustEscrow;
      return m;
    },
  ],
  [
    "zero address",
    (m) => {
      m.contracts.MockUSD.address = `0x${"0".repeat(40)}`;
      return m;
    },
  ],
  [
    "duplicate address",
    (m) => {
      m.contracts.MockUSD.address = m.contracts.TrustEscrow.address;
      return m;
    },
  ],
  [
    "stale ABI",
    (m) => {
      m.contracts.MockUSD.abiHash = `0x${"0".repeat(64)}`;
      return m;
    },
  ],
];
for (const [name, mutate] of invalidCases)
  test(`rejects ${name} deployment metadata with setup guidance`, () => {
    assert.throws(
      () => validateManifest(mutate(fixtureManifest())),
      /export|Export|deployment/i,
    );
  });

function clientStub(overrides: object = {}): VerificationClient {
  return {
    getChainId: async () => 31337,
    getBlock: async () => ({ hash: fixtureManifest().verifiedBlock.hash }),
    getCode: async () => code,
    ...overrides,
  } as unknown as VerificationClient;
}
test("validates block anchor and every deployed runtime before returning typed addresses", async () => {
  const contracts = await verifyManifest(clientStub(), fixtureManifest());
  assert.equal(
    contracts.MockUSD.address,
    fixtureManifest().contracts.MockUSD.address,
  );
  assert.equal(
    contracts.MockUSD.abi.some(
      (item) => item.type === "function" && item.name === "balanceOf",
    ),
    true,
  );
});
for (const [name, overrides] of [
  ["RPC chain", { getChainId: async () => 1 }],
  ["reset block", { getBlock: async () => ({ hash: `0x${"0".repeat(64)}` }) }],
  ["missing runtime", { getCode: async () => "0x" }],
  ["changed runtime", { getCode: async () => "0x6001" }],
] as const)
  test(`rejects ${name} during live validation`, async () => {
    await assert.rejects(
      verifyManifest(clientStub(overrides), fixtureManifest()),
    );
  });
test("RPC unavailable remains a failed read rather than a fabricated deployment", async () => {
  await assert.rejects(
    verifyManifest(
      clientStub({
        getChainId: async () => {
          throw new Error("HTTP unavailable");
        },
      }),
      fixtureManifest(),
    ),
    /HTTP unavailable/,
  );
});
test("missing static manifest produces setup guidance", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("missing", { status: 404 }),
  );
  await assert.rejects(loadManifest(), /manifest is unavailable/);
});
test("malformed JSON produces setup guidance", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("{broken"));
  await assert.rejects(loadManifest(), /JSON is unreadable/);
});
test("formats six decimals and values above Number.MAX_SAFE_INTEGER exactly", () => {
  assert.equal(formatMUSD(123_456_789n), "123.456789");
  assert.equal(formatMUSD(1n), "0.000001");
  assert.equal(formatMUSD(123_000_000n, true), "123.000000");
  assert.equal(formatMUSD(9_007_199_254_740_993n), "9,007,199,254.740993");
  assert.equal(parseMUSD("9007199254.740993"), 9_007_199_254_740_993n);
  assert.equal(parseMUSD("1.0000001"), null);
});
test("classifies nested wallet rejection, network mismatch, and RPC failures", () => {
  assert.equal(describeError({ cause: { code: 4001 } }).kind, "rejected");
  assert.equal(
    describeError(new IntegrationError("network", "Wrong network")).kind,
    "network",
  );
  assert.equal(
    describeError({ name: "TransactionReceiptRevertedError" }).kind,
    "reverted",
  );
  assert.equal(describeError(new Error("offline")).kind, "rpc");
});

const hash = `0x${"1".repeat(64)}` as Hash;
const replacementHash = `0x${"2".repeat(64)}` as Hash;
function transactionFixture(
  overrides: Partial<TransactionDependencies<string>> = {},
) {
  const states: TransactionLifecycle[] = [];
  let refreshes = 0;
  const controller = createTransactionController<string>({
    validate: async () => "verified context",
    isCurrent: () => true,
    wait: async () => ({
      status: "success",
      transactionHash: hash,
      blockNumber: 10n,
    }),
    refresh: async () => {
      refreshes++;
    },
    publish: (state) => states.push(state),
    ...overrides,
  });
  return { controller, states, refreshes: () => refreshes };
}
test("submission is distinct from confirmed execution, then refreshes reads", async () => {
  const f = transactionFixture();
  await f.controller.execute(async (context) => {
    assert.equal(context, "verified context");
    return hash;
  });
  assert.deepEqual(
    f.states.map((s) => s.phase),
    [
      "validating",
      "awaiting-signature",
      "submitted",
      "confirming",
      "confirmed",
    ],
  );
  assert.equal(f.states.at(-1)?.hash, hash);
  assert.equal(f.refreshes(), 1);
});
test("wallet rejection is not treated as a submission", async () => {
  const f = transactionFixture();
  await f.controller.execute(async () => {
    throw { code: 4001 };
  });
  assert.equal(f.states.at(-1)?.phase, "rejected");
  assert.equal(f.states.at(-1)?.hash, undefined);
});
test("network mismatch prevents the wallet signing request", async () => {
  const f = transactionFixture({
    validate: async () => {
      throw new IntegrationError("network", "Wrong network");
    },
  });
  let submitted = false;
  await f.controller.execute(async () => {
    submitted = true;
    return hash;
  });
  assert.equal(submitted, false);
  assert.equal(f.states.at(-1)?.errorKind, "network");
});
test("reverted mined receipt never confirms or refetches success", async () => {
  const f = transactionFixture({
    wait: async () => ({
      status: "reverted",
      transactionHash: hash,
      blockNumber: 10n,
    }),
  });
  await f.controller.execute(async () => hash);
  assert.equal(f.states.at(-1)?.phase, "reverted");
  assert.equal(f.refreshes(), 0);
});
test("receipt RPC failure preserves hash and reports unconfirmed, not failed execution", async () => {
  const f = transactionFixture({
    wait: async () => {
      throw new Error("timeout");
    },
  });
  await f.controller.execute(async () => hash);
  assert.equal(f.states.at(-1)?.phase, "unconfirmed");
  assert.equal(f.states.at(-1)?.hash, hash);
});
test("failed submission has no fabricated hash or confirmation", async () => {
  const f = transactionFixture();
  await f.controller.execute(async () => {
    throw new Error("RPC offline");
  });
  assert.equal(f.states.at(-1)?.phase, "failed");
  assert.equal(f.states.at(-1)?.hash, undefined);
});
test("invalid wallet hash is rejected without exposing it as a submitted transaction", async () => {
  const f = transactionFixture();
  await f.controller.execute(async () => "0xinvalid" as Hash);
  assert.equal(f.states.at(-1)?.phase, "failed");
  assert.equal(f.states.at(-1)?.hash, undefined);
});
test("mismatched receipt is unconfirmed rather than a success for another transaction", async () => {
  const f = transactionFixture({
    wait: async () => ({
      status: "success",
      transactionHash: replacementHash,
      blockNumber: 10n,
    }),
  });
  await f.controller.execute(async () => hash);
  assert.equal(f.states.at(-1)?.phase, "unconfirmed");
  assert.equal(f.states.at(-1)?.hash, hash);
  assert.equal(f.refreshes(), 0);
});
test("refresh failure preserves actual confirmation", async () => {
  const f = transactionFixture({
    refresh: async () => {
      throw new Error("read offline");
    },
  });
  await f.controller.execute(async () => hash);
  assert.equal(f.states.at(-1)?.phase, "confirmed");
  assert.match(
    f.states.at(-1)?.refreshWarning ?? "",
    /refreshing reads failed/,
  );
});
for (const reason of ["repriced", "replaced", "cancelled"] as const)
  test(`handles ${reason} replacement without falsely confirming the original action`, async () => {
    const f = transactionFixture({
      wait: async (_, replaced) => {
        replaced({ reason, hash: replacementHash });
        return {
          status: "success",
          transactionHash: replacementHash,
          blockNumber: 11n,
        };
      },
    });
    await f.controller.execute(async () => hash);
    assert.equal(
      f.states.at(-1)?.phase,
      reason === "repriced" ? "confirmed" : reason,
    );
    assert.equal(f.states.at(-1)?.hash, replacementHash);
    assert.equal(f.states.at(-1)?.submittedHash, hash);
  });
test("account change suppresses stale confirmations and refresh callbacks", async () => {
  let current = true;
  const f = transactionFixture({
    isCurrent: () => current,
    wait: async () => {
      current = false;
      return { status: "success", transactionHash: hash, blockNumber: 10n };
    },
  });
  await f.controller.execute(async () => hash);
  assert.equal(
    f.states.some((s) => s.phase === "confirmed"),
    false,
  );
  assert.equal(f.refreshes(), 0);
});
test("prevents overlapping signing requests", async () => {
  let finish!: (hash: Hash) => void;
  const pending = new Promise<Hash>((resolve) => {
    finish = resolve;
  });
  const f = transactionFixture();
  const first = f.controller.execute(() => pending);
  await assert.rejects(
    f.controller.execute(async () => hash),
    /already being tracked/,
  );
  finish(hash);
  await first;
  assert.equal(f.controller.busy, false);
});
test("message signature requires validation and rejects account changes", async () => {
  assert.equal(
    await requestWalletSignature(
      async () => "account",
      async () => hash,
    ),
    hash,
  );
  await assert.rejects(
    requestWalletSignature(
      async () => "account",
      async () => hash,
      () => false,
    ),
    /account or network changed/,
  );
});
