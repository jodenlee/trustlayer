# Transaction reliability: "MetaMask transaction stuck pending"

Targeted fix after the UI redesign. No Solidity, economics, ABIs, SQL migrations, server APIs or hosted data changed. The active chain, its mempool and its backups were not modified.

## 1. Root cause (from read-only diagnostics of the running chain)

| Check (2026-11-22, running managed chain)                  | Result                                                                                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anvil process / RPC                                        | PID 7512, `anvil/v1.7.1`, `http://127.0.0.1:8545`, chain `0x7a69` (31337)                                                                             |
| Chain identity / manifest                                  | matches `phase5-dev1` (verified by `dev:status` and startup)                                                                                          |
| Automine                                                   | `anvil_getAutomine` → `true`                                                                                                                          |
| Head block                                                 | 20 (unchanged since the restore: nothing was mined)                                                                                                   |
| Client wallet `0xd8803e8051256a79a3cfbba97fb67d2f2858acce` | `eth_getTransactionCount` latest = **0**, pending = **0**                                                                                             |
| `txpool_content`                                           | 0 pending, 2 **queued** for that wallet (`txpool_status` reports 3; the content lists 2)                                                              |
| Queued #1                                                  | `0x3c2a0267ef2609da28e90354ffdefa353fa1a9fdb82cec130c07d2a8d7bafaa0`, **nonce 4**, `createProject` (selector `0xd7333a22`) to TrustEscrow, no receipt |
| Queued #2                                                  | `0x7a6e2b53670e717773d2b68fb6b48d8cf7a5c007acdb2d2fddc0a90568246abf`, **nonce 5**, `createProject`, no receipt                                        |
| Projects on chain                                          | `TrustEscrow.nextProjectId()` = **0** (no project created)                                                                                            |
| PostgreSQL metadata                                        | none for this deployment scope (metadata is only written after a confirmed receipt)                                                                   |

**Case C: queued behind a nonce gap.** MetaMask signed with nonce 4 while this chain expects nonce 0 for the account. MetaMask computes the next nonce from its own activity history for chain 31337 as well as from the RPC, and it still remembered four transactions from an earlier local chain (the previous Hardhat node / pre-restore chain). Anvil accepted the transaction into its _queued_ pool, where it waits forever for nonces 0–3, so no block is mined and no receipt exists. Speed Up and Cancel reuse the same stale nonce, so they queue too. The second transaction (nonce 5) was a retry after the first appeared stuck.

Why TrustLayer said "Confirmation unknown": the controller only waited up to 60 s for a receipt (`waitForTransactionReceipt`) and could not tell a queued transaction from a slow one. Neither the node nor the app was faulty: automine was on, the RPC was healthy, and the wallet and app used the same chain instance. The frontend gaps were:

- no diagnosis of why a receipt was missing
- no check of the node's pool before signing, so a page refresh (which clears the in-memory pending lock) allowed the duplicate nonce-5 attempt
- no way to recover a creation whose receipt arrived late

**Additional risk found and verified on a real Anvil node:** if the wallet's nonce were reset and the user then sent four new transactions (filling nonces 0–3), the stale queued `createProject` would execute by itself — an unexpected duplicate project. The queued entries must therefore be removed explicitly before resuming. `dev:stop` also refuses to back up while queued transactions exist (by Phase 5 design), so they must be resolved for a clean shutdown.

## 2. Changes

