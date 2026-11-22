/**
 * Disposable real-Anvil reproduction of the "MetaMask transaction stuck
 * pending" failure: a wallet signs with a nonce ahead of the chain, Anvil
 * queues the transaction forever, backups refuse, and filling the gap later
 * would execute the stale transaction. Verifies the frontend classification
 * and the explicit mempool-only recovery. Never touches port 8545.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWalletClient, http, type Hex } from "viem";
import { hardhat } from "viem/chains";
import {
  backupChain,
  startChain,
  stopNode,
} from "../../../scripts/lib/local-chain.js";
import {
  accountPool,
  assertNoPooledTransactions,
  classifyUnmined,
  type PoolClient,
} from "../src/lib/blockchain/pool";

const PORT = 18547;
const run = await startChain(`verify-nonce-${randomUUID()}`, PORT);
const temp = await mkdtemp(join(tmpdir(), "trustlayer-nonce-"));
try {
  const client = run.client;
  const pool = client as unknown as PoolClient;
  const [, wallet, other] = (await client.request({
    method: "eth_accounts",
  } as never)) as Hex[];
  const send = createWalletClient({
    account: wallet,
    chain: hardhat,
    transport: http(`http://127.0.0.1:${PORT}`),
  });
  assert.equal(
    await client.request({ method: "anvil_getAutomine" } as never),
    true,
  );

  // 1. Normal transaction: automine confirms immediately.
  const ok = await send.sendTransaction({ to: other, value: 1n });
  const receipt = await client.waitForTransactionReceipt({ hash: ok });
  assert.equal(receipt.status, "success");
  assert.deepEqual(await classifyUnmined(pool, ok), { kind: "mined" });
  const expected = await client.getTransactionCount({ address: wallet });
  assert.equal(expected, 1);

  // 2. Stale wallet nonce (expected + 3): accepted, queued, never mined.
  const before = await client.getBlockNumber({ cacheTime: 0 });
  const stuck = await send.sendTransaction({
    to: other,
    value: 7n,
    nonce: expected + 3,
  });
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await client.getBlockNumber({ cacheTime: 0 }), before);
  assert.equal(
    await client.getTransactionReceipt({ hash: stuck }).catch(() => null),
    null,
  );
  const status = await classifyUnmined(pool, stuck);
  assert.equal(status.kind, "nonce-gap");
  assert.equal(status.kind === "nonce-gap" && status.expected, 1);
  const view = await accountPool(pool, wallet);
  assert.equal(view.inspected, true);
  assert.deepEqual(
    view.transactions.map((t) => [t.status, t.nonce, t.hash]),
    [["queued", 4, stuck]],
  );
  assert.throws(
    () => assertNoPooledTransactions(view),
    /stuck in the local node/,
  );
  console.log(
    "✓ stale nonce reproduced: queued forever, classified as nonce-gap, new writes refused",
  );

  // 3. Backups refuse while the queue is non-empty (mempool is not state).
  await assert.rejects(
    backupChain(run.session, join(temp, "refused.json")),
    /queued/i,
  );
  console.log("✓ backup refused while a queued transaction exists");

  // 4. Explicit recovery: drop only that hash; chain state is untouched.
  const balance = await client.getBalance({ address: wallet });
  // Anvil 1.7.1 ignores anvil_dropTransaction for queued entries (verified
  // here); dev:drop-queued therefore uses the per-sender pool removal after
  // checking every entry of that sender was named and is nonce-gapped.
  await client.request({
    method: "anvil_dropTransaction",
    params: [stuck],
  } as never);
  assert.equal((await accountPool(pool, wallet)).transactions.length, 1);
  await client.request({
    method: "anvil_removePoolTransactions",
    params: [wallet],
  } as never);
  assert.deepEqual((await accountPool(pool, wallet)).transactions, []);
  assert.equal(await client.getTransactionCount({ address: wallet }), 1);
  assert.equal(await client.getBalance({ address: wallet }), balance);
  assert.equal(await client.getBlockNumber({ cacheTime: 0 }), before);
  await backupChain(run.session, join(temp, "after-drop.json"));
  console.log(
    "✓ anvil_dropTransaction ignores queued entries; per-sender pool removal cleared it; nonce, balance and blocks unchanged; backup succeeds",
  );

  // 5. Why dropping matters: filling a gap executes the stale transaction later.
  const stale = await send.sendTransaction({
    to: other,
    value: 9n,
    nonce: expected + 2,
  });
  for (let i = 0; i < 2; i++)
    await client.waitForTransactionReceipt({
      hash: await send.sendTransaction({ to: other, value: 1n }),
    });
  const late = await client.waitForTransactionReceipt({ hash: stale });
  assert.equal(late.status, "success");
  console.log(
    "✓ confirmed the risk: once the gap was filled, the stale queued transaction executed on its own",
  );
  console.log(
    "Nonce recovery verification PASS (disposable Anvil on port 18547; active chain untouched).",
  );
} finally {
  await stopNode(run.child);
  await rm(temp, { recursive: true, force: true });
}
