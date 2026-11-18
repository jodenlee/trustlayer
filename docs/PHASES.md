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
- Remaining protocol work follows and requires separate approval.
- ProtocolTreasury separate contract (currently placeholder treasury wallet)
- Juror attendance penalties and any associated reward/slashing rules (not included in Phase 2B)
- Phase 2D treasury integration and the roadmap's 12 mUSD juror / 3 mUSD protocol fee distribution; Phase 2C tracks portions but retains fees without an outflow path. Resolve the non-upgradeable custody transition before real deployment.
- Further security hardening and independent review of cross-contract interactions

## Phase 3 — dApp and evidence
- Next.js/TypeScript/Tailwind + Wagmi/Viem
- Wallet connect, client, freelancer, juror dashboards
- Wallet SIWE server sessions and private evidence storage; SHA-256 content hashes
- Index on-chain events with reorg handling and idempotent processing

## Phase 4 — hardening and demo
- Edge cases, test coverage, manual walkthrough, transaction history
- Demo seed accounts and deterministic local-chain time control
- White-paper claim-to-code review and presentation rehearsal

## Not implemented yet
Juror penalties and rewards, a real treasury contract, fee distribution/migration, frontend, SIWE, evidence API, event index, production security audit, and optional Sepolia deployment.
