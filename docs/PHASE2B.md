# Phase 2B: juror registration and staking

Phase 2B implements `JurorRegistry` and the `IJurorRegistry` integration boundary. It preserves the Phase 1 and Phase 2A contracts, escrow interface, deployment module and tests. There is no DisputeArbitration implementation, voting, fee distribution, attendance penalty, slashing, staking reward, treasury contract or frontend in this phase.

## Design basis and explicit staking rules

The available technical sources are `AGENTS.md`, `README.md`, `docs/PHASES.md` and `docs/PHASE2A.md`. The full Solution Design Document v1.0 referenced by the roadmap is not in the repository. The following rules make the requested foundation explicit and testable without introducing penalties or rewards:

- The immutable staking token is the six-decimal MockUSD token used by the local escrow. Deployment rejects zero addresses, EOAs and tokens reporting a different decimal count. Code and decimals checks do not prove a token is MockUSD; verify its address when deploying.
- `MIN_STAKE` and `STAKE_PER_DISPUTE` are both 100 mUSD (`100_000_000` base units). Each successful assignment locks that amount from each of exactly three jurors.
- Wallets register once using `registerJuror()`. Registration itself transfers no tokens and grants no eligibility. There is no deregistration or deletion of assignment history.
- Registered wallets call `depositStake(amount)` for positive deposits from their own wallet, with ERC-20 allowance. Deposits may build up in amounts below 100 mUSD. The registry credits the exact amount received and rejects fee-on-transfer deposits.
- `depositedStake` means the current deposited balance after withdrawals, not lifetime deposits. `availableStake = depositedStake - lockedStake`.
- `isEligible` means eligible for a **new** assignment: registered with at least 100 mUSD currently unlocked. A juror may remain assigned while ineligible for another assignment.
- More stake permits concurrent assignments, each backed by a separate 100 mUSD lock. For example, 250 mUSD can support two concurrent assignments with 50 mUSD remaining available.
- A juror may withdraw any positive amount up to their available stake with `withdrawStake(amount)`, including reducing their remaining balance below 100 mUSD. Only the caller's balance is debited, and tokens go only to that caller. Locked tokens cannot be withdrawn.
- `releaseJurors(disputeId)` releases all three locks exactly once; it transfers no tokens, imposes no penalty and awards no reward. The authorized arbitration contract is responsible for calling it after finalization, including a fallback outcome.

## Deterministic rotating selection

The eligible pool is a circular doubly linked list, maintained when deposits, withdrawals, locks and unlocks change eligibility. `selectionCursor` identifies the next eligible wallet to consider. Inactive or unstaked registrations are outside this pool, so they do not increase selection gas.

Initially, wallets join in the order they first become eligible. A new or re-eligible wallet joins at the tail immediately before the cursor. Existing eligible wallets keep their relative order. Removing the cursor advances it to the next remaining wallet; an empty pool has a zero cursor. A top-up that leaves an already eligible wallet eligible does not reposition it.

Selection starts at the cursor, skips the client and freelancer, and visits each candidate at most once until three distinct jurors have been found. Both participants must be nonzero and distinct. Successful reservation advances the cursor to the position after the last selected candidate, then removes any selected juror whose remaining unlocked stake is below 100 mUSD. Since only two participants can be excluded, selection examines at most five eligible candidates. The locks and assignment record are written atomically, with no token transfers.

Fewer than three eligible candidates after exclusions causes `InsufficientEligibleJurors`. Failure leaves the cursor, locks, assignment history and active dispute sets unchanged. No manual assignment entry point permits choosing a caller-supplied jury.

This mechanism is predictable rotation, **not cryptographically secure randomness**. Registration, top-ups, withdrawals and transaction ordering can affect future selection; multiple funded wallets can belong to one person. It does not supply Sybil resistance or prevent collusion. The implementation follows the requested rotating selection model without claiming those properties.

## Integration and authorization

The future arbitration contract calls:

```solidity
address[3] memory jurors = registry.reserveJurors(disputeId, client, freelancer);
// After the dispute is finalized:
registry.releaseJurors(disputeId);
```

Only the configured arbitration contract may reserve or release locks. A dispute has a single lifecycle: `NONE -> ACTIVE -> RELEASED`. Dispute ID zero is valid. A successful reservation permanently consumes the ID, even after release; it can never be reassigned with the same or different parties. Each assignment records the parties and the three jurors. Historical membership is retained while active dispute IDs are removed on release.

The registry does not read escrow state or decide whether a case is finalized. Future arbitration must use the Phase 2A dispute context to supply the true client/freelancer, allocate globally unique dispute IDs, enforce eligibility and finalization rules, and coordinate escrow freezing and reservation atomically. In particular, a shortage of jurors must not strand a separately frozen milestone. The existing escrow interface is unchanged.

