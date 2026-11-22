# Phase 2D: protocol treasury and juror reward distribution

Phase 2D adds `ProtocolTreasury`, authorized fee intake from escrow and arbitration, and fixed pull-payment rewards for assigned jurors. It preserves the existing 1% freelancer fee, 15 mUSD opener-paid dispute fee, juror staking, deterministic selection, deadlines, majority rule and fallback behavior. No frontend, backend, reputation, appeals, slashing, governance token or public deployment is included.

## Architecture and fee destinations

The supported token remains MockUSD with six decimals. There are four separate custody accounts:

| Contract | Funds held | Authorized outflow |
|---|---|---|
| TrustEscrow | Project principal backing escrow liabilities | Existing client refunds, freelancer payouts and computed service fees |
| JurorRegistry | Juror deposited and locked collateral | Juror's own unlocked withdrawals |
| DisputeArbitration | Pending dispute fees and reserved juror rewards | Exactly 3 mUSD per finalized dispute to treasury; one 4 mUSD reward per assigned juror |
| ProtocolTreasury | Recognized protocol revenue | Owner-authorized withdrawals of recognized available revenue |

Service fees use the unchanged formula: `floor(freelancerGross * 100 / 10,000)`. The client refund is excluded. Treasury receives the service fee once per settled project/milestone; no deposit occurs for a zero service fee.

Every successful dispute opening collects 15 mUSD from its opener, initially keeping 12 mUSD pending for jurors and 3 mUSD pending for the protocol. Successful finalization reserves the 12 mUSD reward portion and deposits exactly 3 mUSD into treasury. The three assigned jurors can then claim exactly 4 mUSD each, once per dispute. All assigned jurors qualify, including abstainers and jurors in fallback cases. There is no vote-based reward adjustment, penalty or slashing.

For a 400 mUSD disputed milestone:

| Ruling | Client refund | Freelancer net | Service revenue | Dispute revenue | Juror rewards |
|---|---|---|---|---|---|
| Freelancer wins | 0 | 396 | 4 | 3 | 4 to each of three jurors |
| Client wins | 400 | 0 | 0 | 3 | 4 to each of three jurors |
| Split or fallback | 200 | 198 | 2 | 3 | 4 to each of three jurors |

All values in this table are mUSD. The 15 mUSD dispute fee is separate from milestone principal.

## Treasury contract and interface

`ProtocolTreasury(token, initialOwner)` requires a deployed six-decimal token and a nonzero owner. It uses OpenZeppelin `Ownable2Step`, `SafeERC20`, `ReentrancyGuard`, and ERC-165 interface detection. `IProtocolTreasury` defines the intake boundary and the bound token/escrow/arbitration getters.

- `configureSources(escrow, arbitration)`: owner-only and usable exactly once. Both sources must be contracts using the same token. Escrow must already designate this treasury and support its intake path; arbitration must point to that escrow. Subsequent ownership transfer does not permit changing sources.
- `depositServiceFee(projectId, milestoneIndex, amount)`: only the pinned escrow may call it. A positive fee can be received once per project/milestone. It pulls exactly the computed fee from escrow, updates service-fee revenue and emits `ServiceFeeDeposited`.
- `depositDisputeFee(disputeId)`: only the pinned arbitration contract may call it. It also verifies the case is FINALIZED and rejects duplicate intake. It pulls exactly 3 mUSD, updates dispute revenue and emits `DisputeFeeDeposited`.
- `withdraw(recipient, amount)`: only the current owner may withdraw a positive amount up to `availableRevenue`. Zero/self recipients are rejected. Effects precede SafeERC20 transfer, and exact sender/recipient balance checks reject short payments. Successful withdrawal emits `TreasuryWithdrawal`; failure restores all accounting.
- `totalRevenueReceived()`: cumulative service plus protocol dispute revenue.
- `totalServiceFeesReceived`, `totalDisputeFeesReceived`, `availableRevenue`, `totalWithdrawn`, `serviceFeeReceived` and `disputeFeeReceived` expose accounting and replay guards.
- Inherited `transferOwnership`, `pendingOwner`, and `acceptOwnership` implement two-step transfer. `OwnershipTransferStarted` and `OwnershipTransferred` provide the ownership events. The pending owner has no withdrawal authority until acceptance.

Fee sources approve only the amount for the current deposit. Treasury pulls that amount through SafeERC20, verifying the exact source debit and treasury credit. Standard MockUSD consumes the allowance completely; tests assert both source allowances return to zero. Treasury has no blanket approval over principal, pending rewards or collateral.

