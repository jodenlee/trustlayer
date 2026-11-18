# Phase 2C: dispute resolution and arbitration

Phase 2C integrates the existing TrustEscrow and JurorRegistry through `DisputeArbitration`. Their contracts, interfaces, Phase 1/2B deployment modules and existing 63 tests are unchanged. Solidity remains 0.8.28 with Hardhat 3, the Node.js test runner and Viem.

The available design sources are `AGENTS.md`, `docs/PHASES.md`, `docs/PHASE2A.md` and `docs/PHASE2B.md`. The full referenced Solution Design Document v1.0 is not in this repository. The developer explicitly confirmed that the opening participant pays the 15 mUSD fee and that a 12-hour response window precedes 24-hour voting. The roadmap specifies a 12 mUSD juror / 3 mUSD protocol fee allocation; this phase records those portions but does not distribute them.

## Contracts, functions and configuration

`IDisputeArbitration` defines the dispute record, status/vote enums, public lifecycle functions, read methods and events. The production contract exposes:

- `openDispute(projectId, milestoneIndex, evidenceHash)`: either the real client or freelancer may open on the current submitted milestone of an ACTIVE project through the escrow review deadline. Evidence must be a nonzero reference hash. The opener approves and pays 15 mUSD from their own wallet. A successful call creates one case, collects the exact fee, freezes escrow and reserves three distinct jurors with 100 mUSD locked from each. Failure at any step reverts the entire transaction.
- `respondToDispute(disputeId, evidenceHash)`: the participant other than the opener may submit one nonzero response reference hash during the response window. The opener, jurors and outsiders cannot respond. Responding does not shorten or extend any deadline. A missing response does not block voting or alter the majority rule.
- `castVote(disputeId, vote)`: each of the three assigned jurors may submit one ballot during voting. Participants and unassigned wallets cannot vote. The values are NONE = 0 (not a valid ballot), FREELANCER_WINS = 1, CLIENT_WINS = 2 and SPLIT = 3. Votes and counters are stored on-chain and cannot be edited by an administrator or the voter.
- `finalizeDispute(disputeId)`: anyone may finalize after the voting deadline. The contract computes the ruling, marks the case finalized, settles the selected escrow milestone and releases its three registry locks in one transaction. A downstream failure reverts status, payouts, events and unlocking; the same case can be retried after the failure is addressed.
- `getDispute(disputeId)`: returns the project/milestone, amount, participants, opener/fee payer, jury, evidence/response hashes, timestamps, vote counts, status, final ruling, allocation and fallback marker. A nonexistent case reverts.
- `getMilestoneDispute(projectId, milestoneIndex)`: returns an explicit existence flag and dispute ID. ID zero is valid. A milestone's case association is never deleted or reusable, including after finalization.
- `getVerdict(disputeId)`: returns the on-chain ruling, freelancer allocation and fallback marker after voting has ended. It reverts before then or for an unknown case. It is also available after finalization.
- `votes(disputeId, juror)`: returns the immutable recorded ballot, or NONE if no vote exists.
- `isConfigured()`: checks that both collaborators authorize this arbitration address. Immutable `escrow`, `registry` and `paymentToken` getters expose the bindings; public fee counters expose custody accounting.

Deployment order is mandatory:

1. Deploy MockUSD, TrustEscrow and JurorRegistry with the same token address.
2. Deploy DisputeArbitration with the escrow and registry addresses. Both must be contracts using the same token and must still have unconfigured arbitration addresses.
3. The escrow's immutable configurator calls `escrow.setArbitrationContract(arbitration)` once.
4. The registry's immutable configurator calls `registry.setArbitrationContract(arbitration)` once.

The arbitration contract cannot perform these authorizations from its constructor because each setter requires the original deployer. Opening remains disabled until both authorizations match. A partial configuration cannot collect fees or freeze a milestone. There is no arbitration administrator, upgrade method, generic external-call method or vote/ruling override.

`ignition/modules/Phase2C.ts` reuses the earlier modules, deploys arbitration and performs both authorizations from account zero, the original local deployer. It returns token, escrow, registry and arbitration. Use a fresh local deployment if earlier contracts were already bound to another arbitration address or test harness; one-time configuration cannot be replaced.

