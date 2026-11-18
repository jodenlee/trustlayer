# Phase 2A: escrow arbitration foundation

This phase adds the escrow boundary for future arbitration. It does not implement dispute creation, fees, juror registration, voting, staking, a treasury contract or frontend functionality. The existing local deployment module still deploys only MockUSD and TrustEscrow.

## Design basis and compatibility

The available repository design sources are `README.md` and `docs/PHASES.md`. The roadmap references TrustLayer Solution Design Document v1.0 (2026-11-16), but that full document is not present in this repository. No new voting, refund, reward or dispute-fee economics are introduced here.

The two-address escrow constructor, existing public method signatures, enum values, sequential milestones, existing timeout rules and settlement accounting are preserved. Enums now live in the inherited `ITrustEscrowArbitration` interface so both contracts can share typed context. Existing public getter ABI types remain unchanged. The compiler remains Solidity 0.8.28.

Existing deployed contracts cannot acquire these methods automatically; they are not upgradeable. Phase 2A requires a new local escrow deployment for verification, with no migration or public-network deployment included in this task.

## One-time configuration

1. Deploy MockUSD and TrustEscrow with the existing Phase 1 constructor arguments.
2. Later, deploy the reviewed arbitration contract bound to that escrow address.
3. The account that deployed TrustEscrow calls `setArbitrationContract(arbitrationAddress)` exactly once.

`arbitrationConfigurator` is the immutable constructor caller. Other accounts cannot initialize arbitration. Zero addresses, EOAs, the escrow itself and addresses without deployed code are rejected. The setter emits `ArbitrationContractConfigured` and cannot replace, reset or reinitialize the address, even when called by the configurator. An invalid attempt does not consume initialization.

Before configuration, the Phase 1 paths remain usable and arbitration calls are unauthorized. The configuration may also occur after Phase 1 projects exist. Check the arbitration implementation and its escrow binding before initializing: a code-length check does not prove interface support, correct authorization or settlement liveness. An upgradeable arbitration proxy would retain the same address while permitting implementation changes; this setter does not control such upgrades. There is no recovery from configuring an incorrect contract.

`contracts/test/ArbitrationHarness.sol` is an unrestricted test-only forwarder. It is never referenced by deployment modules and must never be configured on a live deployment. It supplies no production arbitration logic.

## Interface and state transitions

`contracts/interfaces/ITrustEscrowArbitration.sol` exposes:

- `getDisputeContext(projectId, index)`: returns the client, freelancer, milestone amount, project state, milestone state and original review deadline. Nonexistent projects and out-of-range milestones revert. Reads are public and contain no private evidence.
- `freezeMilestone(projectId, index)`: only the configured arbitration contract may transition the current milestone of an ACTIVE project from SUBMITTED to DISPUTED. It must execute at `block.timestamp <= reviewEnd`, including the exact deadline. PENDING, already frozen, SETTLED, out-of-order and nonexistent milestones cannot be frozen.
- `settleDisputedMilestone(projectId, index, freelancerBps)`: only the configured arbitration contract may settle the current DISPUTED milestone of an ACTIVE project. The allocation range is 0-10,000 inclusive. It has no arbitrary recipient or withdrawal amount parameter.

The submitted-milestone review window is the conservative eligibility rule for this foundation: non-delivery continues to use the existing Phase 1 refund path. Normal review-time release requires `block.timestamp > reviewEnd`, so freezing cannot start after that release becomes available. Client approval remains available until a freeze transaction executes; transaction ordering determines which transition succeeds first.

A freeze emits `MilestoneFrozen` and moves no tokens or liabilities. While DISPUTED, approval, review-time release, missed-delivery refund and resubmission are blocked by their existing state checks. The unaccepted-project refund requires FUNDED and cannot refund an ACTIVE project with a frozen milestone. There is no cancellation method in the existing contract.

Settlement uses the existing private `_settle` path: mark SETTLED, reduce project escrow and total liability, advance the current milestone, and complete the project after the last milestone. Effects occur before SafeERC20 transfers. Both arbitration entry points use reentrancy protection. Repeated settlement and attempts to access another milestone fail state/index checks.

Settlement emits the existing `MilestoneSettled` event with gross, net, refund and fee amounts, plus `DisputedMilestoneSettled` with the allocation. Existing event consumers can continue to account for every settlement through `MilestoneSettled`.

## Allocation and conservation

For a milestone amount `A`, freelancer allocation `B` and the existing 100-bps service fee:

```text
freelancerGross = floor(A * B / 10,000)
clientRefund    = A - freelancerGross
serviceFee      = floor(freelancerGross * 100 / 10,000)
freelancerNet   = freelancerGross - serviceFee
```

Amounts use six-decimal mUSD base units. Allocation rounding remainder belongs to the client; service-fee rounding remainder stays in the freelancer's net payout, matching Phase 1. Refunds incur no service fee. For a 400 mUSD milestone at 5,000 bps, the client receives 200 mUSD, the freelancer receives 198 mUSD and the configured treasury wallet receives 2 mUSD.

Every settlement distributes exactly the selected milestone amount and reduces liabilities by that amount. Other projects, future milestones and unsolicited token surplus are not spendable through arbitration. `totalEscrowLiability` equals the sum of each project's `escrowRemaining`; the escrow token balance must be at least that liability. There are no juror stakes or dispute fees held by this escrow.

## Verification and remaining boundaries

Run after installing the locked dependencies:

```powershell
npm.cmd run compile
npm.cmd test
npm.cmd run typecheck
```

The TypeScript configuration includes Hardhat-generated `artifacts/**/*.d.ts` for typed contract calls; compile before type checking on a fresh checkout.

`test/TrustEscrowArbitration.ts` covers initialization, unauthorized EOAs/contracts, lifecycle and exact deadline checks, frozen-path exclusion, full/partial/refund payouts, fee and allocation rounding, events, replay prevention, independent projects, unsolicited surplus and the Phase 1 timeout/refund paths. `test/TrustEscrow.ts` remains unchanged.

Frozen funds have no independent escrow timeout or administrator escape hatch. Future arbitration must enforce dispute eligibility, authorized verdict production, response/voting deadlines and the approved 50/50 fallback, then call settlement to ensure liveness. That decision logic is outside Phase 2A. The reviewed arbitration contract is trusted to select a valid allocation for eligible frozen milestones; escrow enforces custody, recipient, amount and state constraints. This foundation is not a production security audit or approval to handle real funds.
