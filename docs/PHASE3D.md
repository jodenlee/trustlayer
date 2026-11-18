# Phase 3D — Dispute resolution and juror workflows

## Scope and source of truth

Phase 3D integrates the existing production DisputeArbitration/JurorRegistry/TrustEscrow contracts into the Phase 3A–3C frontend. Solidity 0.8.28, Hardhat 3, deployment modules, generated ABIs/address metadata, dependencies and protocol economics remain unchanged. The full referenced Solution Design Document is not in the repository; the actual source/interfaces and approved Phase 2B–2E documents define this implementation.

Connected verified wallets use live `/disputes`, numeric `/disputes/<id>`, `/juror`, project arbitration controls, dashboard counts and transaction history. Disconnected views and explicit `dp-*`/`tl-*` routes retain labeled previews. Invalid network/deployment/read states never substitute sample cases, balances or outcomes. No backend, Supabase, private uploads, reputation, appeals, governance, refund UI, treasury administration UI or public deployment is added.

## Files created and modified

New files:

- `apps/web/src/lib/blockchain/arbitration.ts`: generated-ABI dispute types, state/deadline/role rules, allocation formatting, bounded discovery and verified receipt IDs.
- `apps/web/src/lib/blockchain/arbitration-actions.ts`: fresh-state dispute, response, voting, finalization, staking and claim executors.
- `apps/web/src/lib/blockchain/hooks/use-arbitration.ts`: verified wallet-scoped read/query adapters.
- `apps/web/src/components/reviewed-action.tsx`: persistent reviewed-action provider and buttons.
- `apps/web/src/components/project-arbitration.tsx`, `chain-disputes.tsx`, `chain-dispute-detail.tsx`, `chain-juror.tsx`: live protocol views/actions.
- `apps/web/test-support/arbitration-rpc.ts`, `tests/arbitration.spec.ts`, `unit/arbitration.test.ts`: test-only stateful RPC and regressions.
- `apps/web/scripts/verify-arbitration-workflow.ts`: actual production-contract frontend integration on an owned in-process EVM.
- `docs/PHASE3D.md`: this guide.

Modified files:

- `apps/web/src/app/(workspace)/disputes/[id]/page.tsx`: zero-based bigint numeric case routes alongside preserved preview routes.
- `apps/web/src/components/chain-project-detail.tsx`, `chain-projects.tsx`, `chain-history.tsx`, `dispute-list.tsx`, `juror.tsx`, `shell.tsx`, `providers.tsx`, `workflow-provider.tsx`: integration, history, layout, app-level review tracking and scoped in-memory inputs.
- `apps/web/src/lib/blockchain/escrow-actions.ts`: export the existing checked-send function for reuse; escrow behavior unchanged.
- `apps/web/src/lib/blockchain/history.ts`, `session.ts`, `hooks/use-projects.ts`: arbitration/registry event history, case references, in-memory inputs and bounded protocol history start.
- `apps/web/test-support/escrow-rpc.ts`: test-only per-owner/spender allowances, contract extension hook and decoding all five generated production ABIs.
- `AGENTS.md`, `README.md`, `docs/PHASES.md`, `apps/web/README.md`, `apps/web/src/lib/blockchain/hooks/README.md`: synchronized current scope and rules.

## Contract method mappings

| Frontend operation | Actual generated-ABI method |
| --- | --- |
| Dispute association/eligibility | TrustEscrow `projects`, `milestones`; arbitration `getMilestoneDispute(projectId,index)` |
| Fee/stake allowance and balance | MockUSD `balanceOf(wallet)`, `allowance(wallet,spender)`, `approve(spender,exactAmount)` |
| Open | `openDispute(projectId,milestoneIndex,evidenceHash)` |
| Response | `respondToDispute(disputeId,evidenceHash)` |
| Discovery/detail | `nextDisputeId()`, `getDispute(disputeId)` |
| Ballot read/write | `votes(disputeId,juror)`, `castVote(disputeId,vote)` |
| Finalize | `finalizeDispute(disputeId)` — no verdict/allocation argument |
| Reward read/write | `claimableReward(disputeId,wallet)`, `rewardClaimed(disputeId,wallet)`, `claimJurorReward(disputeId)` |
| Juror profile | `getJurorInfo(wallet)`, `isEligible(wallet)`, `MIN_STAKE()` |
| Registration/collateral | `registerJuror()`, `depositStake(amount)`, `withdrawStake(amount)` |
| Jury feasibility/locks | `previewJurors(client,freelancer)`, `getAssignment(disputeId)` |
| Treasury reads | `totalServiceFeesReceived()`, `totalDisputeFeesReceived()`, `disputeFeeReceived(disputeId)` |