| File                                                                      | Change                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/lib/blockchain/pool.ts` (new)                               | Read-only node view of an account (`latest`/`pending` nonce, `txpool_content` entries); `classifyUnmined(hash)` → `mined` / `unknown` / `pending` / `nonce-gap` / `nonce-used`; `assertNoPooledTransactions`                                                                                                                                     |
| `apps/web/src/lib/blockchain/workflow-controller.ts`                      | Before every write: refuse if the node still holds a pending or queued transaction for this wallet (survives refresh, unlike session memory). While waiting: every 2 s ask the node why there is no receipt; a nonce-gapped transaction is reported immediately instead of after the 60 s timeout                                                |
| `apps/web/src/lib/blockchain/transactions.ts`, `errors.ts`                | New `nonce` error kind; an unconfirmed transaction keeps its hash and carries the specific explanation                                                                                                                                                                                                                                           |
| `apps/web/src/components/transaction-feedback.tsx`                        | "Stuck: wallet nonce is ahead of the chain" state                                                                                                                                                                                                                                                                                                |
| `apps/web/src/components/project-form.tsx`                                | Confirmation steps extracted into `finishCreation` (receipt → canonical project ID → idempotent metadata sync). New **Check receipt again**: success completes the _same_ creation, a revert frees the form, otherwise the node's explanation is shown. **Check pending creation** reopens an unresolved attempt instead of starting a new draft |
| `apps/web/src/components/chain-history.tsx`                               | Transactions page **Waiting in the local node** panel (node's pool for this wallet, expected nonce, recovery steps); "Check receipt" explains missing receipts                                                                                                                                                                                   |
| `scripts/dev.ts`, `package.json`                                          | `dev:status` shows pending/queued counts; new `dev:drop-queued` (explicit, see §4); failed shutdown backups point to it                                                                                                                                                                                                                          |
| `apps/web/scripts/verify-nonce-recovery.ts` (new), `npm run verify:nonce` | Disposable real-Anvil reproduction and recovery check (port 18547)                                                                                                                                                                                                                                                                               |
| `apps/web/test-support/escrow-rpc.ts`                                     | Fixture: per-sender nonces, `eth_getTransactionCount`, `txpool_content`, fault injection for nonce-gapped transactions                                                                                                                                                                                                                           |
| `apps/web/unit/pool.test.ts`, `apps/web/tests/confirmation.spec.ts` (new) | Regression tests                                                                                                                                                                                                                                                                                                                                 |

## 3. Confirmation behaviour

The UI distinguishes these states:

- awaiting wallet signature
- submitted
- waiting for confirmation (pending)
- confirmed
- transaction failed (reverted)
- declined in wallet (rejected)
- **stuck: wallet nonce is ahead of the chain**
- confirmation unknown (receipt not found yet; never treated as failure)
- confirmed, but saving details failed (the project page offers retry; never a second creation)

Submitted hashes stay in the session request list and in the creation dialog for rechecking. Duplicate protection now has two layers:

- in-tab: the existing unresolved-attempt lock
- across refreshes and restarts: the node's own pool — no new write is offered while this wallet has a pending or queued transaction

A creation is only allowed again once its earlier attempt is verified reverted, never received by the node, or removed from the pool.

## 4. Safe recovery procedure (MetaMask stale nonce)

Do these in order. Don't skip step 1.

1. **Check, don't resubmit.**
   ```powershell
   npm.cmd run dev:status          # shows "Mempool … queued"
   npm.cmd run dev:drop-queued     # lists queued hashes, nonces and senders; changes nothing
   ```
   For any hash, confirm on the node itself:
   ```powershell
   $rpc = 'http://127.0.0.1:8545'
   function Rpc($m, $p) { (Invoke-RestMethod $rpc -Method Post -ContentType 'application/json' -Body (@{jsonrpc='2.0';id=1;method=$m;params=$p} | ConvertTo-Json -Compress -Depth 5)).result }
   Rpc 'eth_getTransactionReceipt' @('0xHASH')          # null = not mined
   Rpc 'eth_getTransactionByHash' @('0xHASH')           # nonce, from; blockNumber null = unmined
   Rpc 'eth_getTransactionCount' @('0xADDRESS','latest') # nonce the chain expects
   Rpc 'txpool_content' @()
   ```
   A queued entry whose nonce is above `eth_getTransactionCount(latest)` has not executed and cannot execute until the gap is filled.
2. **Remove exactly those queued transactions from the local node:**

   ```powershell
   npm.cmd run dev:drop-queued -- --hash 0x3c2a0267ef2609da28e90354ffdefa353fa1a9fdb82cec130c07d2a8d7bafaa0 --hash 0x7a6e2b53670e717773d2b68fb6b48d8cf7a5c007acdb2d2fddc0a90568246abf
   ```

   It refuses unless:
   - the chain is the verified managed chain for the manifest
   - each hash is queued, has no receipt, and its nonce is above the chain's nonce
   - those named hashes are _all_ of that sender's pooled entries

   It changes only the mempool, never chain state, balances or nonces. (Anvil 1.7.1 ignores `anvil_dropTransaction` for queued entries; the command uses `anvil_removePoolTransactions` for the verified sender.)

3. **Reset MetaMask's local nonce:** on the local network with the affected account selected, open Settings → Advanced → **Clear activity and nonce data**. This only clears MetaMask's local history. Do it only after step 1 showed no receipts for those hashes.
4. Reload TrustLayer, sign in, and create the project **once**.

**Recovery of an already confirmed project:** if a receipt exists (the transaction was mined), do not create again. In the creation dialog choose **Check pending creation → Check receipt again**: it verifies the receipt belongs to this wallet and the escrow contract, reads the canonical project ID from the `ProjectCreated` log, and saves the details idempotently. If you already left the page, open the project from Projects (it is discovered on-chain) and use **Edit project details** to save its name and description. Saving details never sends a blockchain transaction.

## 5. Test results

Executed 2026-11-22 on Windows (Node 25.6.1, Hardhat 3.22.0, Anvil 1.7.1, Chrome). Fault injection used fixtures or a disposable Anvil node; the active chain was only read.

| Command / check                                                             | Result                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run verify:nonce` (real disposable Anvil, port 18547)              | PASS: normal tx mined immediately; stale-nonce tx queued forever, classified `nonce-gap`, new writes refused; backup refused while queued; `anvil_dropTransaction` ignored the queued entry and per-sender removal cleared it with nonce/balance/blocks unchanged; filling the gap executed a stale tx (risk confirmed) |
| `npm.cmd --prefix apps/web run test:unit`                                   | 257 passed, 0 failed (4 new in `unit/pool.test.ts`)                                                                                                                                                                                                                                                                     |
| `tests/confirmation.spec.ts` + `creation.spec.ts`, 3 viewports              | 36 passed                                                                                                                                                                                                                                                                                                               |
| Full browser suite, desktop/tablet/mobile                                   | Run 1: 368 passed, 1 failed (`workspace.spec` "every protected page", desktop: a viem decode error during sign-in restoration under suite load; 30/30 when repeated in isolation). Run 2: **369 passed (7.9 min)**                                                                                                      |
| `npm.cmd test`                                                              | 200 passing                                                                                                                                                                                                                                                                                                             |
| `npm.cmd run typecheck`; app `typecheck`, `lint`, `format:check`, `build`   | all exit 0                                                                                                                                                                                                                                                                                                              |
| Four `verify-*-workflow.ts` EVM integrations                                | escrow, arbitration, backend, files PASS                                                                                                                                                                                                                                                                                |
| `git diff --check`                                                          | clean                                                                                                                                                                                                                                                                                                                   |
| `npm.cmd run dev:status`, `dev:drop-queued` (no `--hash`) on the live chain | read-only; listed the two queued hashes; nothing changed                                                                                                                                                                                                                                                                |