Configuration follows Phase 2A: the immutable constructor caller is `arbitrationConfigurator`, which may call `setArbitrationContract(address)` exactly once. Zero addresses, EOAs, the registry itself and addresses without deployed code are rejected. A failed attempt does not consume configuration. No account can replace or reset a successful configuration.

The code check does not verify the arbitration interface, correct registry binding, correct participants or finalization behavior. Verify the reviewed implementation before configuration. An upgradeable proxy's behavior could change at the same address. There is no administrator withdrawal or force-unlock escape hatch. Locked stakes depend on arbitration liveness; unlocked withdrawals remain available without arbitration configuration.

## Read methods and events

- `jurors(address)` and `getJurorInfo(address)` expose registration, current deposited and locked stake. The latter also returns available stake and active assignment count.
- `availableStake(address)` and `isEligible(address)` provide balance and new-assignment eligibility checks.
- `registeredJurors(index)` and `registeredJurorCount()` enumerate registered wallets.
- `getAvailableJurors()` returns all eligible wallets in current rotation order before excluding any dispute participants. `availableJurorCount` and `selectionCursor` provide pool metadata.
- `previewJurors(client, freelancer)` returns the next three candidates without changing state. Its result is a snapshot; intervening transactions can change selection.
- `getActiveDisputes(address)` returns active dispute IDs; ordering is not guaranteed.
- `getAssignment(disputeId)` returns the parties, fixed three-juror array and lifecycle state. Unknown IDs return state NONE with zero fields.
- `isAssigned(disputeId, address)` reports historical membership, including released assignments. Check `getAssignment(...).state` to distinguish active from released membership.

`getAvailableJurors` and `getActiveDisputes` return full lists and are intended for off-chain reads; their memory/gas usage grows with the returned list. Core reservation and release do not enumerate registration history or all active cases.

Events: `JurorRegistered`, `StakeDeposited`, `StakeWithdrawn`, `JurorAssigned`, `StakeLocked`, `StakeUnlocked`, `AssignmentReleased` and `ArbitrationContractConfigured`. Each reservation emits an assignment and lock event for each selected juror; each release emits three unlock events and one release event.

## Custody invariants and token handling

```text
juror.depositedStake = juror.availableStake + juror.lockedStake
juror.lockedStake = 100 mUSD * juror.activeAssignments
totalStaked = sum(juror.depositedStake)
totalLockedStake = sum(juror.lockedStake)
registry token balance >= totalStaked
```

Juror stakes are held in the registry, independently of escrow custody and the existing treasury wallet. Reservation and release do not change deposited balances or `totalStaked`. Donations create surplus, confer no stake or eligibility, and cannot be withdrawn through another juror's balance. No sweep or administrator withdrawal exists.

Stake deposits and withdrawals use SafeERC20 and checks-effects-interactions, with transaction rollback on transfer failure. All mutating registry entry points use reentrancy protection, including authorization-restricted assignment methods. The exact incoming balance delta prevents fee-on-transfer deposits from creating unbacked liabilities even when surplus exists. The supported production token for this local phase is the existing standard MockUSD; arbitrary rebasing or mutable token implementations are not supported.

## Local deployment and verification

`ignition/modules/Phase2B.ts` reuses the existing Phase 1 module, deploys the registry with the same MockUSD address and returns `token`, `escrow` and `registry`. Both escrow and registry remain unconfigured for arbitration until a reviewed arbitration contract exists.

```powershell
npm.cmd run compile
npm.cmd test
npm.cmd run typecheck

# Optional local deployment with a running Hardhat node:
npx.cmd hardhat ignition deploy ignition/modules/Phase2B.ts --network localhost
```

`test/JurorRegistry.ts` covers registration, eligibility thresholds, stake management, initializer authorization, deterministic rotation, exclusions, shortage rollback, duplicate/replayed assignments, concurrent locks, independent release, cursor changes, surplus handling and custody separation from escrow. It also tests the local deployment module, failed/short token transfers and reentrant token callbacks, and compares mixed operations against a separate rotation/accounting model. The original Phase 1 and Phase 2A test files remain unchanged.

`contracts/test/JurorArbitrationHarness.sol` and `contracts/test/RegistryTestToken.sol` are unrestricted test fixtures. Deployment modules never reference them; neither supplies production arbitration logic. Do not configure a harness as arbitration outside automated tests.

Phase 2B is a local verification foundation, not an audited production deployment. Penalties, rewards, dispute decisions and further integration require a separately authorized development task.