The app imports ABIs from `@trustlayer/contracts`. Dispute/project IDs remain uint256 bigint/canonical decimal paths, including ID zero. Milestone indices are zero-based; valid milestones are bounded by escrow's existing 1–5 limit. `getDispute` returns its named ABI struct; enum values are NONE/OPEN/FINALIZED = 0/1/2 and NONE/FREELANCER_WINS/CLIENT_WINS/SPLIT = 0/1/2/3. Existing `getMilestoneDispute` existence flags distinguish case zero from no case.

## Opening a dispute

Project detail shows opening controls only for a participant on the current SUBMITTED milestone of an ACTIVE project, through reviewEnd inclusive, without an existing case. It displays the amount, review deadline, wallet mUSD balance and arbitration allowance. A nonzero bytes32 public evidence hash is required; files, personal information and confidential deliverables stay off-chain.

The opener pays 15 mUSD from their own wallet. Insufficient balance disables approval/opening. If needed, a reviewed ERC-20 transaction grants exactly 15 mUSD to arbitration. Confirmation refreshes allowance but does not open or pay for a case. A second reviewed action calls openDispute. Fresh preflight checks the reviewed milestone index, actual roles/states/deadline/duplicate flag, balance/allowance and ability to reserve three eligible nonparticipants. The preview is a snapshot, not a promised jury; final simulation and the contract remain authoritative.

Opening atomically charges the fee, freezes escrow and locks the jury. Failure, including shortage of jurors, reverts everything. The frontend does not set a local frozen flag. It extracts the actual DisputeOpened receipt ID by checking emitter, project, milestone and opener, then navigates to the numeric case route. Frozen/settled milestones link to their existing case and do not expose normal payout controls.

## Time, evidence and public voting

All stage/action rules use the latest read block timestamp, with detail refreshes every five seconds. Time-remaining text identifies that block-based source; changing browser time does not enable an action. A local chain with no newly mined blocks may show unchanged chain time until another block is mined.

```text
responseDeadline = openedAt + 12 hours
votingDeadline   = responseDeadline + 24 hours
```

| Operation | Exact contract boundary |
| --- | --- |
| Open | timestamp <= milestone reviewEnd |
| Other participant's single response hash | timestamp < responseDeadline |
| Assigned juror's one vote | responseDeadline <= timestamp <= votingDeadline |
| Permissionless finalization | timestamp > votingDeadline |

The counterparty may submit one response hash; the opener, jurors and outsiders cannot. Recorded opening/response hashes, participants, fee payer, selected jurors and public ballots are displayed. The frontend does not upload or retrieve private files and does not imply that a hash supplies evidence availability or confidentiality.

Only assigned jurors see voting controls. They remain disabled before/after voting or after a recorded ballot. The review explains the chosen outcome: Freelancer wins (10,000 bps gross), Client wins (0 bps), or Split (5,000 bps). Votes are public and immutable. The case stage and response/voting/finalization timeline are separate from the persistent OPEN/FINALIZED contract status.

## Staking and assignment discovery

The juror workspace reads registration, minimum stake, deposited/locked/available balances, active-assignment count and eligibility from the registry. Registration transfers no tokens. Deposits may be below 100 mUSD; new eligibility requires at least 100 mUSD unlocked, and each assignment locks another 100 mUSD. Exact amount parsing uses bigint and six decimals.

Registration, token approval, deposit, top-up and withdrawal are separately reviewed transactions. Deposit rereads registration, wallet balance and registry allowance. Withdrawal rereads available stake and cannot offer locked funds. Withdrawing below eligibility is permitted, with the resulting actual eligibility shown. A released case's lock does not imply zero locked stake globally if other assignments remain active.

Dispute discovery scans twenty candidate IDs per page, newest first at a pinned block, with four candidate reads in flight. It includes the wallet as client, freelancer or any historical assigned juror. Juror views filter that list to assignments, including finalized cases with rewards. This preserves old reward discovery that getActiveDisputes alone would miss. Full-list getActiveDisputes/getAvailableJurors are deliberately not used for discovery because their return size is unbounded; the active count is read directly from getJurorInfo. Load earlier disputes explicitly expands coverage. Worst-case total discovery is O(all protocol cases) across user-requested pages; this is a local-development approach, not an event indexer.