## State machine and exact time boundaries

The persistent case lifecycle is `NONE -> OPEN -> FINALIZED`. OPEN contains response, voting and ready-to-finalize periods determined entirely by block timestamps. No caller needs to advance a timer state.

```text
openedAt         = timestamp of successful opening
responseDeadline = openedAt + 12 hours
votingDeadline   = responseDeadline + 24 hours
```

| Operation | On-chain time condition |
|---|---|
| Open a dispute | `timestamp <= escrow reviewEnd` |
| Record counterparty response | `timestamp < responseDeadline` |
| Cast an assigned juror's vote | `responseDeadline <= timestamp <= votingDeadline` |
| Read the binding verdict or finalize | `timestamp > votingDeadline` |

At the exact response deadline, responses are closed and voting is open. At the exact voting deadline, voting remains open and finalization is blocked. One second later, voting is closed and finalization is permissionless. Even a unanimous early jury cannot finalize early. The three juror stakes remain locked throughout both windows and until successful finalization.

The escrow's Phase 2A rule is preserved: the milestone must be submitted and current, and freezing must execute by its review deadline inclusive. Once frozen, normal approval, timeout release, missed-delivery refund and unaccepted-project refund cannot settle that milestone. A later milestone can be submitted and disputed under a fresh dispute ID after the current one settles.

## Majority, missing votes and fallback

At least two identical votes are required out of the assigned three jurors. Abstention is not a ballot and does not lower the two-vote threshold.

| Ballots at deadline | Ruling | Freelancer gross allocation | Fallback marker |
|---|---|---|---|
| At least two FREELANCER_WINS | Freelancer wins | 10,000 bps | false |
| At least two CLIENT_WINS | Client wins | 0 bps | false |
| At least two SPLIT | Split | 5,000 bps | false |
| Three different votes | Split | 5,000 bps | true |
| Two different votes and one abstention | Split | 5,000 bps | true |
| One vote and two abstentions | Split | 5,000 bps | true |
| Zero votes | Split | 5,000 bps | true |

Two identical votes and one abstention still produce that majority ruling. No response or vote is needed to allow fallback finalization after the deadline. All three stakes unlock on successful finalization, including abstainers' stakes; there are no attendance penalties or rewards in this phase.

The contract derives the result exclusively from its stored on-chain counters and enforces one immutable ballot per assigned juror. Frontend calculations cannot supply a verdict or freelancer allocation to finalization.

## Token custody and events

Each successful opening retains exactly 15 mUSD in arbitration. The event and dispute opener identify its payer. Failed openings collect no fee and consume neither a case ID nor the token allowance. Successful case fees are not refunded based on outcome.

```text
totalDisputeFeesHeld = pendingJurorFees + pendingProtocolFees
totalDisputeFeesHeld = 15 mUSD * number of successfully opened disputes
pendingJurorFees     = 12 mUSD * number of successfully opened disputes
pendingProtocolFees  =  3 mUSD * number of successfully opened disputes
arbitration token balance >= totalDisputeFeesHeld
```

Finalization does not reduce these retained-fee counters or distribute fees. The portions are accounting earmarks, not a new per-juror reward formula. Donations create surplus and are not counted as dispute fees. Exact incoming balance-delta checks reject short/fee-on-transfer payments even when surplus exists.

Milestone principal stays in escrow until escrow settlement, while juror collateral stays in the registry. Arbitration cannot choose arbitrary settlement recipients or withdraw unrelated escrow funds. It passes only the case's stored project/milestone and the computed allocation to the existing settlement method. The existing 1% service fee is charged on freelancer gross, including split and fallback outcomes; no fee is charged on client refunds. Existing allocation and fee rounding rules remain unchanged.

For a 400 mUSD milestone, freelancer victory pays 396 mUSD to the freelancer and 4 mUSD to the existing treasury wallet. Client victory refunds 400 mUSD to the client. A split/fallback refunds 200 mUSD to the client, pays 198 mUSD to the freelancer and 2 mUSD to the treasury wallet. The separate 15 mUSD dispute fee remains in arbitration in all three cases.

