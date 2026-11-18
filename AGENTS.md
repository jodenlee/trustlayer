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
- Phase 2D allocation after finalization: 3 mUSD treasury and 12 mUSD reserved for three assigned jurors' 4 mUSD claims; no vote-based penalties.
- Juror minimum stake: 100 mUSD.
- Three jurors per dispute.
- Majority-based dispute resolution.
- A 50/50 fallback where the documented voting conditions cannot produce a valid majority.
- Escrow funds, juror stakes and treasury funds must remain separately accounted for.
- Juror reward reserves must remain separately accounted for and cannot be funded from escrow principal or staking collateral.
- Arbitrated milestone funds must never be paid twice.
- Use explicit and testable rules for all deadlines, timeouts, refunds and rewards.

## Repository context

- `contracts/MockUSD.sol` and `contracts/TrustEscrow.sol` contain the Phase 1 token and milestone escrow. The current compiler configuration is Solidity 0.8.28.
- Contract tooling uses Hardhat 3, TypeScript ES modules, the Node.js test runner and Viem. Existing executable tests are in `test/TrustEscrow.ts`; `test/README.md` lists additional acceptance tests, not passing-test claims.
- `ignition/modules/Phase1.ts` retains the historical demo-wallet treasury deployment. Use `ignition/modules/Phase2D.ts` for the complete new local stack with ProtocolTreasury and configured fee/reward permissions.
- `README.md` describes the current implementation. `docs/PHASES.md` records the roadmap and references the approved TrustLayer Solution Design Document v1.0 (2026-11-16).
- Phase 2A provides the unchanged `ITrustEscrowArbitration` boundary, one-time arbitration configuration, freezing and disputed settlement; see `docs/PHASE2A.md`. Phase 2B provides `JurorRegistry`/`IJurorRegistry`, 100 mUSD eligibility/per-assignment locks, deterministic three-juror rotation, participant exclusions and release; see `docs/PHASE2B.md`.
- Phase 2C provides `DisputeArbitration`/`IDisputeArbitration`: the opener pays 15 mUSD, a 12-hour response window precedes 24-hour voting, and permissionless finalization applies the two-vote majority or 50/50 fallback and settles escrow/unlocks stakes; see `docs/PHASE2C.md`.
- Phase 2D adds ProtocolTreasury, fee-intake/reward interfaces, recognized revenue accounting, owner withdrawals and assigned-juror pull claims; see `docs/PHASE2D.md`. New treasury/source bindings are one-time and reward mode must be enabled before the first dispute. Earlier modules preserve fee-retention behavior, existing tests must remain intact, and old deployed fees cannot be swept or retroactively migrated. Redeploy a fresh local stack for Phase 2D. Penalties, reputation and private evidence storage remain unimplemented. The frontend foundation and Phase 3B wallet/read integration live at `apps/web`.
- Phase 2E provides complete deployed-protocol tests, `npm run verify:local` for two fresh CLI deployments/idempotent resumes, and `packages/contracts` typed production ABI/address exports. See `docs/PHASE2E.md`. Regenerate ABIs after Solidity changes, validate live runtime/block identity before frontend use, and re-export addresses after resetting/redeploying a local chain. Verification manifests are ephemeral and their nodes are stopped.
- Phase 3A implements only the interface foundation at `apps/web`; see `docs/PHASE3A.md`. Its separate package/lockfile must not alter root Hardhat dependencies. Use `npm run web:dev`, `web:lint`, `web:typecheck`, `web:build` and `web:test`. Run Hardhat compilation and tests sequentially because both write artifacts/cache.
- Phase 3B adds injected Wagmi/Viem wallet connection, explicit local-network switching, deployment-gated token/public contract reads and generic signing/receipt utilities; see `docs/PHASE3B.md`. The generated deployment source is mirrored to ignored frontend public metadata before dev/build. Require a fresh non-ephemeral port-8545 export and validate block/runtime identity against both RPC and wallet before reads; revalidate before future writes. Never trust chain ID alone or alter generated metadata to bypass setup failures.
- Phase 3C integrates connected-wallet project discovery, creation, exact ERC-20 approval, separate funding, freelancer acceptance/hash submission, client approval and authorized timeout release; see `docs/PHASE3C.md`. Project IDs are zero-based uint256 bigint values, milestone indices are zero-based, acceptance starts at creation, and timeout release is strictly after the review deadline. Preserve the unchanged contract rules and generated ABIs. Review dialogs bind to the acting wallet and verified deployment; revalidate identity and fresh state before writes. Preserve session duplicate protection and uncertain receipt handling across navigation.
- Preview data must remain explicitly fictional and separate from live contract reads. Never fabricate real balances, transaction hashes, confirmations or dispute outcomes. Keep six-decimal token amounts as bigint. Phase 3C metadata and client transaction records are memory-only; bounded on-chain history is separate and loaded-project totals are not protocol-wide totals. No backend/evidence storage is implemented. Dispute, staking, voting, rewards and treasury UI remain deferred. Do not proceed to Phase 3D without approval. Import generated ABIs from `@trustlayer/contracts`; do not duplicate them. Preserve on-chain authorization/time boundaries. Frontend verification includes `npm --prefix apps/web run test:unit`, browser tests with a deterministic test-only EIP-1193 provider and `npx hardhat run apps/web/scripts/verify-escrow-workflow.ts` against actual in-process production contracts; do not claim actual MetaMask testing unless executed. Compile before frontend checking on a clean checkout to generate artifact type declarations.
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
