# TrustLayer

**Decentralized Freelance Escrow and Dispute Resolution Protocol**

Implemented today: milestone escrow, juror staking/selection, on-chain dispute voting and atomic settlement, protocol treasury and fixed juror pull rewards, plus the frontend foundation and **Phase 3B wallet/read integration**. Injected wallets can connect to a verified local deployment and read real mUSD/public protocol state. Project/case views remain clearly labeled samples; project transactions and backend integration are not enabled. Penalties and reputation remain unimplemented. This protocol is not audited or ready for handling real funds.

## Requirements

- Node.js **22.13+** (recommended: current 22 LTS)
- npm, Git and VS Code
- MetaMask for the later browser demo

## Quick start (VS Code / PowerShell)

```powershell
npm ci
npm run compile
npm test
```

The dependency lockfile is tracked; use `npm ci` for reproducible installation and `npm install` only for intentional dependency updates. Avoid mixing Hardhat 2 and 3 packages.

Start a persistent local blockchain:

```powershell
npm run node
```

In a **second terminal**, deploy locally:

```powershell
npx.cmd hardhat ignition deploy ignition/modules/Phase2D.ts --network localhost
```

The complete deployment returns local token, treasury, escrow, registry and arbitration addresses with their permissions configured. The localhost network resets when you stop the node; this is expected. Earlier modules remain available for historical phase verification.

## Repo layout

```text
contracts/             core Solidity logic and mock token
ignition/modules/       reproducible deployments
 test/                  integration/security test workspace
apps/web/               Next.js frontend with isolated dependencies and lockfile
web/                    pointer to the current frontend
packages/contracts/     generated ABIs, typed clients and verified local manifest
docs/                   architecture and delivery milestones
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

The complete blockchain suite has 156 tests, including normal first-milestone payment followed by all four arbitration outcomes on the second milestone. Production Solidity and the earlier 143 tests are unchanged in Phase 2E. See [Phase 2E workflows, security review and exact export/deployment commands](docs/PHASE2E.md) and the [contract package guide](packages/contracts/README.md). Later frontend work is described below; no backend is implemented.

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

Smart-contract verification remains available independently. Phase 3A provides the frontend foundation; Phase 3B adds wallet connection and verified local contract reads. Review Phase 3B before authorizing Phase 3C or transaction workflows. Backend implementation remains deferred.

## Frontend foundation and Phase 3B wallet reads

```powershell
npm.cmd --prefix apps/web ci
npm.cmd run web:dev
```

Open http://127.0.0.1:3000. Navigation/sample views work without a blockchain node or wallet. The light, responsive interface covers the landing page, dashboard, projects/draft creation/details, disputes/details, juror workspace, empty transaction history and session preferences. Preview content is explicitly fictional and drafts are never submitted. Wallet controls now connect MetaMask/compatible injected wallets; live wallet information is labeled separately.

For live reads, start a persistent node on http://127.0.0.1:8545, deploy Phase2D, and export with `TRUSTLAYER_EXPORT_EPHEMERAL=false` using the exact [Phase 3B setup commands](docs/PHASE3B.md). The checked-in ephemeral verification manifest is intentionally rejected. Dev/build syncs the generated export to ignored public frontend metadata; after re-exporting while the app runs, use `npm.cmd --prefix apps/web run contracts:sync` and Retry verification. No addresses or ABIs are manually copied into page components.

```powershell
npm.cmd run web:lint
npm.cmd run web:typecheck
npm.cmd run web:build
npm.cmd run web:start
```

Run `npm.cmd --prefix apps/web run test:unit` for metadata, token precision and transaction-state tests. For browser tests, stop any server on port 3000, build first, then use `npm.cmd --prefix apps/web exec -- playwright install chromium` followed by `npm.cmd run web:test`. To use installed Chrome instead, set `$env:PLAYWRIGHT_CHANNEL='chrome'` before running the tests. Tests own and stop their production server. Frontend dependencies and lockfile live only in `apps/web`; root `compile`, `test`, and `typecheck` still verify the blockchain project. See [Phase 3A](docs/PHASE3A.md) for the design foundation and [Phase 3B](docs/PHASE3B.md) for current results, wallet setup, manual MetaMask steps and limitations. Browser wallet tests use deterministic mocked providers; actual MetaMask interaction is a separate manual check.

## Limits and security

Run `npm ci`, `npm run compile`, `npm test` and `npm run typecheck` to verify locally; use `npm.cmd` when PowerShell blocks `npm.ps1`. Do not deposit real assets. Configuration is irreversible; frozen milestones and locked juror stakes require a finalization transaction after voting ends. Rewards require individual claims. Old Phase 2C deployments retain fees without a recovery path; use a fresh Phase 2D stack. Review the phase documents, especially `docs/PHASE2D.md` and `docs/PHASE2E.md`, before deployment or configuration; unrestricted test harnesses must never be used on a live deployment.
