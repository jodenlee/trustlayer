# UI redesign, wallet sign-in and daily startup — handover

This stage follows Phase 5. It changes the frontend presentation, adds a wallet-gated entry and simplifies local startup. **No Solidity, protocol economics, contract interfaces, generated ABIs, SQL migrations, server API behavior or hosted data were changed.** Nothing was deployed, committed or pushed.

## 1. Product design direction

TrustLayer should feel like a calm, professional payments product, not a blockchain console. Every screen answers four questions in order: _where am I_ (page title + status badge + your role), _what is the status_ (a "next step" or "current stage" panel), _what can I do_ (one primary action, role-aware), _what do I need to know first_ (amounts, fees, deadlines shown next to the action). Technical data — hashes, contract addresses, chain time, metadata fingerprints, protocol-wide totals — moved into collapsed **Technical details** / **Transaction details** disclosures instead of being removed.

Principles applied: one bordered panel per meaningful group (no card walls), no decorative gradients or large icons, status by small tinted badges, deadlines shown as both relative chain-time ("11h 20m left") and absolute UTC, financial confirmations always show the amount, fee and net, and empty states explain the next real step instead of showing sample data.

## 2. Palette and typography ("calm ledger")

| Token                              | Value                                                         | Use                                           |
| ---------------------------------- | ------------------------------------------------------------- | --------------------------------------------- |
| `--bg`                             | `#f6f5f1`                                                     | warm paper background                         |
| `--surface` / `--surface-2`        | `#ffffff` / `#faf9f6`                                         | panels / sidebar, subtle fills                |
| `--border`                         | `#e6e3dc`                                                     | hairlines                                     |
| `--text` / `--text-2` / `--text-3` | `#1b1e22` / `#4b525b` / `#767c85`                             | ink, secondary, tertiary                      |
| `--brand`                          | `#1f5c4d` (hover `#174a3e`, soft `#e6efeb`)                   | primary actions, focus, progress, "next step" |
| info / success / warning / danger  | `#2c5786` / `#2d6a3e` / `#87580f` / `#a3352c` with soft tints | status badges and notices                     |

Typography: Inter Variable (already a dependency) at 14 px base, 24 px page titles, 600 weight headings, tabular figures for money; system monospace for hashes and addresses. Radius 10 px (panels) / 7 px (controls). Focus ring: 2 px `--focus`. Light theme only. No new UI dependencies were added.

## 3. Information architecture