Existing custody invariants continue to hold: escrow balance covers `totalEscrowLiability`, registry balance covers `totalStaked`, and locked stake is 100 mUSD per active assignment. Fees, collateral, principal and existing treasury-wallet payouts remain separately accounted for.

Events are `DisputeOpened`, `DisputeFeeCollected`, `DisputeResponded`, `VoteCast`, `VerdictReached` and `DisputeFinalized`. The verdict event includes all three counts and the fallback marker. The finalization event includes the case, project, milestone, allocation, amount and finalization time. The escrow additionally emits its existing `MilestoneSettled` event with every payout and service-fee amount; registry events record the actual locking and unlocking.

## Security considerations and Phase 2D dependencies

- All arbitration mutations are reentrancy guarded. Local state effects precede external token, escrow and registry mutations, and failed downstream operations revert the complete transaction. SafeERC20 handles fee payments; escrow continues to use it for payouts.
- The production collaborators are immutable and must be reviewed before their one-time authorization. Token equality/code checks do not prove an arbitrary replacement contract is trustworthy. The supported token remains standard six-decimal MockUSD; rebasing or mutable token implementations are unsupported.
- Deterministic jury rotation is inherited unchanged. It is predictable and provides no secure randomness, Sybil resistance, collusion prevention or resistance to selection manipulation through funded wallets and transaction ordering. Ballots are public; this phase has no commit/reveal mechanism.
- Only evidence reference hashes are stored. No deliverables, personal information or private evidence contents belong on-chain. Private storage, access control and evidence availability are outside this phase.
- Finalization is permissionless but requires an actual transaction. There is no keeper service, arbitration override, force-unlock administrator or early settlement escape hatch.
- **Retained fees have no withdrawal or distribution path in this non-upgradeable Phase 2C contract.** They cannot automatically become transferable when a future treasury is deployed. Phase 2D must explicitly resolve treasury integration and fee custody/migration architecture before any real-value deployment; do not assume this deployed bytecode can be retrofitted. This is intentional local/test custody within the requested phase boundary, not a production-ready treasury transition.
- ProtocolTreasury, juror reward distribution, attendance penalties, slashing and reputation remain unimplemented. The 12/3 allocation is recorded without inventing payout rules. These future changes require a separate approved task.
- The system is unaudited and is not approved for handling real assets or public deployment.

## Verification and integration results

Commands executed:

```powershell
npm.cmd run compile
npm.cmd test
npm.cmd run typecheck
git diff --check
```

The new production contract/interface compiled with solc 0.8.28, and the test-only failure harness compiled separately with the same version. The automated suite reports **109 passing Node.js tests: the existing 63 plus 46 Phase 2C tests**. TypeScript checking passes. A fixture typing error found during development was corrected by binding a common ERC-20 ABI for standard and adversarial test tokens; no test assertions were removed or weakened.

Coverage includes configuration, opener fee payment, invalid callers/states, duplicate cases, exact review/response/voting/finalization boundaries, exclusions, insufficient jurors, complete opening rollback, response evidence, one ballot per juror, all rulings, missing-vote fallback, repeated-finalization rejection, unlocking, retained fees and independent projects. Integration tests verify the complete fund/accept/submit/open/vote/finalize/payout/unlock path, sequential disputed milestones and the connected Ignition deployment module.

Adversarial tests verify reentrancy protection during fee collection and payouts, false/short token transfers, retry after failed escrow payout, and rollback of already executed escrow payouts when registry release subsequently fails. Token supply and balances are conserved across wallets, escrow, registry, arbitration and the existing treasury wallet.

`contracts/test/DisputeRegistryHarness.sol` is an unrestricted test fixture used solely to inject registry-release failure while forwarding to real registry custody. It is never referenced by deployment modules and must never replace the production registry.

For optional local deployment with a running Hardhat node:

```powershell
npx.cmd hardhat ignition deploy ignition/modules/Phase2C.ts --network localhost
```

No public-network deployment, commit, push or Phase 2D implementation is included. The next step is independent review and local verification of Phase 2C, followed by explicit approval before starting another phase.
