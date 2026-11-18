# TrustLayer engineering roadmap

Source of truth: TrustLayer Solution Design Document v1.0 (2026-11-16).

## Phase 1 — repo and escrow vertical slice (completed and verified)
- MockUSD (6 decimals) test token
- TrustEscrow: create, fund, accept, submit, approve, release after review, refund non-delivery, refund unaccepted
- Contract tests for balances, unauthorized calls, deadlines, single settlement, and liability conservation
- Hardhat local deployment

## Phase 2 — advanced protocol
- Phase 2A: escrow interface, one-time arbitration configuration, authorized milestone freezing and basis-point settlement; implemented with tests. See [Phase 2A](PHASE2A.md).
- Phase 2B: JurorRegistry registration, 100 mUSD eligibility and per-assignment locks, deterministic three-juror rotation, conflict exclusions and authorized release; implemented with tests. See [Phase 2B](PHASE2B.md).
- Phase 2C: DisputeArbitration participant opening, 15 mUSD opener-paid fee custody, 12-hour response followed by 24-hour voting, on-chain majority/50-50 fallback and atomic escrow settlement/stake release; implemented with integration tests. See [Phase 2C](PHASE2C.md).
- Phase 2D: ProtocolTreasury receives 1% freelancer service fees and 3 mUSD per finalized dispute; arbitration reserves 12 mUSD for three 4 mUSD pull claims. Revenue accounting, owner withdrawals/two-step ownership and a fresh complete local deployment are implemented with integration tests. See [Phase 2D](PHASE2D.md).
- Phase 2E: all five production contracts verified together, two fresh CLI deployments/resumes validated, complete two-milestone workflows tested for all outcomes, and typed ABI/address exports provided. 156 tests pass; no production Solidity/economic changes. See [Phase 2E](PHASE2E.md). Local frontend development is ready for review, not automatically authorized.
- Remaining protocol work follows and requires separate approval.
- Juror attendance penalties and any associated reward/slashing rules (not included in Phase 2B)
- Earlier modules retain demo-wallet/Phase 2C fee-retention behavior. Phase 2D requires a fresh stack; old retained fees have no migration or sweep path.
- Further security hardening and independent review of cross-contract interactions

## Phase 3 — dApp and evidence
- Phase 3A: responsive Next.js App Router frontend at `apps/web`, shared design system, typed preview models, all workspace routes, draft validation, and an inert contract integration boundary. No wallet/RPC/transaction/backend integration. See [Phase 3A](PHASE3A.md). Stop for review before Phase 3B.
- Next.js/TypeScript/Tailwind + Wagmi/Viem
- Wallet connect, client, freelancer, juror dashboards
- Wallet SIWE server sessions and private evidence storage; SHA-256 content hashes
- Index on-chain events with reorg handling and idempotent processing

## Phase 4 — hardening and demo
- Edge cases, test coverage, manual walkthrough, transaction history
- Demo seed accounts and deterministic local-chain time control
- White-paper claim-to-code review and presentation rehearsal

## Not implemented yet
Juror penalties, migration of old deployed funds, wallet and blockchain frontend integration, SIWE, evidence API, event index, production security audit, and optional Sepolia deployment. Phase 3A implements the frontend foundation only. Fixed Phase 2D juror rewards and the protocol treasury are implemented.
