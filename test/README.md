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
