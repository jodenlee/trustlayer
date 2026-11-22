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
- Phase 2D adds ProtocolTreasury, fee-intake/reward interfaces, recognized revenue accounting, owner withdrawals and assigned-juror pull claims; see `docs/PHASE2D.md`. New treasury/source bindings are one-time and reward mode must be enabled before the first dispute. Earlier modules preserve fee-retention behavior, existing tests must remain intact, and old deployed fees cannot be swept or retroactively migrated. Redeploy a fresh local stack for Phase 2D. Penalties and reputation remain unimplemented; private evidence storage is added in Phase 4B. The frontend foundation and Phase 3B wallet/read integration live at `apps/web`.
- Phase 2E provides complete deployed-protocol tests, `npm run verify:local` for two fresh CLI deployments/idempotent resumes, and `packages/contracts` typed production ABI/address exports. See `docs/PHASE2E.md`. Regenerate ABIs after Solidity changes, validate live runtime/block identity before frontend use, and re-export addresses after resetting/redeploying a local chain. Verification manifests are ephemeral and their nodes are stopped.
- Phase 3A implements only the interface foundation at `apps/web`; see `docs/PHASE3A.md`. Its separate package/lockfile must not alter root Hardhat dependencies. Use `npm run web:dev`, `web:lint`, `web:typecheck`, `web:build` and `web:test`. Run Hardhat compilation and tests sequentially because both write artifacts/cache.
- Phase 3B adds injected Wagmi/Viem wallet connection, explicit local-network switching, deployment-gated token/public contract reads and generic signing/receipt utilities; see `docs/PHASE3B.md`. The generated deployment source is mirrored to ignored frontend public metadata before dev/build. Require a fresh non-ephemeral port-8545 export and validate block/runtime identity against both RPC and wallet before reads; revalidate before future writes. Never trust chain ID alone or alter generated metadata to bypass setup failures.
- Phase 3C integrates connected-wallet project discovery, creation, exact ERC-20 approval, separate funding, freelancer acceptance/hash submission, client approval and authorized timeout release; see `docs/PHASE3C.md`. Project IDs are zero-based uint256 bigint values, milestone indices are zero-based, acceptance starts at creation, and timeout release is strictly after the review deadline. Preserve the unchanged contract rules and generated ABIs. Review dialogs bind to the acting wallet and verified deployment; revalidate identity and fresh state before writes. Preserve session duplicate protection and uncertain receipt handling across navigation.
- Phase 3D adds participant dispute opening, one counterparty response hash, public assigned-juror voting, permissionless finalization, juror registration/stake management and per-case reward claims; see `docs/PHASE3D.md`. Numeric dispute IDs are zero-based bigint values. Opening pays 15 mUSD from the opener after a separate exact allowance; response requires timestamp < responseDeadline, voting permits responseDeadline <= timestamp <= votingDeadline, and finalization requires timestamp > votingDeadline. Display the stored on-chain ruling and fallback marker; never supply or invent a verdict. Released case locks do not imply a juror has no other locked collateral. All assigned jurors, including abstainers, may claim 4 mUSD once per finalized case through arbitration.
- Phase 3D review/receipt tracking lives in an app-level provider so query refreshes and action-row removal cannot destroy it. Non-sensitive response/opening hash inputs and stake amounts stay in memory under the acting wallet/deployment. Preserve fresh state checks, reviewed milestone indices, one unresolved request per wallet/chain and unknown-confirmation locks. Discover cases in bounded ID pages, including historical assignments/rewards; do not replace this with unbounded full-list registry reads. Event history uses bounded block pages and distinguishes wallet activity from related case/project events.
- Preview data must remain explicitly fictional and separate from live contract reads. Never fabricate real balances, transaction hashes, confirmations or dispute outcomes. Keep six-decimal token amounts as bigint. Unsaved project drafts and client transaction records remain memory-only; bounded on-chain history is separate and loaded-page totals are not protocol-wide totals. Phase 4B synchronizes confirmed project metadata and supports private files; unconfirmed drafts are not persisted. Refund/treasury administration UI and later phases remain deferred. Import generated ABIs from `@trustlayer/contracts`; do not duplicate them. Frontend verification includes `npm --prefix apps/web run test:unit`, test-provider browser regressions and both `npx hardhat run apps/web/scripts/verify-escrow-workflow.ts` and `npx hardhat run apps/web/scripts/verify-arbitration-workflow.ts` against actual in-process production contracts. Use PLAYWRIGHT_PORT=3001 to preserve a running port-3000 app. Do not claim actual MetaMask testing unless executed. Compile before frontend checking on a clean checkout to generate artifact type declarations. Keep Hardhat operations sequential.
- Phase 4A provides Next.js Node route handlers, private PostgreSQL schema/migrations, EOA SIWE with durable single-use nonces and opaque database sessions, own-profile editing and project metadata APIs; see `docs/PHASE4A.md`. Custom wallet cookies do not authenticate Supabase RLS. Keep the `trustlayer` schema unexposed to browser roles. Never store financial authority in metadata. Revalidate the active generated manifest's chain, anchored block and runtimes plus live contract participants for every metadata/file access; scope identifiers to the deployment anchor as well as chain/address/ID. Keep the existing privileged local `DATABASE_URL` working; a dedicated runtime login granted `trustlayer_server` remains Phase 5 hardening.
- Phase 4A/4B database/API tests use all real SQL migrations in isolated PGlite under the server role; no hosted connectivity may be claimed unless executed. `npm --prefix apps/web run db:migrate` applies checksummed additive migrations with an owner connection; never reset a shared/live database or edit an applied migration. Wallet connection stays separate from sign-in; clear/hide stale account sessions, require exact Origin on writes, and retain HttpOnly/SameSite cookies with Secure/HTTPS in production. Local chain persistence/recovery and final hardening remain deferred to Phase 5.
- Phase 4B integrates persistent participant project/milestone text after receipt-confirmed creation, with independent idempotent synchronization/recovery and revision checks; see `docs/PHASE4B.md`. Never resend a confirmed chain action to repair metadata or file associations. Private Supabase Storage is server-mediated through SIWE-authenticated APIs and fresh live role/deployment checks; do not expose privileged keys or public object URLs. Files use exact-byte SHA-256 bytes32 hashes; preserve the existing Keccak-256 project metadata commitment. Primary file associations require matching canonical receipts/events. Supplemental case evidence is off-chain, append-only strictly before the on-chain response deadline; assigned case jurors and participants retain read access after closure. Retain uploaded objects, including unlinked drafts, to avoid racing pending chain references; only empty failed reservations may be tombstoned. No malware scanning or end-to-end encryption is implemented. Run `verify-backend-workflow.ts` and `verify-files-workflow.ts` through Hardhat in addition to the existing escrow/arbitration scripts. Stop after Phase 4B for review; do not proceed to Phase 5 automatically.
- Preserve the existing Phase 1 rules: 1-5 sequential milestones, a 7-day acceptance window, a 48-hour delivery grace period, a 72-hour review window, a 1% fee on the freelancer's gross payout and explicit escrow-liability tracking.
- Available verification commands are `npm run compile`, `npm test` and `npm run typecheck`. Inspect `package.json`, `hardhat.config.ts` and `.github/workflows/contracts.yml` before changing tooling or verification workflows.