## Finalization, settlements and rewards

After voting closes, any connected wallet, including an outsider visiting a numeric case URL, can review and call finalizeDispute. The frontend supplies no verdict or allocation. Only after actual finalization does it show stored ruling, freelancerBps and fallbackApplied. A two-vote majority determines the outcome; missing/incompatible votes produce the contract's 50/50 fallback. Abstention does not remove reward entitlement.

Displayed allocations use on-chain amount/BPS and the project's stored service-fee rate with bigint rounding:

```text
freelancerGross = floor(amount * freelancerBps / 10,000)
serviceFee     = floor(freelancerGross * feeBps / 10,000)
freelancerNet  = freelancerGross - serviceFee
clientRefund  = amount - freelancerGross
```

For a 400 mUSD milestone, freelancer victory pays 396 net/4 fee; client victory refunds 400/0 fee; split/fallback pays 198 net/2 fee and refunds 200. Matching MilestoneSettled events provide actual settlement history. Treasury counters are explicitly protocol-wide cumulative reads, while disputeFeeReceived identifies this case's protocol fee.

Finalization also releases that assignment's three collateral locks, transfers 3 mUSD to treasury and reserves 12 mUSD in arbitration. Each assigned juror can claim their actual 4 mUSD entitlement once, to themselves, using claimJurorReward. The app reads claimableReward/rewardClaimed rather than inferring eligibility from a vote or sending frontend token transfers. Multiple finalized cases remain independently claimable. Principal, collateral, revenue and rewards stay in separate contracts/accounts.

## Transaction handling, dashboard and history

All writes reuse Phase 3B/3C wallet/deployment checks, SafeERC20 contract paths, simulation, gas estimation, receipt tracking and per-wallet/chain unresolved-request locks. Failed/rejected/reverted/unknown/replaced/confirmed states remain distinct; a hash alone is not success. The existing gas message remains visible when a wallet has zero ETH. Unknown receipts retain the session lock and can be checked in Transactions. Reload clears client memory; contracts remain the final duplicate/authorization boundary.

ReviewedActionProvider lives at app level so read invalidation, wallet verification, route navigation or disappearance of a finalized/claimed action row cannot destroy receipt tracking or opening navigation. It captures the reviewed actor, deployment, target parameters and content. Non-sensitive hash/stake inputs survive background refresh in a separate memory-only store scoped by wallet/deployment. Switching wallets does not reuse another wallet's inputs or review. Fresh state/deadline guards run again before signing; changed state causes a useful error rather than a different milestone/action.

Dashboard adds active loaded disputes, responses awaiting this wallet, unvoted currently votable assignments, loaded finalizable cases and actual unclaimed rewards. These are loaded-page totals, not protocol-wide totals.