| Route                                          | Purpose                                                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/sign-in`                                     | Public entry: connect wallet → sign in with Ethereum                                                                                                              |
| `/`                                            | Redirects to `/sign-in` (no session cookie) or `/dashboard`                                                                                                       |
| `/dashboard` (**Overview**)                    | Balance / escrow / active projects / open disputes; **Needs your attention** list derived from the same on-chain permission rules as the buttons; recent projects |
| `/projects`, `/projects/new`, `/projects/[id]` | List with "Needs action" filter; creation form with sticky summary; detail with next-step panel and milestone timeline                                            |
| `/disputes`, `/disputes/[id]`                  | Cases where you are a party or juror; case page with stage panel, vote/respond/finalize/claim, evidence, jurors, timeline                                         |
| `/juror` (**Jury**)                            | Stake figures, register / add / withdraw stake, your assignments                                                                                                  |
| `/transactions`                                | Requests this session + confirmed on-chain activity                                                                                                               |
| `/settings`                                    | Profile, preferences (full token precision, remembered per browser), wallet & session, protocol/contract details                                                  |

All numeric deep links (`/projects/12`, `/disputes/3`) are unchanged. The fictional preview routes (`/projects/tl-*`, `/disputes/dp-*`) now return the not-found page because the preview data was removed. Navigation: left sidebar (≥1024 px) with an account panel (name or address, network, Wallet, Sign out); below 1024 px a top bar with a drawer.

## 4. Authentication entry flow

1. A visitor opens any page → `/sign-in` (with `?next=` for the intended page).
2. Step 1 **Connect wallet** (MetaMask/injected; connection signs nothing). Missing wallet → "No browser wallet found" guidance with a re-check button. Wrong network → "Switch to Hardhat Local" (chain 31337).
3. Step 2 **Sign in with Ethereum**: the existing nonce → `personal_sign` → verify endpoints create the HttpOnly database session. Nothing is signed automatically on load. A declined signature shows "You declined the signature request. Nothing was signed…". An unconfigured database shows "Sign-in is unavailable".
4. On success the user returns to `next` (validated by `safeDestination`: same-origin protected paths only; anything else → `/dashboard`).
5. On refresh, a matching unexpired session for the connected wallet/chain is restored without a signature. `AuthProvider` now keeps `checking` true until wagmi's first reconnect cycle completes, so the gate never redirects before restoration.
6. Account or network switch → the existing revocation logs out the old session → `/sign-in?next=…&ended=1` ("Your session ended or your wallet changed"). Expiry (detected by the 30 s / focus re-check) does the same. **Sign out** (sidebar, wallet dialog, Settings) revokes the server session and goes to `/sign-in` without the "ended" notice; the wallet stays connected so signing back in needs one signature. **Disconnect wallet** remains in the wallet dialog.

## 5. Protected route behavior

- `src/proxy.ts` (Next.js 16 Proxy): for `/` and every workspace prefix, visitors without a well-formed `tl_session`/`__Host-tl_session` cookie get a server redirect to `/sign-in?next=…` before any protected page renders. This is an optimistic check only.
- `components/auth-gate.tsx` wraps the `(workspace)` layout: it renders a neutral "Restoring your session…" state until wallet restoration and the server session read settle, then renders children only if the server-confirmed session matches the connected address and chain; otherwise it redirects. A stale or forged cookie therefore cannot unlock a page, and there is no loop (the sign-in page never redirects unless the session is valid).
- Server APIs are unchanged and authorize every private request independently (session, Origin, participant/juror checks, deployment binding).

## 6. Screens changed

Sign-in (new), Overview, Projects, New project, Project detail (next-step panel: fund in two steps / accept / deliver / review; milestone timeline where only the current milestone is expanded; delivery = private upload + auto-filled SHA-256 fingerprint; review shows amount → 1% fee → freelancer receives; dispute opening moved into a "Problem with this milestone? Open a dispute" disclosure; earlier milestones' files in "Files and submission details"), Disputes list, Dispute detail (stage panel with relative deadlines, response box, vote options with plain-language effects, finalize, reward claim, outcome breakdown), Jury, Transactions, Settings, wallet dialog, transaction feedback (spinner/success/failure with the hash under "Transaction details"), review dialogs, not-found and error pages.

## 7. Components

Added: `auth-gate.tsx`, `sign-in.tsx`, `brand.tsx`, `overview.tsx`, `lib/auth-routing.ts`, `lib/attention.ts`, `proxy.ts`; UI primitives `Notice`, `Disclosure`, `KeyValue`, `Hash` (shortened + copy), `Spinner`, `LoadingRow`, `CardBody`, `CardFooter`, `SectionTitle`, `Textarea`; `timeUntil()` (chain-time countdowns). Rewritten: `globals.css`, `ui.tsx`, `shell.tsx`, `providers.tsx` (`usePreview` → `useUi`), `wallet.tsx`, `live-wallet.tsx` (`WalletSummary`, `ProtocolDetails`), `settings.tsx`, `backend-auth.tsx` (profile only), `chain-*.tsx`, `project-form.tsx`, `private-files.tsx` (presentation only), `project-metadata.tsx`, `project-arbitration.tsx`, `reviewed-action.tsx`, `transaction-feedback.tsx`. Removed (fictional preview layer): `dashboard.tsx`, `project-list.tsx`, `project-table.tsx`, `project-detail.tsx`, `dispute-list.tsx`, `dispute-detail.tsx`, `juror.tsx`, `transactions.tsx`, `stats.tsx`, `lib/preview-data.ts`, `lib/models.ts`, `app/(public)/*`. Transaction, review-context, duplicate-protection, receipt and file-association logic was carried over unchanged.

## 8. Daily startup

```powershell
npm.cmd run dev          # start (restore or reuse the chain, verify, start the app)
npm.cmd run dev:status   # what is running, which backup would be restored
```

`npm run dev` (`scripts/dev.ts start`):

1. Checks Node, both dependency trees, the pinned Anvil binary and `.env.local`.
2. Requires the active manifest to be bound to a managed Anvil chain identity (legacy Hardhat exports are refused with instructions).
3. If port 8545 is **free**: reads the headers of `.local-chain/backups/*.json`, keeps only backups of the manifest's chain identity, and picks the newest — **only if it is also the most advanced**. If an older backup is further ahead or two backups disagree about the same block (history forked after an earlier restore), it stops and lists the candidates for an explicit `--backup PATH`. No matching backup → stop; a fresh chain is never created. The chosen backup goes through the existing `readBackup` checksum/version checks and `startChain` head verification under a new run name `dev-YYYYMMDD-HHMMSS`. If the backup carries a manifest, it must equal the active one.
4. If port 8545 is **in use**: it is reused only if it is Anvil, its PID matches a recorded run session of this exact chain identity and its executable is the pinned Anvil binary. If a `npm run chain` controller is alive, the chain is used but left under that terminal's control. Anything else (Hardhat, another program) is refused and left running.
5. Verifies chain identity, every deployed runtime and the manifest (`assertDeploymentOnChain`).
6. **Read-only** PostgreSQL check (`apps/web/scripts/dev-consistency.ts`, `BEGIN READ ONLY`, same TLS config as the app): for this deployment scope, saved project/dispute IDs must exist on the chain, recorded confirmation blocks must not exceed the head, and the 50 most recent recorded receipts must exist at the recorded blocks. Any mismatch stops startup (the just-restored node is stopped; it is identical to its backup). If the database is unreachable or unconfigured, it warns and continues (the newest local checkpoint was used).
7. Publishes the manifest to `apps/web/public` (`sync-deployment.mjs`), starts `next dev` on the `AUTH_ORIGIN` port (default 3000; refuses an occupied port unless it is the recorded leftover app server of a previous session), waits for readiness and prints the URL.
8. While running: an immutable checkpoint every minute **only when the chain head changed** (an idle chain adds no files).

It never redeploys, provisions balances, edits the manifest, writes to PostgreSQL/Storage, or overwrites a backup (all backups use exclusive creation).

## 9. Shutdown and backup

```powershell
npm.cmd run dev:stop     # from any terminal; or Ctrl+C in the dev terminal
```

Shutdown stops the app first (no new activity), then creates a final backup **including the verified manifest**, retrying for up to 20 s while pending transactions confirm (queued/nonce-gapped transactions still block, as in Phase 5), re-reads it to verify the checksum, then stops the node and waits for port 8545 to free. If the backup fails, the node is left running and the error says so; run `dev:stop` again after fixing the cause. Closing the terminal (SIGHUP) triggers the same sequence within Windows' ~10 s allowance.

**Crash / closed VS Code:** the Anvil node runs detached and usually survives. `npm run dev` reuses it with its newest state. `npm run dev:stop` without a live wrapper stops the leftover app server (verified by command line) and backs up/stops the verified node. After a machine crash, the latest checkpoint (≤ 1 minute of chain activity behind) is restored, and step 6 refuses to continue if PostgreSQL is ahead of it.

**First-time setup:** `npm run dev:init -- --name NAME [--archive-current]` starts a NEW chain, deploys Phase2D with Ignition ID `trustlayer-NAME`, exports/verifies, publishes, optionally provisions wallets (when `TRUSTLAYER_CLIENT` etc. are set), saves a backup with the manifest and stops. It refuses if a manifest exists unless `--archive-current` (moved to `.local-chain/archive/`, never overwritten; the undo command is printed).

**Recovery when no usable backup exists:** do not use `dev:init` casually — a new chain starts an empty deployment scope; existing PostgreSQL rows and files remain bound to the old one. Investigate `.local-chain/backups` first (`npm run dev:status`, `--backup PATH`). The Phase 5 `npm run chain -- …` commands remain available for manual control.

Retention: backups are never deleted automatically (~0.8 MB each with the current state). Delete old checkpoints only deliberately, keeping at least the newest few and any backup that includes a manifest.

## 10. Testing results

All executed on 2026-11-22 (Windows, Node 25.6.1, Hardhat 3.22.0, Anvil 1.7.1, installed Chrome). Hosted PostgreSQL was only read (startup consistency check); browser/API fixtures are isolated.

| Command / check                                                               | Result                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline before changes: full browser suite                                   | 339 passed, 3 failed (desktop-only timing failures in arbitration/files specs that passed on tablet/mobile)                                                             |
| `npm.cmd run compile`                                                         | exit 0 (no Solidity changes)                                                                                                                                            |
| `npm.cmd test`                                                                | **200 passing** (187 existing + 13 new `test/DevStartup.ts`)                                                                                                            |
| `npm.cmd run typecheck` (root)                                                | exit 0                                                                                                                                                                  |
| `npm.cmd --prefix apps/web run test:unit`                                     | **253 passed**, 0 failed (247 existing + 6 new `unit/navigation.test.ts`)                                                                                               |
| `npm.cmd --prefix apps/web run lint` / `typecheck` / `format:check` / `build` | all exit 0                                                                                                                                                              |
| Full browser suite (`PLAYWRIGHT_PORT=3001`, Chrome)                           | **363 passed (14.0 min)**, desktop/tablet/mobile, exit 0                                                                                                                |
| Four `npx.cmd hardhat run apps/web/scripts/verify-*-workflow.ts`              | escrow, arbitration, backend and files all PASS                                                                                                                         |
| `npm.cmd run verify:persistence`                                              | PASS (actual Anvil restart)                                                                                                                                             |
| `git diff --check`                                                            | clean                                                                                                                                                                   |
| Real `npm run dev` on the existing `dev1` chain                               | restored newest backup (block 20), identity/contracts/manifest verified, hosted DB check read-only ("no saved metadata for this deployment"), app served `/sign-in` 200 |
| `npm run dev:stop` (live session)                                             | verified backup written, node stopped, port freed; next `dev:status` selects the new backup                                                                             |
| Crash: wrapper force-killed, then `npm run dev`                               | orphaned chain reused ("no restore needed"), app restarted, clean stop afterwards                                                                                       |
| Crash, then `npm run dev:stop` with no wrapper                                | backed up and stopped the verified orphan node                                                                                                                          |
| Unrelated process holding port 8545                                           | startup refused; that process left running                                                                                                                              |

Browser-suite migration: every existing spec now signs in through `/sign-in` (mocked API via `tests/auth-fixture.ts`, or the real isolated SIWE/SQL `authBackend` where it was used before). No test was deleted. Tests about fictional preview mode were replaced by route-protection/sign-in/session tests in `workspace.spec.ts`. The "wallet change invalidates an open review" tests now assert the stronger behavior (session revoked, redirect to sign-in, dialog closed, no `eth_sendTransaction`). That migration found one UI bug — a review dialog could stay visible on `/sign-in` after a session ended — fixed in `reviewed-action.tsx` (it only hides the dialog; signing still re-validates wallet and deployment).

Not performed: manual testing with real MetaMask.

## 11. Known issues and limitations

- Follow-up fix: stuck MetaMask transactions (stale wallet nonce) — see [TRANSACTION_RELIABILITY.md](TRANSACTION_RELIABILITY.md).

- Actual MetaMask was not driven in automated tests (test-only injected providers are used); manual MetaMask verification of sign-in, signing and transactions is still recommended.
- A network switch inside the app revokes the session (existing Phase 4A behaviour) and returns to sign-in.
- Overview figures and lists cover the most recently loaded project/dispute pages (20 IDs each); "Load earlier" buttons remain on list pages.
- The proxy accepts either session cookie name as a hint only; it is not authorization.
- `dev` consistency checks the 50 most recent recorded receipts, not every row.
- Refund / treasury administration UIs remain out of scope (as before).
- The hosted database still uses the broad owner login; restricted runtime-role separation (`db:runtime:check` currently fails) remains an operator task (docs/PHASE5.md §9).

## 12. Future cloud deployment considerations

- Frontend/API: deploy `apps/web` (e.g. Vercel/Node host) with server-only env vars; `AUTH_ORIGIN` must be the exact HTTPS origin; production already uses `__Host-` Secure cookies.
- Chain: a public testnet (e.g. Sepolia) with a fresh deployment and a public RPC provider. `LOCAL_RPC_URL`, the hard-coded chain 31337, `localChain`, the deployment loader and the proxy's assumptions are local-only and must become configuration; the manifest "chain identity anchor" concept maps to a deployment block on a public chain. Replace MockUSD with a test stablecoin or keep MockUSD clearly labeled; no real funds without an audit.
- Database/storage: managed PostgreSQL with the restricted runtime role, migrations applied by an owner connection in CI, private Storage with backups and retention.
- Operations: rate limiting at the edge, monitoring/alerting, error reporting without secrets, backups, a reviewed deployment pipeline, security audit of contracts and API.
- The local `dev` tooling is intentionally local-only and should not be used in hosting.
