# TrustLayer

**Decentralized Freelance Escrow and Dispute Resolution Protocol**

Phase 1 repository starter. Implemented today: local ERC-20 token and an initial milestone escrow smart contract. **Arbitration, staking and the frontend are NOT implemented.** This is not audited or ready for handling real funds.

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

## Design decisions

| Setting | Value |
|---|---|
| Test token | mUSD, 6 decimals, no value |
| Project size | 1–5 sequential milestones |
| Acceptance | 7 days |
| Late delivery grace | 48 hours |
| Review time | 72 hours |
| Service fee | 1% of freelancer's gross payment |
| Arbitration (next phase) | 3 jurors; 15 mUSD dispute fee; 50/50 fallback |

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

This initial implementation has not been compiled or tested in this packaging environment (npm registry unavailable). Run `npm install`, `npm run compile`, and `npm test` on your computer, then report any errors before extending it. Do not deposit real assets. The current contract **does not yet support disputes**, so its approval/release paths should be treated as Phase 1 only.
