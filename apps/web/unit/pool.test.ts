import test from "node:test";
import assert from "node:assert/strict";
import type { Address, Hash } from "viem";
import {
  accountPool,
  assertNoPooledTransactions,
  classifyUnmined,
  type PoolClient,
} from "../src/lib/blockchain/pool";
import { IntegrationError } from "../src/lib/blockchain/errors";

const me = "0xd8803e8051256a79a3cfbba97fb67d2f2858acce" as Address;
const other = "0x2222222222222222222222222222222222222222" as Address;
const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;

function client(options: {
  latest?: number;
  pending?: number;
  pool?: unknown;
  poolError?: boolean;
  txs?: Record<
    string,
    { from: Address; nonce: number; blockNumber: bigint | null }
  >;
}): PoolClient {
  return {
    async getTransactionCount({ blockTag }) {
      return blockTag === "latest"
        ? (options.latest ?? 0)
        : (options.pending ?? options.latest ?? 0);
    },
    async getTransaction({ hash }) {
      const tx = options.txs?.[hash];
      if (!tx) throw new Error("TransactionNotFoundError");
      return tx;
    },
    async request() {
      if (options.poolError) throw new Error("method not found");
      return options.pool ?? { pending: {}, queued: {} };
    },
  };
}

test("account pool reports only this wallet's queued and pending entries", async () => {
  const pool = await accountPool(
    client({
      latest: 0,
      pool: {
        pending: { [other]: { "0": { hash: h(9), nonce: "0x0" } } },
        queued: {
          [me]: {
            "5": { hash: h(2), nonce: "0x5" },
            "4": { hash: h(1), nonce: "0x4" },
          },
        },
      },
    }),
    me,
  );
  assert.equal(pool.inspected, true);
  assert.equal(pool.latestNonce, 0);
  assert.deepEqual(
    pool.transactions.map((t) => [t.nonce, t.status, t.hash]),
    [
      [4, "queued", h(1)],
      [5, "queued", h(2)],
    ],
  );
});

test("nodes without txpool support still report nonces", async () => {
  const pool = await accountPool(client({ latest: 3, poolError: true }), me);
  assert.equal(pool.inspected, false);
  assert.deepEqual(pool.transactions, []);
});

test("new writes are refused while stuck or pending transactions exist", () => {
  assert.doesNotThrow(() =>
    assertNoPooledTransactions({
      latestNonce: 0,
      pendingNonce: 0,
      transactions: [],
      inspected: true,
    }),
  );
  assert.throws(
    () =>
      assertNoPooledTransactions({
        latestNonce: 0,
        pendingNonce: 0,
        transactions: [{ hash: h(1), nonce: 4, status: "queued" }],
        inspected: true,
      }),
    (e) =>
      e instanceof IntegrationError &&
      e.kind === "nonce" &&
      /stuck in the local node \(nonce 4; the chain expects 0\)/.test(
        e.message,
      ),
  );
  assert.throws(
    () =>
      assertNoPooledTransactions({
        latestNonce: 2,
        pendingNonce: 3,
        transactions: [],
        inspected: false,
      }),
    /still waiting to be mined/,
  );
});

test("unmined hashes are classified from the node, never from the wallet", async () => {
  const c = client({
    latest: 0,
    txs: {
      [h(1)]: { from: me, nonce: 4, blockNumber: null },
      [h(2)]: { from: me, nonce: 0, blockNumber: null },
      [h(3)]: { from: me, nonce: 0, blockNumber: 7n },
    },
  });
  assert.deepEqual(await classifyUnmined(c, h(1)), {
    kind: "nonce-gap",
    nonce: 4,
    expected: 0,
    from: me,
  });
  assert.deepEqual(await classifyUnmined(c, h(2)), {
    kind: "pending",
    nonce: 0,
  });
  assert.deepEqual(await classifyUnmined(c, h(3)), { kind: "mined" });
  assert.deepEqual(await classifyUnmined(c, h(4)), { kind: "unknown" });
  const used = client({
    latest: 5,
    txs: { [h(1)]: { from: me, nonce: 4, blockNumber: null } },
  });
  assert.deepEqual(await classifyUnmined(used, h(1)), {
    kind: "nonce-used",
    nonce: 4,
    expected: 5,
  });
});
