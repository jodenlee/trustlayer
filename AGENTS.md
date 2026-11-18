# TrustLayer development rules

## Project identity

- TrustLayer is a blockchain-based freelance escrow and decentralized dispute resolution protocol.
- The project is being implemented by one developer with Codex assistance.
- Treat the existing source code and approved technical design as authoritative.
- Preserve the Phase 1 implementation unless a change is required and justified.

## Development stack

- Solidity 0.8.x and Hardhat 3 for blockchain contracts.
- OpenZeppelin for established contract security and token components.
- Next.js, TypeScript, Tailwind CSS, Wagmi and Viem for the frontend.
- Supabase/PostgreSQL for off-chain metadata and private evidence storage.
- EVM-compatible local blockchain first, with Sepolia as a later deployment target.

## Development standards

1. Inspect relevant files before editing.
2. Make focused, incremental changes.
3. Never remove existing functionality merely to make tests pass.
4. Follow the repository's existing Solidity and Hardhat conventions.
5. Preserve backward compatibility where practical.
6. Use role-based authorization, explicit state transitions and safe token transfers.
7. Prevent double settlement, unauthorized withdrawals and fund-accounting inconsistencies.
8. Do not place confidential freelance deliverables or personal information on-chain.
9. Add or update automated tests for every substantive behavior change.
10. Run compilation, tests and relevant quality checks after implementation.
11. Do not claim tests passed unless they actually executed.
12. Do not silently change protocol economics or arbitration rules.
13. Keep documentation synchronized with the implementation.
14. Never commit credentials, private keys, wallet seed phrases or populated .env files.
15. Do not push, merge or deploy to a public network without explicit approval.
16. Do not modify Solidity compiler versions or upgrade major dependencies without explaining the need.

## Protocol baseline

- Payment token: MockUSD (mUSD), six decimals.
- Service fee: 1% of freelancer payouts.
- Dispute fee: 15 mUSD.
- Juror minimum stake: 100 mUSD.
- Three jurors per dispute.
- Majority-based dispute resolution.
- A 50/50 fallback where the documented voting conditions cannot produce a valid majority.
- Escrow funds, juror stakes and treasury funds must remain separately accounted for.
- Arbitrated milestone funds must never be paid twice.
- Use explicit and testable rules for all deadlines, timeouts, refunds and rewards.

## Repository context

- `contracts/MockUSD.sol` and `contracts/TrustEscrow.sol` contain the Phase 1 token and milestone escrow. The current compiler configuration is Solidity 0.8.28.
- Contract tooling uses Hardhat 3, TypeScript ES modules, the Node.js test runner and Viem. Existing executable tests are in `test/TrustEscrow.ts`; `test/README.md` lists additional acceptance tests, not passing-test claims.
- `ignition/modules/Phase1.ts` deploys the token and escrow locally. Phase 1 uses the deployer wallet as treasury; a separate treasury contract is planned.
- `README.md` describes the current implementation. `docs/PHASES.md` records the roadmap and references the approved TrustLayer Solution Design Document v1.0 (2026-11-16).
- Phase 2A adds the `ITrustEscrowArbitration` boundary, one-time arbitration configuration, authorized freezing and disputed settlement; see `docs/PHASE2A.md`. Phase 2B adds `JurorRegistry` and `IJurorRegistry`, with 100 mUSD eligibility/per-assignment locks, deterministic three-juror rotation, participant exclusions and authorized release; see `docs/PHASE2B.md`. Arbitration decision logic, juror penalties/rewards, a dedicated treasury contract, the frontend and private evidence storage are not implemented. `web/` currently contains frontend setup guidance only. The stack and protocol baseline above govern future development and do not imply those features already exist.
- Preserve the existing Phase 1 rules: 1-5 sequential milestones, a 7-day acceptance window, a 48-hour delivery grace period, a 72-hour review window, a 1% fee on the freelancer's gross payout and explicit escrow-liability tracking.
- Available verification commands are `npm run compile`, `npm test` and `npm run typecheck`. Inspect `package.json`, `hardhat.config.ts` and `.github/workflows/contracts.yml` before changing tooling or verification workflows.

## Completion criteria

For every task, summarize:

- Files created or changed.
- Functions and features implemented.
- Commands executed.
- Test results.
- Any failures, limitations or unresolved decisions.
- The suggested next development step.
