"use client";
import Link from "next/link";
import { useCaseDetail } from "@/lib/blockchain/hooks/use-arbitration";
import {
  caseActions,
  caseRole,
  caseStage,
  remainingTime,
  settlementAllocation,
  VOTES,
} from "@/lib/blockchain/arbitration";
import { executeCaseAction } from "@/lib/blockchain/arbitration-actions";
import {
  chainDate,
  MILESTONE_STATES,
  validEvidenceHash,
} from "@/lib/blockchain/projects";
import {
  Button,
  Card,
  CardHeading,
  EmptyState,
  Field,
  Input,
  PageHeading,
  StatusBadge,
  TimelineItem,
} from "./ui";
import { ReviewedAction } from "./reviewed-action";
import { Money } from "./money";
import { ChainHistory } from "./chain-history";
import { useWorkflowInput } from "./workflow-provider";

export function ChainDisputeDetail({ id }: { id: bigint }) {
  const read = useCaseDetail(id);
  const [response, setResponse] = useWorkflowInput(
    read.deployment.data?.manifest,
    read.deployment.address,
    `response:${id}`,
  );
  const view = read.view;
  if (!view)
    return (
      <>
        <PageHeading
          title={`Dispute #${id}`}
          description="Public contract state on the verified deployment."
        />
        <Card>
          <EmptyState
            title={
              !read.deployment.ready
                ? "Verify your local connection"
                : read.error
                  ? "Dispute unavailable"
                  : "Loading dispute…"
            }
            description={
              read.error instanceof Error
                ? read.error.message
                : "Connect a wallet on Hardhat Local and verify the deployment. No sample data is used."
            }
            action={
              <Button variant="secondary" onClick={() => void read.refetch()}>
                Retry dispute reads
              </Button>
            }
          />
        </Card>
      </>
    );
  const d = view.dispute;
  const account = read.deployment.address!;
  const role = caseRole(d, account);
  const stage = caseStage(d, view.now);
  const allowed = caseActions(d, account, view.now, view.vote, view.claimable);
  const allocation = settlementAllocation(
    d.milestoneAmount,
    d.freelancerBps,
    view.feeBps,
  );
  const details = {
    disputeId: id,
    projectId: d.projectId,
    milestoneIndex: Number(d.milestoneIndex),
  };
  return (
    <>
      <Link className="back-link" href="/disputes">
        All disputes
      </Link>
      <PageHeading
        eyebrow="ON-CHAIN ARBITRATION"
        title={`Dispute #${id}`}
        description={`Acting as ${role} · Project #${d.projectId} · Milestone index ${d.milestoneIndex}`}
        action={<StatusBadge status={stage} />}
      />
      <div className="detail-grid">
        <div className="space-y-5 order-2 lg:order-1">
          <Card>
            <CardHeading
              title="Case overview"
              action={
                <Link className="text-link" href={`/projects/${d.projectId}`}>
                  View project
                </Link>
              }
            />
            <div className="card-body pt-0!">
              <dl className="summary-list">
                <div>
                  <dt>Disputed milestone</dt>
                  <dd>
                    <Money amount={d.milestoneAmount} />
                  </dd>
                </div>
                <div>
                  <dt>Milestone state</dt>
                  <dd>{MILESTONE_STATES[view.milestoneState]}</dd>
                </div>
                <div>
                  <dt>Case collateral</dt>
                  <dd>
                    {view.assignment.state === 2
                      ? "Unlocked for this case"
                      : view.assignment.state === 1
                        ? "100 mUSD locked per assigned juror"
                        : "Assignment unavailable"}
                  </dd>
                </div>
                <div>
                  <dt>Latest chain time</dt>
                  <dd>{chainDate(view.now)}</dd>
                </div>
              </dl>
              {d.status === 2 ? (
                <div className="mt-5" data-testid="case-settlement">
                  <h3>
                    {d.fallbackApplied ? "50/50 fallback" : VOTES[d.ruling]}
                  </h3>
                  <p className="small text-muted">
                    Finalized on-chain {chainDate(d.finalizedAt)}. Stored
                    freelancer allocation: {d.freelancerBps} bps. The frontend
                    does not choose the ruling.
                  </p>
                  <dl className="summary-list">
                    <div>
                      <dt>Freelancer gross</dt>
                      <dd>
                        <Money amount={allocation.freelancerGross} />
                      </dd>
                    </div>
                    <div>
                      <dt>Service fee (1% of freelancer gross)</dt>
                      <dd>
                        <Money amount={allocation.serviceFee} />
                      </dd>
                    </div>
                    <div>
                      <dt>Freelancer net</dt>
                      <dd>
                        <Money amount={allocation.freelancerNet} />
                      </dd>
                    </div>
                    <div>
                      <dt>Client refund</dt>
                      <dd>
                        <Money amount={allocation.clientRefund} />
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <p className="small text-muted mt-4">
                  Milestone principal remains in escrow, frozen for arbitration.
                  Finalization uses the contract’s two-vote majority or 50/50
                  fallback. No final ruling is displayed before on-chain
                  finalization.
                </p>
              )}
            </div>
          </Card>
          <Card>
            <CardHeading
              title="Evidence references"
              description="Public on-chain hashes. Private files and access-controlled evidence storage are deferred."
            />
            <div className="card-body pt-0! space-y-3">
              <p className="small text-muted">Opening hash</p>
              <code className="wallet-address">{d.evidenceHash}</code>
              <p className="small text-muted">Counterparty response hash</p>
              <code className="wallet-address">
                {/^0x0{64}$/i.test(d.responseHash)
                  ? "No response recorded"
                  : d.responseHash}
              </code>
              <p className="small text-muted">
                A hash alone does not make the referenced evidence available or
                private. Do not enter confidential deliverables or personal
                information.
              </p>
              {allowed.respond && (
                <>
                  <Field
                    id="response-hash"
                    label="Response evidence hash"
                    hint="Only the non-opening participant may record one nonzero bytes32 hash before the response deadline."
                  >
                    <Input
                      id="response-hash"
                      value={response}
                      onChange={(e) => setResponse(e.target.value.trim())}
                    />
                  </Field>
                  <ReviewedAction
                    title="Record response hash"
                    details={details}
                    disabled={read.isFetching || !validEvidenceHash(response)}
                    submit={(context) =>
                      executeCaseAction(context, "respond", id, response)
                    }
                  >
                    <p>
                      Record this public reference once. This does not upload
                      files, extend deadlines or change the jury.
                    </p>
                    <code className="wallet-address">{response}</code>
                  </ReviewedAction>
                </>
              )}
            </div>
          </Card>
          <Card>
            <CardHeading
              title="Assigned jurors"
              description="Three distinct jurors, selected by deterministic rotation. Votes are public and immutable."
            />
            <div className="card-body pt-0! space-y-4">
              {d.jurors.map((juror, index) => (
                <div key={juror}>
                  <code className="wallet-address">{juror}</code>
                  <p className="small text-muted">
                    {VOTES[view.ballots[index]]} ·{" "}
                    {view.assignment.state === 2
                      ? "This case’s 100 mUSD lock released"
                      : "100 mUSD reserved for this case"}
                  </p>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeading title="Participants & fee payer" />
            <div className="card-body pt-0! space-y-3">
              <p className="small">Client</p>
              <code className="wallet-address">{d.client}</code>
              <p className="small">Freelancer</p>
              <code className="wallet-address">{d.freelancer}</code>
              <p className="small">Opener · paid 15 mUSD</p>
              <code className="wallet-address">{d.opener}</code>
              <p className="small">Acting wallet · {role}</p>
              <code className="wallet-address">{account}</code>
            </div>
          </Card>
        </div>
        <div className="space-y-5 order-1 lg:order-2">
          <Card>
            <CardHeading
              title="Case actions"
              description="All permissions and deadlines are checked again before signing."
            />
            <div className="card-body pt-0! space-y-4">
              {role === "Juror" && (
                <>
                  <p>Your recorded vote: {VOTES[view.vote]}</p>
                  <p className="small text-muted">
                    Voting is public. Once confirmed, your ballot cannot be
                    changed.
                  </p>
                  {[1, 2, 3].map((vote) => (
                    <ReviewedAction
                      key={vote}
                      title={`Vote: ${VOTES[vote]}`}
                      details={details}
                      disabled={!allowed.vote || read.isFetching}
                      submit={(context) =>
                        executeCaseAction(context, "vote", id, vote)
                      }
                    >
                      <p>
                        {VOTES[vote]}:{" "}
                        {vote === 1
                          ? "100% gross allocation to the freelancer, less the 1% service fee."
                          : vote === 2
                            ? "100% of milestone principal returned to the client."
                            : "50% gross to the freelancer (less the service fee) and 50% to the client."}{" "}
                        Your vote is public and permanent. Two matching votes
                        determine the ruling; finalization still waits until
                        voting ends.
                      </p>
                    </ReviewedAction>
                  ))}
                  {!allowed.vote && (
                    <p className="small text-muted">
                      {view.vote !== 0
                        ? "You have already voted."
                        : stage === "Response window"
                          ? "Voting is disabled until the response deadline."
                          : "Voting is closed for this case."}
                    </p>
                  )}
                </>
              )}
              {allowed.finalize && (
                <ReviewedAction
                  title="Finalize dispute"
                  details={details}
                  disabled={read.isFetching}
                  submit={(context) =>
                    executeCaseAction(context, "finalize", id)
                  }
                >
                  <p>
                    Anyone may finalize now. The contract computes the ruling,
                    settles the disputed milestone once, releases all three case
                    locks and reserves juror rewards. This transaction supplies
                    no chosen verdict.
                  </p>
                </ReviewedAction>
              )}
              {d.status !== 2 && !allowed.finalize && (
                <p className="small text-muted">
                  Permissionless finalization becomes available strictly after
                  the voting deadline, including if jurors abstain.
                </p>
              )}
              {role === "Juror" && (
                <>
                  <p>
                    Claimable reward: <Money amount={view.claimable} />
                  </p>
                  <p className="small text-muted">
                    {view.claimed
                      ? "Your 4 mUSD reward was claimed for this case."
                      : "Each assigned juror, including abstainers, may claim 4 mUSD after finalization. Reward reserves stay separate from stake and escrow."}
                  </p>
                  {allowed.claim && (
                    <ReviewedAction
                      title="Claim 4 mUSD reward"
                      details={{ ...details, amount: view.claimable }}
                      disabled={read.isFetching}
                      submit={(context) =>
                        executeCaseAction(context, "claim", id)
                      }
                    >
                      <p>
                        Claim this case’s fixed reward to your own wallet
                        exactly once through arbitration. No frontend token
                        transfer or beneficiary override is used.
                      </p>
                    </ReviewedAction>
                  )}
                </>
              )}
              {role === "Viewer" && (
                <p className="small text-muted">
                  This wallet is neither participant nor assigned juror. It may
                  finalize after the deadline, but cannot respond, vote or claim
                  rewards.
                </p>
              )}
              <Button
                variant="ghost"
                disabled={read.isFetching}
                onClick={() => void read.refetch()}
              >
                Refresh case
              </Button>
            </div>
          </Card>
          <Card>
            <CardHeading
              title="Arbitration timeline"
              description={remainingTime(
                stage === "Response window"
                  ? d.responseDeadline
                  : d.votingDeadline,
                view.now,
              )}
            />
            <ul className="timeline">
              <TimelineItem
                title="Opened"
                detail={chainDate(d.openedAt)}
                state="done"
              />
              <TimelineItem
                title="12-hour response deadline"
                detail={chainDate(d.responseDeadline)}
                state={stage === "Response window" ? "current" : "done"}
              />
              <TimelineItem
                title="24-hour voting deadline"
                detail={chainDate(d.votingDeadline)}
                state={
                  stage === "Voting open"
                    ? "current"
                    : d.status === 2 || stage === "Ready to finalize"
                      ? "done"
                      : "upcoming"
                }
              />
              <TimelineItem
                title="Permissionless finalization"
                detail={
                  d.status === 2
                    ? chainDate(d.finalizedAt)
                    : "Strictly after voting closes"
                }
                state={
                  d.status === 2
                    ? "done"
                    : stage === "Ready to finalize"
                      ? "current"
                      : "upcoming"
                }
              />
            </ul>
            <div className="card-body card-divider small text-muted">
              Responses require time before the first deadline. Voting includes
              both boundary timestamps. Only chain time controls these actions.
            </div>
          </Card>
          <Card>
            <CardHeading title="Protocol fee accounting" />
            <div className="card-body pt-0! small text-muted space-y-3">
              <p>
                This case’s 3 mUSD treasury fee:{" "}
                {view.feeReceived ? "Received on-chain" : "Not received"}.
              </p>
              <p>
                All-project cumulative service fees:{" "}
                <Money amount={view.treasuryServiceFees} />
              </p>
              <p>
                All-case cumulative dispute fees:{" "}
                <Money amount={view.treasuryDisputeFees} />
              </p>
              <p>
                The 12 mUSD juror reward reserve stays in arbitration.
                Finalization releases collateral; it does not withdraw a juror’s
                deposited stake.
              </p>
            </div>
          </Card>
        </div>
      </div>
      <div className="mt-6">
        <ChainHistory projectIds={[d.projectId]} detail disputeIds={[id]} />
      </div>
    </>
  );
}