- Phase 5 adds the optional approved Anvil 1.7.1 backend through `npm run chain -- fresh|restore|backup|status --name ...`; see `docs/PHASE5.md`. Hardhat 3.22.0 remains the compiler/test/deployment tooling and cannot fully dump/import its existing volatile chain. Never claim snapshot IDs survive restart or migrate/reset a running node automatically. Managed chains use random on-chain identity anchors, exclusive immutable checksummed/versioned backups and explicit restore; keep `.local-chain/` ignored. Back up before stopping and never overwrite a valid backup or manifest.
- Live frontend/backend exports require a managed chain anchor or legacy Hardhat process-instance binding. Preserve the original `verifiedBlock` across re-exports so PostgreSQL metadata/evidence scope does not change. Upgrade legacy exports explicitly using an archived original anchor; never rebind historical records to a new chain. `verify:local` now uses separate output manifests, and `verify:persistence` owns disposable Anvil port 18546. Retain cached same-actor read-only views during background verification while pausing writes; failures/account changes must hide stale data. Backend authorization must use uncached block numbers after receipt-confirmed actions.
- `npm run provision:wallets` tops up five explicit local addresses with native ETH and existing fixed-supply mUSD. Validate exact loopback endpoint/31337/deployment/recipients and receipts; never accept private keys or mint new supply. Hosted runtime-role separation remains an operator step; `npm --prefix apps/web run db:runtime:check` checks the configured candidate read-only without exposing credentials. Preserve working configuration until verified. Stop after Phase 5 for review; no subsequent phase or public deployment is authorized. The UI redesign/startup stage is complete pending review; still no public deployment.

- UI redesign and daily startup (after Phase 5) are recorded in `docs/UI_REDESIGN_HANDOVER.md`. The app at `apps/web` is fully wallet-gated: `src/proxy.ts` redirects cookie-less visitors to `/sign-in` (optimistic only), `components/auth-gate.tsx` renders protected pages only for a server-confirmed SIWE session matching the connected wallet/chain, and every private API still authorizes independently. Never treat a cookie, a visible address or client state as authentication, and never auto-request signatures on page load. `AuthProvider.checking` stays true until wagmi's first reconnect cycle settles; preserve that to avoid premature redirects. The fictional preview layer was removed; never reintroduce sample data. Design tokens live in `src/app/globals.css` ("calm ledger": warm paper, white panels, ink text, evergreen `--brand`); reuse `components/ui.tsx` primitives (`Notice`, `Disclosure`, `KeyValue`, `Hash`, `StatusBadge`) and keep technical details in disclosures. Browser specs sign in through `tests/auth-fixture.ts`.
- Daily local workflow: `npm run dev` / `dev:stop` / `dev:status` / `dev:init` (`scripts/dev.ts`, `scripts/lib/dev-plan.ts`, `scripts/lib/dev-process.ts`, `apps/web/scripts/dev-consistency.ts`). It wraps the Phase 5 controller functions; it must never create a fresh chain during `dev`, redeploy, overwrite backups/manifests, write to PostgreSQL, or stop a process whose ownership it cannot verify (port owner PID + Anvil binary path + chain identity). Ambiguous backups (forked history) and PostgreSQL records ahead of the restored chain stop startup. Unit tests: `test/DevStartup.ts`.

- Transaction reliability (`docs/TRANSACTION_RELIABILITY.md`): writes are refused while the node's pool holds a pending/queued transaction for the wallet (`lib/blockchain/pool.ts`); nonce-gapped submissions are reported as stuck, never as failed or confirmed. Never clear the mempool automatically; `npm run dev:drop-queued -- --hash …` is an explicit operator step (Anvil 1.7.1 ignores `anvil_dropTransaction` for queued entries). Recover delayed creations from the original receipt; never resend a confirmed action. Verify with `npm run verify:nonce` (disposable Anvil, port 18547).

## Completion criteria

For every task, summarize:

- Files created or changed.
- Functions and features implemented.
- Commands executed.
- Test results.
- Any failures, limitations or unresolved decisions.
- The suggested next development step.
