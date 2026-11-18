# TrustLayer engineering roadmap

Source of truth: TrustLayer Solution Design Document v1.0 (2026-11-16).

## Phase 1 — repo and escrow vertical slice (started)
- MockUSD (6 decimals) test token
- TrustEscrow: create, fund, accept, submit, approve, release after review, refund non-delivery, refund unaccepted
- Contract tests for balances, unauthorized calls, deadlines, single settlement, and liability conservation
- Hardhat local deployment

## Phase 2 — advanced protocol
- ProtocolTreasury separate contract (currently placeholder treasury wallet)
- JurorRegistry with 100 mUSD stake, 3 distinct jurors, stake locking and attendance penalties
- DisputeArbitration with 15 mUSD fee, 12 juror / 3 protocol, 12-hour response, 24-hour voting, 50/50 fallback
- Authorized arbitration-only escrow freeze and settlement; no public verdict authority
- Security and invariant tests for cross-contract interactions

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
Disputes, jurors, staking, a real treasury contract, frontend, SIWE, evidence API, event index, production security audit, and optional Sepolia deployment.