Only recognized fee revenue is withdrawable. Direct token donations are unrecognized surplus, do not increase revenue counters, and have no sweep mechanism. Treasury owner authorization does not confer access to juror rewards, escrow principal or registry collateral.

## Escrow integration and compatibility

The escrow constructor still takes `(token, treasury)`. It detects `IProtocolTreasury` through OpenZeppelin ERC165Checker and verifies token equality. `usesProtocolTreasury` is immutable. With this flag enabled, a positive service fee is approved and deposited through the treasury intake method as part of the existing settlement transaction. Failure rolls back the entire settlement, including client/freelancer transfers and liability changes.

A legacy wallet or treasury without that interface retains the original direct-transfer path. Existing Phase 1/2A method signatures, enum values, fee formula and arbitration interface remain unchanged. The Phase 2D module explicitly uses the dedicated treasury; earlier modules retain their original behavior for compatibility and regression verification.

## Arbitration configuration and pull rewards

`setProtocolTreasury(treasury)` is an explicit, one-time Phase 2D opt-in. Only the immutable arbitration constructor caller, `treasuryConfigurator`, may call it, and only before the first dispute. The treasury must implement the intake interface, use the same token, pin this arbitration and escrow, and be the escrow's immutable treasury. It cannot be replaced or reset.

When escrow uses the Phase 2D treasury interface, `isConfigured()` remains false until this binding and both existing arbitration authorizations are complete. An incomplete setup cannot collect a dispute fee or freeze a milestone. The existing escrow and registry one-time arbitration setters are unchanged.

Finalization keeps the existing on-chain verdict calculation and strictly-after-voting-deadline rule. It records final state, moves 12 mUSD from pending fees to reward reservations, records the 3 mUSD protocol outflow, settles escrow, releases registry locks and deposits the protocol fee. All state changes, approvals, transfers and logs are atomic. If treasury intake fails after escrow settlement and stake unlocking, the entire transaction reverts and can be retried.

`IJurorRewards` exposes:

- `claimableReward(disputeId, juror)`: returns 4 mUSD only for an assigned, unclaimed juror on a finalized case with a reward reservation; otherwise zero.
- `claimJurorReward(disputeId)`: pays only the caller's reward to the caller. There is no beneficiary parameter or administrator claim/sweep path. The per-case/caller claim flag, per-case claimed total and global outstanding reserve are updated before transfer. Failed or short transfers restore the claim and every counter. Reentrancy is blocked.

`rewardsReserved` records reservation per case. `rewardClaimed` and `rewardsClaimedForDispute` prevent duplicate or excess claims. `reservedJurorRewards` is the outstanding claimable reserve, `totalJurorRewardsReserved` is cumulative reservations, `totalJurorRewardsClaimed` is cumulative successful claims, and `totalProtocolFeesTransferred` is cumulative protocol fee deposits. Existing pending fee counters now represent unfinalized cases in Phase 2D mode; `totalDisputeFeesHeld` represents actual accounted fee/reward custody still held by arbitration.

Events are `ProtocolTreasuryConfigured`, `JurorRewardsReserved`, `ProtocolFeeDeposited`, and `JurorRewardClaimed`, alongside all existing arbitration, settlement and registry events. Claims remain available indefinitely; there is no expiry, forfeiture, reward redirection, or staking-yield mechanism. A juror assigned to several disputes may claim once for each case independently.

## Accounting invariants

For Phase 2D deployments, let C be successful openings, F successful finalizations, Q successful individual reward claims, S cumulative service fees and W cumulative treasury withdrawals. Token amounts below are in mUSD:

```text
pendingJurorFees              = 12 * (C - F)
pendingProtocolFees           =  3 * (C - F)
reservedJurorRewards          = 12 * F - 4 * Q
totalJurorRewardsReserved     = 12 * F
totalJurorRewardsClaimed      =  4 * Q
totalProtocolFeesTransferred  =  3 * F
totalDisputeFeesHeld          = pendingJurorFees + pendingProtocolFees + reservedJurorRewards
totalDisputeFeesHeld + totalJurorRewardsClaimed + totalProtocolFeesTransferred = 15 * C

treasury.totalRevenueReceived = S + 3 * F
treasury.availableRevenue    = treasury.totalRevenueReceived - treasury.totalWithdrawn
```

Each case reserves at most 12 mUSD and permits at most one 4 mUSD claim for each of its three distinct jurors. Global claimed rewards never exceed cumulative reservations. Neither treasury nor claims can spend pending collateral or escrow principal.

Existing invariants remain: escrow token balance covers `totalEscrowLiability`; registry balance covers `totalStaked`; each juror's locked stake equals 100 mUSD times active assignments; deposited stake equals locked plus available stake. Treasury balance covers `availableRevenue`, and arbitration balance covers `totalDisputeFeesHeld`. Donations can make custody balances larger than their accounted amounts but grant no extra withdrawal or reward rights.

