import type { Address, Hash } from "viem";
import { IntegrationError } from "./errors";

/** Read-only subset of a viem public client used for mempool diagnostics. */
export interface PoolClient {
  getTransactionCount(args: {
    address: Address;
    blockTag: "latest" | "pending";
  }): Promise<number>;
  getTransaction(args: { hash: Hash }): Promise<{
    from: Address;
    nonce: number;
    blockNumber: bigint | null;
  }>;
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}
export interface PooledTransaction {
  hash: Hash;
  nonce: number;
  to?: Address;
  status: "pending" | "queued";
}
export interface AccountPool {
  /** Nonce the chain expects next (transactions already mined). */
  latestNonce: number;
  pendingNonce: number;
  transactions: PooledTransaction[];
  /** False when the node does not expose txpool_content (non-Anvil/geth RPC). */
  inspected: boolean;
}
type PoolContent = Record<
  "pending" | "queued",
  Record<string, Record<string, { hash: Hash; nonce: string; to?: Address }>>
>;

/**
 * The node's own view of an account: mined nonce and any transactions waiting
 * in its pool. A queued transaction (nonce above the next expected nonce) can
 * never be mined until the gap is filled. Reads only; never alters the pool.
 */
export async function accountPool(
  client: PoolClient,
  address: Address,
): Promise<AccountPool> {
  const [latestNonce, pendingNonce] = await Promise.all([
    client.getTransactionCount({ address, blockTag: "latest" }),
    client.getTransactionCount({ address, blockTag: "pending" }),
  ]);
  let content: PoolContent | undefined;
  try {
    content = (await client.request({
      method: "txpool_content",
    })) as PoolContent;
  } catch {
    content = undefined;
  }
  const transactions: PooledTransaction[] = [];
  for (const status of ["pending", "queued"] as const)
    for (const [from, byNonce] of Object.entries(content?.[status] ?? {}))
      if (from.toLowerCase() === address.toLowerCase())
        for (const tx of Object.values(byNonce))
          transactions.push({
            hash: tx.hash,
            nonce: Number(tx.nonce),
            to: tx.to,
            status,
          });
  transactions.sort((a, b) => a.nonce - b.nonce);
  return { latestNonce, pendingNonce, transactions, inspected: !!content };
}

export type UnminedStatus =
  | { kind: "mined" }
  | { kind: "unknown" }
  | { kind: "pending"; nonce: number }
  | { kind: "nonce-gap"; nonce: number; expected: number; from: Address }
  | { kind: "nonce-used"; nonce: number; expected: number };

/**
 * Why a submitted hash has no receipt yet, according to the app's RPC:
 * unknown to this node, waiting normally, stuck behind a nonce gap, or
 * superseded because its nonce was already used by another transaction.
 */
export async function classifyUnmined(
  client: PoolClient,
  hash: Hash,
): Promise<UnminedStatus> {
  let tx;
  try {
    tx = await client.getTransaction({ hash });
  } catch {
    return { kind: "unknown" };
  }
  if (tx.blockNumber !== null) return { kind: "mined" };
  const expected = await client.getTransactionCount({
    address: tx.from,
    blockTag: "latest",
  });
  if (tx.nonce > expected)
    return { kind: "nonce-gap", nonce: tx.nonce, expected, from: tx.from };
  if (tx.nonce < expected)
    return { kind: "nonce-used", nonce: tx.nonce, expected };
  return { kind: "pending", nonce: tx.nonce };
}

export function nonceGapMessage(nonce: number, expected: number) {
  return `Your wallet signed this transaction with nonce ${nonce}, but this chain expects nonce ${expected} for the account. The local node is holding it in its queue, where it cannot be mined; it is not confirmed and did not fail. This usually means MetaMask remembers transactions from an earlier local chain. Do not resubmit. See "Waiting in the local node" on the Transactions page for safe recovery steps.`;
}
/**
 * Refuse new writes while the node already holds transactions for this
 * account: a pending one will confirm shortly, and a queued one would execute
 * unexpectedly later if the nonce gap were filled by new transactions.
 */
export function assertNoPooledTransactions(pool: AccountPool) {
  const queued = pool.transactions.filter((t) => t.status === "queued");
  if (queued.length)
    throw new IntegrationError(
      "nonce",
      `This wallet already has ${queued.length} transaction(s) stuck in the local node (nonce ${queued.map((t) => t.nonce).join(", ")}; the chain expects ${pool.latestNonce}). No new transaction was sent, because the stuck ones could execute later. Open Transactions → "Waiting in the local node" for safe recovery steps.`,
    );
  if (pool.transactions.length || pool.pendingNonce > pool.latestNonce)
    throw new IntegrationError(
      "nonce",
      "A previous transaction from this wallet is still waiting to be mined. Wait for it to confirm (see Transactions) before sending another.",
    );
}