Transactions includes session requests and separately labeled confirmed events for opening, response, public votes, finalization, claims, registration, stake deposits/withdrawals, assignments/locks and approvals to the three protocol spenders. Wallet-authored events are distinguished from related case/project events (for example, another juror's vote or permissionless finalization). History does not infer the sender of a finalization from an event that omits it.

Event pages span at most 200 explicit blocks. Deployment start is found using bounded historical code search on MockUSD, deployed before all collaborators. Pages over 2,000 returned logs fail explicitly rather than presenting truncated data as complete. Timestamp lookup is bounded to thirty blocks per page. Case and project scope can be expanded with earlier-ID buttons; older event blocks load separately. No unrestricted full-chain log scan, permanent database history or invented explorer/hash is used.

## Verification

Commands from the repository root (Hardhat operations run sequentially):

```powershell
npm.cmd run compile
npm.cmd test
npm.cmd run typecheck
npm.cmd --prefix apps/web run test:unit
npx.cmd hardhat run apps/web/scripts/verify-escrow-workflow.ts
npx.cmd hardhat run apps/web/scripts/verify-arbitration-workflow.ts
npm.cmd run web:lint
npm.cmd run web:typecheck
npm.cmd run web:build
$env:PLAYWRIGHT_CHANNEL='chrome'
$env:PLAYWRIGHT_PORT='3001'
npm.cmd run web:test
npm.cmd --prefix apps/web run format:check
git diff --check
```

Compile before frontend type checking on a clean checkout so the existing integration artifact declarations exist. The browser runner owns/stops its production server on port 3001; it does not stop a user's port-3000 app. No dependency/compiler upgrade is required.

Final verification results:

| Command/check | Actual result |
| --- | --- |
| `npm.cmd run compile` | Exit 0; no contracts to compile |
| `npm.cmd test` | Exit 0; **156 passing Node.js blockchain tests** |
| `npm.cmd run typecheck` | Exit 0 |
| `npm.cmd --prefix apps/web run test:unit` | Exit 0; **132 passed**, 0 failed/cancelled/skipped/todo (77 retained + 55 new) |
| `npx.cmd hardhat run apps/web/scripts/verify-escrow-workflow.ts` | Exit 0; existing Phase 3C integration, **11 confirmed frontend actions** |
| `npx.cmd hardhat run apps/web/scripts/verify-arbitration-workflow.ts` | Exit 0; **70 confirmed frontend actions**, four verdicts and 12 claims |
| `npm.cmd run web:lint` | Exit 0; zero allowed warnings |
| `npm.cmd run web:typecheck` | Exit 0; route generation and TypeScript |
| `npm.cmd run web:build` | Exit 0; production build and 18 generated pages |
| Chrome/port-3001 `npm.cmd run web:test` | Exit 0; **252 passed (3.1m)**, 0 failed (180 retained + 24 new cases across three viewports) |
| `npm.cmd --prefix apps/web run format:check` | Exit 0 |
| `git diff --check` and new-file whitespace check | Passed |
| Protected-source diff | Production Solidity, deployment modules, contract package/exports, compiler/tooling/dependencies and both lockfiles unchanged |

All original browser/unit test files and assertions remain unchanged. A first full run found duplicate Review deadline text matching an older test; the new dispute-specific label now reads Dispute opening deadline. Two earlier mobile Chrome timeouts passed on recheck without changing tests/timeouts/retries. The final complete run passed all 252 tests. Desktop/mobile finalization and juror-collateral screenshots were visually inspected; workflow tests also check page overflow and visible pending/error feedback. No failing check remains unresolved.

The real Phase 3D EVM integration executes 70 confirmed frontend transactions through the same action/discovery/history/controller modules against a fresh Phase2D Ignition deployment. It covers both opener roles, registration/staking, exact approvals, four verdicts including no-vote fallback, response/ballot duplicate prevention, frozen normal payout rejection, exact deadline guards, unlocked withdrawal while collateral is reserved, delayed claims across four finalized cases and all twelve juror claims. It verifies 48 mUSD rewards, 8 mUSD service plus 12 mUSD dispute treasury revenue, 700 mUSD remaining collateral and 500 mUSD untouched independent escrow, with full token-supply conservation. The owned EVM closes; no user's running node, token balance, deployment or tracked export is modified.

Initial browser testing caught disappearing action dialogs/input on query refresh; app-level tracking and scoped memory-only inputs corrected that behavior. Test fixtures were extended to decode all five generated production ABIs, and in-app navigation tests preserve the existing explicit-reconnect-on-reload policy. Type/lint issues were corrected without disabling checks, changing Solidity or weakening existing assertions.

## Manual MetaMask walkthrough

User-reported successful Phase 3C manual MetaMask verification is the baseline. Phase 3D browser automation uses test-only injected providers, while EVM integration uses actual production bytecode with unlocked test accounts. Neither is a new manual MetaMask claim.

1. Keep a persistent Phase2D stack running on Hardhat Local (31337/port 8545) with a non-ephemeral export matching its live block/runtime. Existing verified Phase 3C deployments can be reused. Use [Phase 3C](PHASE3C.md) for setup/export and local ETH. For mUSD, use the [repeatable five-wallet provisioning script](LOCAL_TOKENS.md): client target 2,000, freelancer 100, three jurors 200 each; only shortfalls are transferred from the original holder. Run `npm.cmd run web:dev`, open http://127.0.0.1:3000 and connect explicitly. Each acting wallet needs local ETH; the opener additionally needs 15 mUSD beyond any project funding, and each of three distinct juror wallets needs at least 100 mUSD to deposit. There is no automatic faucet/minting.
2. Connect each juror in turn on `/juror`: Register, approve exactly 100 mUSD, wait, then Deposit stake separately. Confirm deposited/available stake and eligibility. Optional extra stake permits more concurrent assignments. These wallets must differ from the project's client/freelancer.
3. Complete the Phase 3C create → approve → fund → accept → submit flow for a 400 mUSD milestone. As either participant, enter a non-sensitive bytes32 opening hash on the submitted milestone. Review/confirm the exact 15 mUSD arbitration allowance, then separately Open dispute. Confirm receipt-derived navigation, actual selected jurors and the frozen milestone. Reject a request once to verify that its error stays in the dialog and no case is invented.
4. Switch to the other participant. Before responseDeadline, record one non-sensitive response hash. Confirm it cannot be repeated. The opener and jurors should not see this response action.
5. Wait for chain time to reach responseDeadline. For an accelerated walkthrough, use only a controlled local demo node and the console helper below; never change browser time or use a shared/nonlocal chain. As each selected juror, inspect public references, review a ballot and vote. Before the first deadline voting must be disabled. Confirmed ballots cannot be changed.
6. At votingDeadline voting is still allowed and finalization is not. Move chain time strictly after it. Any connected wallet may Finalize dispute. Verify stored ruling/fallback, exact payout/fee/refund amounts, SETTLED milestone and released case locks. Repeating finalization must be unavailable. Two freelancer votes on 400 mUSD produce 396 net/4 fee; two client votes refund 400; split/no-majority produces 198 net/2 fee and 200 refund. Use separate cases to test each outcome.
7. As each assigned juror, Claim 4 mUSD reward once. Check claimed/claimable state and Transactions event/hash; the button disappears after confirmation. On `/juror`, verify this case is no longer active and its collateral is available (subject to other cases). Withdraw only unlocked stake and verify eligibility updates below 100 mUSD. Discover older finalized rewards with Load earlier disputes.
8. Test account/network changes with a review open: signing must pause until a fresh review. During a pending request, confirmation/duplicate controls must stay disabled and the hash remain tracked through background verification. Reload clears session-only inputs/requests and requires reconnection; actual cases, claims and stake remain on-chain.

For local-only accelerated time, run `npx.cmd hardhat console --network localhost` in another terminal on your controlled demo node:

```javascript
const c = await network.create();
const rpc = await c.viem.getPublicClient();
if (c.networkName !== 'localhost' || await rpc.getChainId() !== 31337) throw new Error('Local demo node only');
const fs = await import('node:fs/promises');
const sdk = await import('./packages/contracts/src/index.ts');
const manifest = sdk.parseLocalDeployment(JSON.parse(await fs.readFile('packages/contracts/generated/deployments/31337.json', 'utf8')));
if (manifest.ephemeral || new URL(manifest.rpcUrl).port !== '8545') throw new Error('Persistent local export required');
await sdk.assertDeploymentOnChain(rpc, manifest);
const arbitration = await c.viem.getContractAt('DisputeArbitration', manifest.contracts.DisputeArbitration.address);
const dispute = await arbitration.read.getDispute([0n]); // use your actual receipt-derived ID
async function mineAt(timestamp) {
  if (timestamp <= (await rpc.getBlock()).timestamp) return;
  await c.provider.request({ method: 'evm_setNextBlockTimestamp', params: [Number(timestamp)] });
  await c.provider.request({ method: 'evm_mine', params: [] });
}
await mineAt(dispute.responseDeadline); // then vote through the UI
// After voting, run separately:
// await mineAt(dispute.votingDeadline + 1n);
```

The frontend has no time-control button. The test script performs its own time manipulation only inside its owned in-process EVM.

## Limitations and remaining Phase 4/backend work

- Evidence hashes are public references, not private files or authenticated delivery. No evidence availability, encryption, backend authorization, Supabase, SIWE or access-controlled retrieval exists. Participants/jurors must arrange lawful, non-confidential review material separately for the local demo.
- Predictable rotating selection and public ballots provide no secure randomness, Sybil/collusion prevention, secret voting, penalties, appeals or reputation. This is not an audited production protocol.
- Case discovery is bounded but scan-based; counts/rewards may be incomplete until older ID pages are loaded. Event history may need older block pages. A durable, reorg-aware, idempotent backend index remains future work. Historical code queries must be supported by the RPC.
- One local confirmation and memory-only duplicate tracking are existing development policies. Simulation cannot prevent changes before mining; contracts enforce final authorization/state/accounting. Reload loses uncertain client records: check receipts before retrying.
- Finalization, claims and withdrawals require transactions and gas; there is no keeper, automatic reward transfer, fallback administrator or collateral override. Unclaimed rewards remain reserved indefinitely.
- No new MetaMask/hardware-wallet/Firefox/Safari/public-chain/audit claim is made. Manual Phase 3D MetaMask review remains a separate step. Existing dependency limitations from earlier phase documents are unchanged.

Phase 3D stops here for review. Authenticated metadata/evidence storage, backend APIs and event indexing require a new approved phase; no later phase is started automatically.