Successful replay attempts cannot occur: settled milestones cannot pay another service fee, treasury records each fee source key once, cases finalize once, claims consume a per-case/juror flag, and withdrawals decrement available revenue before paying. Full token-supply conservation is checked across wallets and all four custody accounts, including recognized withdrawals and claimed rewards.

## Deployment and migration

Use the new complete module `ignition/modules/Phase2D.ts`. It creates a fresh stack in this order:

1. MockUSD, initially held by local account zero.
2. ProtocolTreasury with that token and account zero as owner.
3. TrustEscrow with that token and treasury address.
4. JurorRegistry with that token.
5. DisputeArbitration bound to escrow and registry.
6. Treasury owner pins escrow/arbitration through `configureSources`.
7. Arbitration deployer binds treasury through `setProtocolTreasury`.
8. Escrow and registry deployer each authorize arbitration with their existing one-time setter.

The Ignition module enforces configuration dependencies and returns `token`, `treasury`, `escrow`, `registry` and `arbitration`. Its automated test starts with an independent simulated chain at block zero.

```powershell
npm.cmd run compile
npm.cmd test
npm.cmd run typecheck
git diff --check

# Optional persistent local verification, in one terminal:
npm.cmd run node

# In another terminal:
npx.cmd hardhat ignition deploy ignition/modules/Phase2D.ts --network localhost
```

Earlier deployment modules deliberately remain available for their historical behavior. They bind escrow treasury to a demo wallet, keep arbitration in fee-retention mode and do not enable rewards. Do not use those modules when a complete Phase 2D stack is required.

These contracts are not upgradeable. An existing escrow treasury cannot be changed, and configured arbitration addresses cannot be replaced. Old deployed Phase 2C bytecode cannot gain new functions from source edits. Previously retained fees in old contracts have no authorized recovery path; this phase adds no arbitrary migration or administrator sweep. Even newly compiled legacy-mode arbitration refuses treasury setup after its first case. Use a fresh local Phase 2D stack and fresh test-token balances; do not assume existing projects, staking balances, addresses or retained fees migrate automatically. Existing persistent-chain cases may still be finalized under their old rules and jurors may withdraw unlocked collateral under those contracts' rules.

## Verification results

The implementation compiles with solc 0.8.28 using the existing Hardhat 3 configuration. `npm.cmd test` reports **143 passing Node.js tests: the unchanged prior 109 plus 34 Phase 2D tests**. `npm.cmd run typecheck` and `git diff --check` pass. No dependency or compiler version change is required.

`test/ProtocolTreasury.ts` covers source/owner authorization, one-time configuration, recognized service/dispute revenue, all verdicts including abstention/fallback, reservation and exactly-once claims, simultaneous/completed disputes, shared jurors, delayed claims, custody separation, donations, ownership handover, withdrawal limits, and the full lifecycle through treasury withdrawal. Adversarial tests exercise false and short token transfers, failed approvals, authorized-owner reentrancy, claim/intake reentrancy, safe retry and atomic rollback when the final protocol deposit fails. The original 109 tests are neither edited nor weakened.

The test-only `TreasuryTestToken` and `TreasuryOwnerHarness` provide fault injection and callback ownership behavior. No deployment module references them.

## Remaining limitations and scope

- This is an unaudited local/test implementation. No real assets or public-network deployment are authorized.
- The supported token is the existing standard six-decimal MockUSD. Exact transfer checks reject short or inconsistent transfers; they do not make arbitrary rebasing or mutable token implementations supported.
- One-time source/treasury configuration is irreversible and depends on reviewed contract addresses. ERC-165 and token-equality checks are compatibility checks, not proof that an arbitrary implementation is trustworthy.
- Treasury ownership controls protocol revenue and must be secured. Standard OpenZeppelin `renounceOwnership` remains inherited; renouncing permanently disables owner withdrawals and any still-unperformed owner configuration. Ownership cannot change fee sources, juror reward beneficiaries, votes or verdicts.
- Direct donations have no sweep path, and unclaimed rewards have no expiry or recovery path. Lost juror keys leave those rewards reserved indefinitely.
- Jury rotation remains deterministic and predictable; public voting, Sybil/collusion risks, permissionless-finalization transaction requirements and evidence-availability limitations remain unchanged. No new randomness, keeper, penalties or reputation mechanism is introduced.
- Old deployments and their retained fees cannot be retroactively migrated by this implementation.

Stop after independent Phase 2D review and local verification. Later phases require explicit approval.