Scenario coverage:

| Scenario                                                                       | Covered by                                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Successful creation; mined immediately; correct project ID from the receipt    | `creation.spec` "extracts a nonzero ID", `verify-escrow-workflow` |
| Delayed confirmation                                                           | `creation.spec` deferred receipt                                  |
| Receipt timeout, then eventual success recovered once with metadata sync       | `confirmation.spec`                                               |
| Reverted transaction; wallet rejection; RPC failure                            | `creation.spec` failure matrix                                    |
| Deployment instance mismatch                                                   | `creation.spec` "manifest", `wallet.spec`                         |
| Account switch while pending                                                   | `escrow`/`arbitration`/`creation` specs                           |
| Stale nonce / nonce-gapped queue; refresh during pending; duplicate prevention | `confirmation.spec`, `verify:nonce`                               |
| Confirmed chain transaction with failed PostgreSQL sync                        | `files.spec` metadata-failure recovery                            |

## 6. Limitations

- MetaMask chooses the nonce; a dapp cannot reliably override it. TrustLayer detects and explains a stale nonce immediately and prevents further writes, but the wallet-side reset (step 3) remains a manual user action.
- Pool inspection uses `txpool_content`. On RPCs without it (e.g. Hardhat's in-process network) only the nonce comparison applies.
- Anvil's `txpool_status` counter can disagree with `txpool_content` (3 vs 2 observed). The tools trust the content listing.
- `dev:drop-queued` removes all pool entries of the named sender, and only after verifying each one was named and nonce-gapped.
- This document does not perform the recovery on your live chain; steps 2–4 are yours to run.
