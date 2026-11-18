# Integration test plan

Test runner: Hardhat 3, Node.js test runner + Viem. `TrustEscrow.ts` contains the original Phase 1 tests. `TrustEscrowArbitration.ts` adds Phase 2A authorization, initialization, frozen state, allocation/fee rounding, events, replay, independent-project accounting and Phase 1 timeout/refund regression tests. Run `npm.cmd run compile`, `npm.cmd test` and `npm.cmd run typecheck` (plain `npm` also works when allowed by the shell).

Phase 1 acceptance checklist (broader than the original two tests; not all cases below have automated coverage yet):
1. Create valid 400/600 mUSD project; reject zero, unsorted deadlines and unrecognized freelancer.
2. Funding requires full allowance; escrow balance equals `totalEscrowLiability`.
3. Only nominated freelancer can accept and submit.
4. Approval of 400 mUSD transfers 396 to freelancer and 4 to treasury.
5. Cannot settle same milestone twice or skip to milestone 2.
6. Review-time auto-release is blocked until 72 hours have passed.
7. Missed-delivery refund is blocked until after due date + 48 hours.
8. Unaccepted offer refund works only after 7 days.
9. Escrow balance always >= `totalEscrowLiability`.

These are documented acceptance tests, not an assertion that tests already pass.

See `docs/PHASE2A.md` for the arbitration boundary and test coverage. `contracts/test/ArbitrationHarness.sol` is an unrestricted forwarding harness used only by automated tests; it is not production arbitration and is not referenced by deployment modules.

## Phase 2B registry tests

`JurorRegistry.ts` tests registration, deposits, eligibility thresholds, unlocked withdrawals, one-time arbitration authorization, deterministic three-juror rotation, participant exclusions, shortage rollback, concurrent assignment locks, historical membership, release/replay protection, custody conservation and separation from escrow. Coverage also includes cursor/list changes, a mixed-operation state model, local Ignition module deployment, failed and fee-on-transfer tokens, and reentrancy during staking and assignment calls. See `docs/PHASE2B.md` for the exact rules and integration boundaries.

`contracts/test/JurorArbitrationHarness.sol` and `contracts/test/RegistryTestToken.sol` are automated-test fixtures only. No deployment module references them. The original Phase 1 and Phase 2A test files are preserved.

## Phase 2C arbitration tests

`DisputeArbitration.ts` adds 46 lifecycle/integration tests, bringing the suite to 109 tests without changing the earlier 63. Coverage includes configuration, opener-paid fees, invalid/duplicate cases, exact review/response/voting/finalization boundaries, counterparty response hashes, jury authorization, one immutable ballot per juror, all majority rulings and abstention/fallback cases, repeat-finalization protection, stake unlocking, retained-fee accounting, concurrent projects and sequential milestones.

The integration flow covers funding, acceptance, submission, opening, juror votes, deadline passage, escrow payout and collateral release. Adversarial cases cover insufficient-juror rollback, failed/short fee transfers, reentrancy, failed escrow payouts and rollback of already executed payouts if registry release fails. `contracts/test/DisputeRegistryHarness.sol` is used only to inject that release failure; no deployment module references it. The connected Phase 2C Ignition module is exercised in an ephemeral test network. See `docs/PHASE2C.md` for rules, results and the remaining Phase 2D custody limitation.

## Phase 2D treasury and reward tests

`ProtocolTreasury.ts` adds 34 tests, bringing the suite to 143 while preserving all prior 109 tests unchanged. Tests cover treasury/source/owner authorization, 1% service-fee receipt, exact 3/12 dispute allocation, finalized-only 4 mUSD claims, duplicates, multiple concurrent cases and shared jurors, delayed claims, recognized withdrawal limits, two-step ownership, custody isolation and donations. A complete project-to-reward-claims/treasury-withdrawal integration test checks conservation across every custody account.

The new complete Ignition module is tested on an independent chain starting at block zero. Fault fixtures `TreasuryTestToken.sol` and `TreasuryOwnerHarness.sol` test false/short transfers, failed fee approvals, guarded reward/owner/intake reentrancy and rollback/retry after late treasury-deposit failure. No deployment module references the fixtures. Historical deployment modules retain legacy fee custody for regression verification; use `Phase2D.ts` for the complete treasury/reward stack. See `docs/PHASE2D.md` for invariants, configuration and redeployment requirements.
