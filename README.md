# TrustLayer

**Decentralized Freelance Escrow and Dispute Resolution Protocol**

Implemented today: the Phase 1 local ERC-20 token and milestone escrow, Phase 2A arbitration hooks, Phase 2B juror staking/selection, and Phase 2C dispute creation, on-chain voting, majority/fallback verdicts and atomic settlement. **Treasury integration, penalties, rewards and the frontend are NOT implemented.** This is not audited or ready for handling real funds.

## Requirements

- Node.js **22.13+** (recommended: current 22 LTS)
- npm, Git and VS Code
- MetaMask for the later browser demo

## Quick start (VS Code / PowerShell)

```powershell
npm install
npm run compile
npm test
```

After the first `npm install`, commit the generated `package-lock.json` so the team uses consistent dependency versions. Then change the GitHub Actions install step to `npm ci`. Avoid mixing Hardhat 2 and 3 packages.

Start a persistent local blockchain:

```powershell
npm run node
```

In a **second terminal**, deploy locally:

```powershell
npx hardhat ignition deploy ignition/modules/Phase1.ts --network localhost
```

The deployment prints local token and escrow addresses. The localhost network resets when you stop the node; this is expected.

## Repo layout

```text
contracts/             core Solidity logic and mock token
ignition/modules/       reproducible deployments
 test/                  integration/security test workspace
web/                    reserved for Next.js frontend
packages/contracts/     future generated ABI + address manifest
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

Dispute fees remain in arbitration, with the roadmap's 12 mUSD juror / 3 mUSD protocol portions tracked separately; no rewards or fee withdrawals exist. See [Phase 2C design, tests and custody limitations](docs/PHASE2C.md). The non-upgradeable fee-custody transition requires an explicit Phase 2D design decision before real-value deployment.

`ignition/modules/Phase2C.ts` deploys the full local stack and connects both one-time arbitration authorizations. With a running local Hardhat node, use `npx.cmd hardhat ignition deploy ignition/modules/Phase2C.ts --network localhost`. Earlier deployments already configured to another arbitration address require a fresh local deployment.

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

## GitHub setup

1. On GitHub, create a **private** repository named `trustlayer` with **no README, .gitignore, or license** (already provided here).
2. Extract this starter project to a local folder named `trustlayer`.
3. In VS Code PowerShell:

```powershell
git init
git add .
git commit -m "chore: initialize TrustLayer protocol repository"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/trustlayer.git
git push -u origin main
```

4. GitHub Settings → Collaborators → invite all teammates; use feature branches and pull requests.
5. Before committing additional work, verify that `.env`, private keys, node_modules, and cache are ignored.

## First team assignments

- **M1 Escrow:** finalize tests for `TrustEscrow.sol`; add milestone protection and invariant checks.
- **M3 Arbitration:** draft `DisputeArbitration`, `JurorRegistry`, and restricted arbitration interface; coordinate signatures with M1.
- **M2 Frontend:** design client/freelancer/juror wireframes; implement static Next.js UI after ABI agreement.
- **M4 Integration:** deployment reproducibility, event manifest, SIWE/evidence architecture; automate end-to-end flow.

## Limits and security

Run `npm install`, `npm run compile`, `npm test` and `npm run typecheck` to verify locally; use `npm.cmd` when PowerShell blocks `npm.ps1`. Do not deposit real assets. Arbitration configuration is irreversible; frozen milestones and locked juror stakes require a finalization transaction after voting ends. Dispute fees have no withdrawal path in Phase 2C. Review `docs/PHASE2A.md`, `docs/PHASE2B.md` and `docs/PHASE2C.md` before deployment or configuration; unrestricted test harnesses must never be used on a live deployment.
