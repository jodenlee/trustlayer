# TrustLayer

**Decentralized Freelance Escrow and Dispute Resolution Protocol**

Implemented today: milestone escrow, juror staking/selection, on-chain arbitration, protocol treasury and fixed juror rewards; wallet/SIWE profiles; PostgreSQL project metadata; and private, receipt-bound Supabase attachments. **Phase 5** adds an approved optional Anvil local backend with verified disk backup/restore, unique chain binding, stable deployment exports, explicit ETH/mUSD provisioning and integration hardening. The redesigned app requires wallet sign-in (SIWE) and shows only real chain and database state. See [Phase 5 operations](docs/PHASE5.md) and the [UI redesign and startup handover](docs/UI_REDESIGN_HANDOVER.md). This protocol is not audited or ready for handling real funds.

## Getting started (Windows PowerShell)

TrustLayer runs on a local Anvil blockchain that is saved to disk between sessions. Use `npm.cmd`/`npx.cmd` in PowerShell.

**Every day, after reopening VS Code** — open a terminal in the repository root and run:

```powershell
npm.cmd run dev
```

It restores the newest saved chain backup (or reuses a chain still running after a crash), verifies the chain identity, contracts and manifest, checks saved project data against the chain (read-only), publishes the deployment to the app, starts Next.js and prints the URL (default http://127.0.0.1:3000). Open it in Chrome, connect MetaMask on the local network (chain 31337) and sign in. It never creates a new chain, redeploys, or overwrites a backup; if anything is ambiguous it stops and tells you what to do.

**To stop** — press **Ctrl+C** in that terminal (if Windows asks "Terminate batch job (Y/N)?" after the backup message, answer Y), or from any other terminal:

```powershell
npm.cmd run dev:stop
```

Both stop the app, wait for pending transactions, save and verify a backup, and stop only processes TrustLayer started. `npm.cmd run dev:status` shows what is running and which backup would be restored.

**After a crash or closing VS Code abruptly** — just run `npm.cmd run dev` again. A still-running chain is reused (no state lost); otherwise the latest checkpoint (saved every minute while the chain changes) is restored. If a previous session left processes behind, `npm.cmd run dev:stop` backs them up and stops them.

**MetaMask transaction stuck "Pending"?** Don't resubmit. Run `npm.cmd run dev:status`; if it reports queued transactions, follow [docs/TRANSACTION_RELIABILITY.md](docs/TRANSACTION_RELIABILITY.md#4-safe-recovery-procedure-metamask-stale-nonce) (usually MetaMask remembers nonces from an earlier local chain).

**First-time setup on a new machine/clone** (creates a new, empty chain):

```powershell
npm.cmd ci
npm.cmd --prefix apps/web ci
npm.cmd run compile
# create apps/web/.env.local from apps/web/.env.example (DATABASE_URL, AUTH_ORIGIN, Supabase keys)
npm.cmd run dev:init -- --name dev1
npm.cmd run dev
```

`dev:init` refuses to run if a deployment manifest already exists unless you add `--archive-current` (which archives it under `.local-chain/archive/`). Set `TRUSTLAYER_CLIENT`, `TRUSTLAYER_FREELANCER` and `TRUSTLAYER_JUROR_1..3` beforehand to fund development wallets (see [Phase 5](docs/PHASE5.md#7-explicit-wallet-provisioning)). Details, recovery and safety rules: [docs/UI_REDESIGN_HANDOVER.md](docs/UI_REDESIGN_HANDOVER.md).

## Requirements

- Node.js **22.13+** (recommended: current 22 LTS)
- npm, Git and VS Code
- MetaMask for the later browser demo

## Contract development (VS Code / PowerShell)

```powershell
npm ci
npm run compile
npm test
```

The dependency lockfile is tracked; use `npm ci` for reproducible installation and `npm install` only for intentional dependency updates. Avoid mixing Hardhat 2 and 3 packages.

For a new recoverable local chain, follow [Phase 5 startup, backup and restoration](docs/PHASE5.md). Keep an existing valuable Hardhat process running until you explicitly decide to start a new chain; its current state cannot be fully exported by the installed Hardhat version.

The historical volatile Hardhat node remains available:

```powershell
npm run node
```

In a **second terminal**, deploy locally:

```powershell
npx.cmd hardhat ignition deploy ignition/modules/Phase2D.ts --network localhost
```

The complete deployment returns local token, treasury, escrow, registry and arbitration addresses with their permissions configured. A plain Hardhat node resets when stopped. Use the managed Anvil workflow for future disk recovery, a bound manifest before live frontend use, and unique Ignition IDs for new chains. Earlier modules remain available for historical phase verification.

## Repo layout

```text
contracts/             core Solidity logic and mock token
ignition/modules/       reproducible deployments
 test/                  integration/security test workspace
apps/web/               Next.js frontend with isolated dependencies and lockfile
web/                    pointer to the current frontend
packages/contracts/     generated ABIs, typed clients and verified local manifest
docs/                   architecture and delivery milestones
supabase/migrations/   versioned private PostgreSQL schema and auth tables
.github/workflows/      CI on every push and PR
```

## Phase 1 contract functions

1. `createProject(freelancer, amounts, dueDates, metadataHash)`
2. `fundProject(projectId)` — requires mUSD allowance
3. `acceptProject(projectId)` — named freelancer only
4. `submitMilestone(projectId, index, evidenceHash)`
5. `approveMilestone(projectId, index)` — client pays freelancer net of 1% service fee
6. `releaseAfterReviewTimeout(projectId, index)` — freelancer after 72 hours
7. `refundMissedMilestone(projectId, index)` — client after 48-hour delivery grace
8. `refundUnaccepted(projectId)` — client after 7-day acceptance expiry

The escrow contract tracks `totalEscrowLiability` to test custody solvency. Only sequential milestones can be settled, and settled milestones cannot pay twice.

## Phase 2A arbitration foundation

The deployer may configure a deployed arbitration contract exactly once using `setArbitrationContract`. Only that contract may freeze the current submitted milestone during its review window and settle it using a 0–10,000-bps freelancer allocation. Normal payouts and refunds cannot settle frozen milestones. Partial freelancer allocations retain the existing 1% service fee, and the client receives the remainder of the milestone amount.

`getDisputeContext` exposes participants, amount, project/milestone states and review deadline. See [Phase 2A design and verification](docs/PHASE2A.md) for initialization, exact deadline and rounding rules, events, tests and trust boundaries. The existing Phase 1 deployment module leaves arbitration unconfigured; test harnesses are not deployed by it.

## Phase 2B juror registry and staking

`JurorRegistry` lets wallets register, deposit mUSD and withdraw their own unlocked stake. New assignments require 100 mUSD unlocked per juror. Only the one-time configured arbitration contract can reserve three distinct jurors and release their locks. Selection rotates deterministically through the eligible pool, excludes the client and freelancer, and fails atomically if fewer than three candidates qualify. It is predictable and does not supply secure randomness or Sybil resistance.

Each assignment locks 100 mUSD per juror until authorized release; additional stake permits concurrent assignments. Read methods expose deposited/locked/available balances, eligible jurors and active/historical assignments. Juror custody stays separate from escrow and treasury funds. See [Phase 2B rules and verification](docs/PHASE2B.md) for exact rotation, staking, finalization and trust boundaries.

For an optional local deployment, use `npx.cmd hardhat ignition deploy ignition/modules/Phase2B.ts --network localhost` with a running Hardhat node. This reuses the Phase 1 module and leaves arbitration unconfigured in both contracts.

## Phase 2C dispute resolution

Either project participant may open a dispute over the current submitted milestone within its review window, paying 15 mUSD from their own approved wallet. Opening atomically collects the fee, freezes the milestone and locks 100 mUSD from each of three selected jurors. The other participant may record one response evidence hash during the first 12 hours.

Voting starts at the 12-hour response deadline and remains open through the following 24-hour voting deadline, both voting boundaries inclusive. After that deadline, anyone may finalize. Two identical juror votes determine freelancer victory, client victory or a 50/50 split. Without two identical votes, including missing votes, the result is the 50/50 fallback. Finalization atomically settles escrow and unlocks juror stakes while preserving the 1% service fee on freelancer payouts.

The historical Phase 2C module retains dispute fees with separate 12/3 accounting and no reward withdrawals. The Phase 2D stack below explicitly enables the approved distribution. See [Phase 2C design and legacy custody](docs/PHASE2C.md) and [Phase 2D deployment/migration](docs/PHASE2D.md).

`ignition/modules/Phase2C.ts` deploys the full local stack and connects both one-time arbitration authorizations. With a running local Hardhat node, use `npx.cmd hardhat ignition deploy ignition/modules/Phase2C.ts --network localhost`. Earlier deployments already configured to another arbitration address require a fresh local deployment.

## Phase 2D protocol treasury and juror rewards

The dedicated ProtocolTreasury receives the unchanged 1% freelancer service fee and exactly 3 mUSD per finalized dispute. It accounts for revenue separately and permits only its owner to withdraw available recognized revenue, with OpenZeppelin two-step ownership transfer.

Finalization reserves 12 mUSD in arbitration for the three assigned jurors, including abstainers: each may claim 4 mUSD exactly once for that finalized case. Rewards are paid only to the claiming juror and remain reserved until claimed. Principal, collateral, protocol revenue and juror rewards stay in separate custody accounts. Failed intake or settlement reverts the entire finalization; a later failed claim does not consume the juror's entitlement.

Use `ignition/modules/Phase2D.ts` for the complete new local stack. It pins the treasury sources, enables arbitration rewards before any dispute and performs both existing arbitration authorizations. Earlier deployed contracts require redeployment; there is no sweep or migration of old retained fees. See [Phase 2D architecture, invariants and verification](docs/PHASE2D.md).

## Phase 2E integration and frontend handoff

`npm.cmd run verify:local` starts and safely stops two dedicated loopback nodes, deploys the actual Phase2D module through Ignition CLI, validates all references and bytecode, and verifies idempotent deployment resume. The public result is `reports/phase2e/verification.json`. It uses port 18545 by default and refuses to reuse an occupied port.

`npm.cmd run export:abis` exports the five production ABIs and complete function/event inventory to `packages/contracts/generated/`. After a persistent local deployment, `npm.cmd run export:contracts` validates and exports its addresses, chain ID, hashes and public authorities. The TypeScript package provides typed Viem/Wagmi configurations and live chain/code validation. The verification-generated manifest is ephemeral and its node is stopped; re-export from your actual persistent node before frontend use.

Phase 2E introduced a 156-test blockchain suite, including normal first-milestone payment followed by all four arbitration outcomes on the second milestone. The later local provisioning task adds 26 tests, bringing that suite to 182 without production Solidity changes. See [Phase 2E workflows, security review and exact export/deployment commands](docs/PHASE2E.md) and the [contract package guide](packages/contracts/README.md). Current frontend and backend work is described below.

## Design decisions

| Setting | Value |
|---|---|
| Test token | mUSD, 6 decimals, no value |
| Project size | 1–5 sequential milestones |
| Acceptance | 7 days |
| Late delivery grace | 48 hours |
| Review time | 72 hours |
| Service fee | 1% of freelancer's gross payment |
| Juror staking | 100 mUSD minimum unlocked for selection; 100 mUSD locked per assignment |
| Arbitration | 3 jurors; 15 mUSD opener-paid fee; 12-hour response then 24-hour voting; 50/50 fallback |
| Phase 2D dispute-fee allocation | 3 mUSD treasury; 12 mUSD reserved for three 4 mUSD juror claims |

## Development workflow

TrustLayer is maintained by one developer with Codex assistance. Follow `AGENTS.md`, use focused changes and review the diff and verification results before committing. Keep credentials, populated environment files, node_modules and cache out of Git. Pushes, merges and public deployments require explicit approval.

Smart-contract verification remains available independently. Phase 3A supplies the interface foundation, Phase 3B adds wallet/deployment verification, Phase 3C integrates escrow and Phase 3D integrates arbitration/staking/rewards. Phase 4A adds PostgreSQL metadata and wallet authentication. Phase 4B integrates persistent project text and private deliverables/case files. Phase 5 adds approved local recovery and integration hardening; stop after Phase 5 for review.

## Frontend

```powershell
npm.cmd --prefix apps/web ci
npm.cmd run web:dev
```

For daily use prefer `npm.cmd run dev` (above). Every application page requires a connected wallet and a SIWE session; visitors are sent to `/sign-in` first. There are no fictional preview views. Verified wallets use real overview/project/dispute/jury/history views and explicitly review protocol transactions. Phase 4B synchronizes descriptive metadata after confirmation when signed in; unsaved drafts remain memory-only. Approval is separate from escrow funding, fee payment or stake deposit. Votes and evidence hashes are public; file bytes stay in private Storage behind authenticated APIs.

For live workflows, start a persistent node on http://127.0.0.1:8545, deploy Phase2D, and export with `TRUSTLAYER_EXPORT_EPHEMERAL=false` using the exact [Phase 3C setup and controlled token-provisioning commands](docs/PHASE3C.md). The checked-in ephemeral verification manifest is intentionally rejected. Dev/build syncs the generated export to ignored public frontend metadata; after re-exporting while the app runs, use `npm.cmd --prefix apps/web run contracts:sync` and Retry verification. No addresses or ABIs are manually copied into page components.

```powershell
npm.cmd run web:lint
npm.cmd run web:typecheck
npm.cmd run web:build
npm.cmd run web:start
```

Run `npm.cmd --prefix apps/web run test:unit` for metadata, precision, authorization/deadline guards and transaction-state tests. Build first, then use `npm.cmd --prefix apps/web exec -- playwright install chromium` followed by `npm.cmd run web:test`. To use installed Chrome, set `$env:PLAYWRIGHT_CHANNEL='chrome'`; set `$env:PLAYWRIGHT_PORT='3001'` to preserve a running port-3000 app. Tests own and stop their separate production server. Frontend dependencies and lockfile live only in `apps/web`; root `compile`, `test`, and `typecheck` still verify the blockchain project. Compile first on a clean checkout to generate artifact type declarations. Run both `npx.cmd hardhat run apps/web/scripts/verify-escrow-workflow.ts` and `npx.cmd hardhat run apps/web/scripts/verify-arbitration-workflow.ts` for real in-process production-contract integration without modifying your running node/export. See [Phase 3D](docs/PHASE3D.md) for current verification, MetaMask walkthrough and limits, [Phase 3C](docs/PHASE3C.md) for escrow/provisioning and [Phase 3B](docs/PHASE3B.md) for wallet setup. Browser tests use test-only providers; actual MetaMask testing is separate.

## Phase 4A backend setup

Next.js route handlers provide durable SIWE sessions, wallet-linked profiles and participant-authorized project metadata APIs using Supabase PostgreSQL. They never override blockchain state. Phase 4B now connects these APIs to creation/details/dashboard and adds private file APIs.

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
# Configure server-only DATABASE_URL, AUTH_ORIGIN and migration-owner URL locally.
npm.cmd --prefix apps/web run db:migrate
npm.cmd run web:dev
```

Apply migrations as database owner, then grant `trustlayer_server` to a dedicated runtime login. Connect MetaMask in Settings, explicitly sign in, and edit the separate wallet-linked profile. Local HTTP sign-in uses `next dev`; production requires HTTPS/Secure cookies. See [Phase 4A](docs/PHASE4A.md) for Supabase/TLS and API contracts, and [Phase 5](docs/PHASE5.md) for the manual runtime-role transition/read-only checker. Automated database tests use isolated PostgreSQL; `npx.cmd hardhat run apps/web/scripts/verify-backend-workflow.ts` also checks metadata authorization against actual production contracts on an isolated EVM.

## Phase 4B metadata and private Storage

See [Phase 4B](docs/PHASE4B.md) for the additive migration, API inventory, private-bucket setup, authorization/retention rules and failure recovery. Preserve the existing populated `.env.local`; never copy the example over working credentials. The user reports hosted Phase 4B migration and private upload/download manually verified. Phase 5 automated verification uses isolated SQL/byte storage and does not mutate hosted data.

```powershell
npm.cmd --prefix apps/web run db:migrate -- --check
npm.cmd --prefix apps/web run db:migrate
npm.cmd run web:dev
```

Sign in separately from wallet connection. Metadata synchronization follows the actual creation receipt; retry an existing project's metadata after backend failure without another chain transaction. Freelancer deliverables and primary opening/response files use SHA-256 exact-byte hashes accepted by the unchanged bytes32 interfaces. Supplemental evidence stays off-chain and closes strictly at the on-chain response deadline. Participants and assigned jurors use authenticated integrity-checked downloads; unrelated wallets are denied. All uploaded objects are retained, including unlinked drafts, to avoid racing pending chain references. No malware scanning or end-to-end encryption is provided.

Run `npx.cmd hardhat run apps/web/scripts/verify-files-workflow.ts` in addition to the three existing EVM verification scripts. It now combines SIWE/profile/metadata/private-file verification with every settlement outcome, using actual contracts and isolated SQL/byte storage. Keep the working database URL until a restricted runtime URI passes `db:runtime:check` and an authenticated smoke test. See [Phase 5](docs/PHASE5.md) for all verification results and remaining manual steps. Stop after Phase 5 for review.

## Limits and security

Run `npm ci`, `npm run compile`, `npm test` and `npm run typecheck` to verify locally; use `npm.cmd` when PowerShell blocks `npm.ps1`. Do not deposit real assets. Configuration is irreversible; frozen milestones and locked juror stakes require a finalization transaction after voting ends. Rewards require individual claims. Old Phase 2C deployments retain fees without a recovery path; use a fresh Phase 2D stack. Review the phase documents, especially `docs/PHASE2D.md` and `docs/PHASE2E.md`, before deployment or configuration; unrestricted test harnesses must never be used on a live deployment.
