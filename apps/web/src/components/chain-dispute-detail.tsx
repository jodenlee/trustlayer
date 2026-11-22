"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useCaseDetail } from "@/lib/blockchain/hooks/use-arbitration";
import {
  caseActions,
  caseRole,
  caseStage,
  settlementAllocation,
  VOTES,
} from "@/lib/blockchain/arbitration";
import { executeCaseAction } from "@/lib/blockchain/arbitration-actions";
import {
  chainDate,
  MILESTONE_STATES,
  validEvidenceHash,
} from "@/lib/blockchain/projects";
import { timeUntil } from "@/lib/format";
import {
  Button,
  Card,
  CardBody,
  CardHeading,
  Disclosure,
  EmptyState,
  Field,
  Hash,
  Input,
  KeyValue,
  Notice,
  PageHeading,
  StatusBadge,
  TimelineItem,
} from "./ui";
import { ReviewedAction } from "./reviewed-action";
import { Money } from "./money";
import { ChainHistory } from "./chain-history";
import { useWorkflowInput } from "./workflow-provider";
import { PrivateFiles, fileAssociationUrl } from "./private-files";
import { backendRequest } from "@/lib/auth-client";
import type { FileRecord } from "@/lib/files";
import { deploymentScope } from "@/lib/blockchain/session";
import { useUi } from "./providers";

const ZERO = /^0x0{64}$/i;
const voteEffect = [
  "",
  "The milestone amount goes to the freelancer, minus the 1% service fee.",
  "The full milestone amount is refunded to the client.",
  "Half goes to the freelancer (minus the service fee) and half to the client.",
];
export function ChainDisputeDetail({ id }: { id: bigint }) {
  const read = useCaseDetail(id);
  const [attachment, setAttachment] = useState<{
    file: FileRecord;
    scope: string;
  }>();
  const { toast } = useUi();
  const [response, setResponse] = useWorkflowInput(
    read.deployment.data?.manifest,
    read.deployment.address,
    `response:${id}`,
  );
  const view = read.view;
  if (!view)
    return (
      <>
        <Link className="back-link" href="/disputes">
          <ArrowLeft size={14} aria-hidden="true" />
          Disputes
        </Link>
        <PageHeading title={`Dispute #${id}`} />
        <Card>
          <EmptyState
            title={
              !read.deployment.ready
                ? "Waiting for the local network"
                : read.error
                  ? "Dispute unavailable"
                  : "Loading dispute…"
            }
            description={
              read.error instanceof Error
                ? read.error.message
                : "The case loads once your wallet and the contracts are verified."
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
  const manifest = read.deployment.data!.manifest;
  const canSeeFiles = ["Client", "Freelancer", "Juror"].includes(role);
  const files = (category: "response" | "evidence") =>
    canSeeFiles ? (
      <PrivateFiles
        key={`${deploymentScope(manifest)}:${account}:${id}`}
        manifest={manifest}
        projectId={d.projectId}
        index={Number(d.milestoneIndex)}
        disputeId={id}
        category={category}
        canUpload={
          role !== "Juror" && d.status === 1 && view.now < d.responseDeadline
        }
        onSelected={
          category === "response"
            ? (file) => {
                setResponse(file.content_hash);
                setAttachment({ file, scope: deploymentScope(manifest) });
              }
            : undefined
        }
      />
    ) : null;

  const stageCopy = {
    "Response window": {
      title: "Waiting for a response",
      text: `The other party can respond until ${chainDate(d.responseDeadline)} (${timeUntil(d.responseDeadline, view.now)}). Juror voting starts after that.`,
    },
    "Voting open": {
      title: "Jurors are voting",
      text: `Voting closes ${chainDate(d.votingDeadline)} (${timeUntil(d.votingDeadline, view.now)}). Two matching votes decide the outcome; without a majority, funds split 50/50.`,
    },
    "Ready to finalize": {
      title: "Voting has closed",
      text: "Anyone can now finalize the case. The contract computes the outcome and settles the milestone exactly once.",
    },
    Finalized: {
      title: d.fallbackApplied ? "50/50 fallback" : VOTES[d.ruling],
      text: `Finalized ${chainDate(d.finalizedAt)}. The outcome was computed by the contract from the jurors’ votes.`,
    },
  }[stage];

  return (
    <>
      <Link className="back-link" href="/disputes">
        <ArrowLeft size={14} aria-hidden="true" />
        Disputes
      </Link>
      <PageHeading
        eyebrow={
          <>
            <StatusBadge status={stage} />
            <span className="chip">
              {role === "Viewer"
                ? "Viewing only"
                : `You’re the ${role.toLowerCase()}`}
            </span>
          </>
        }
        title={`Dispute #${id}`}
        description={
          <>
            Milestone {Number(d.milestoneIndex) + 1} of{" "}
            <Link className="text-link" href={`/projects/${d.projectId}`}>
              Project #{d.projectId.toString()}
            </Link>{" "}
            · <Money amount={d.milestoneAmount} />{" "}
            {d.status === 2 ? "settled" : "frozen"}
          </>
        }
      />
      {!read.deployment.ready && (
        <p role="status" className="small text-muted mb-4">
          Rechecking the network. Showing the last verified case; actions are
          paused.
        </p>
      )}
      <div className="grid-main">
        <div className="stack">
          <section
            className={`next-step ${d.status === 2 ? "neutral" : stage === "Ready to finalize" ? "warning" : ""}`}
            aria-label="Case status"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="eyebrow-label">
                {d.status === 2 ? "OUTCOME" : "CURRENT STAGE"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={read.isFetching}
                onClick={() => void read.refetch()}
              >
                <RefreshCw size={13} aria-hidden="true" />
                Refresh case
              </Button>
            </div>
            <h2>{stageCopy.title}</h2>
            <p>{stageCopy.text}</p>
            {d.status === 2 && (
              <dl
                className="breakdown"
                data-testid="case-settlement"
                aria-label="Settlement"
              >
                <div>
                  <dt>Freelancer gross ({d.freelancerBps / 100}%)</dt>
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
                  <dt>Client refund</dt>
                  <dd>
                    <Money amount={allocation.clientRefund} />
                  </dd>
                </div>
                <div>
                  <dt>Freelancer net</dt>
                  <dd>
                    <Money amount={allocation.freelancerNet} />
                  </dd>
                </div>
              </dl>
            )}
            {allowed.respond && (
              <div className="action-box" aria-label="Your response">
                <h3>Your response</h3>
                <p className="small text-muted">
                  You can record one response before the deadline. Upload your
                  evidence privately; its fingerprint is recorded on-chain.
                </p>
                {files("response")}
                <Field
                  id="response-hash"
                  label="Response evidence hash"
                  hint="Filled in automatically after a private upload."
                >
                  <Input
                    id="response-hash"
                    spellCheck={false}
                    value={response}
                    placeholder="0x followed by 64 hexadecimal characters"
                    onChange={(e) => setResponse(e.target.value.trim())}
                  />
                </Field>
                <div className="button-row">
                  <ReviewedAction
                    title="Record response hash"
                    closeAfterConfirmed={false}
                    details={details}
                    disabled={read.isFetching || !validEvidenceHash(response)}
                    submit={(context) =>
                      executeCaseAction(context, "respond", id, response)
                    }
                    onConfirmed={async (receipt, context) => {
                      if (
                        attachment?.scope ===
                          deploymentScope(context.manifest) &&
                        attachment.file.content_hash ===
                          response.toLowerCase() &&
                        attachment.file.project_id === String(d.projectId) &&
                        attachment.file.milestone_index ===
                          Number(d.milestoneIndex) &&
                        attachment.file.dispute_id === String(id) &&
                        attachment.file.uploader ===
                          context.account.toLowerCase()
                      ) {
                        try {
                          await backendRequest(
                            fileAssociationUrl(
                              context.manifest,
                              attachment.file.id,
                            ),
                            "POST",
                            {
                              transactionHash: receipt.transactionHash,
                              disputeId: String(id),
                            },
                          );
                        } catch {
                          toast(
                            "Response confirmed on-chain. Retry the private file association separately; do not resubmit the response.",
                          );
                        }
                      }
                    }}
                  >
                    <p>
                      Record this response fingerprint once. This doesn’t upload
                      files, extend deadlines or change the jurors.
                    </p>
                    <p className="mt-2 small">
                      <Hash value={response} />
                    </p>
                  </ReviewedAction>
                </div>
              </div>
            )}
            {role === "Juror" && d.status !== 2 && (
              <div className="action-box" aria-label="Your vote">
                <h3>Your recorded vote: {VOTES[view.vote]}</h3>
                <div className="vote-options">
                  {[1, 2, 3].map((vote) => (
                    <ReviewedAction
                      key={vote}
                      variant="secondary"
                      title={`Vote: ${VOTES[vote]}`}
                      details={details}
                      disabled={!allowed.vote || read.isFetching}
                      submit={(context) =>
                        executeCaseAction(context, "vote", id, vote)
                      }
                    >
                      <p>
                        <strong>{VOTES[vote]}.</strong> {voteEffect[vote]} Your
                        vote is public and can’t be changed. Two matching votes
                        decide the ruling; the case is finalized after voting
                        closes.
                      </p>
                    </ReviewedAction>
                  ))}
                </div>
                <p className="small text-muted">
                  {allowed.vote
                    ? "Votes are public and permanent once confirmed."
                    : view.vote !== 0
                      ? "You have already voted."
                      : stage === "Response window"
                        ? "Voting opens when the response deadline is reached."
                        : "Voting is closed for this case."}
                </p>
              </div>
            )}
            {allowed.finalize && (
              <div className="button-row">
                <ReviewedAction
                  title="Finalize dispute"
                  details={details}
                  disabled={read.isFetching}
                  submit={(context) =>
                    executeCaseAction(context, "finalize", id)
                  }
                >
                  <p>
                    The contract computes the ruling from the recorded votes,
                    settles the disputed milestone once, releases the jurors’
                    locked stake and reserves their rewards. You don’t choose
                    the outcome.
                  </p>
                </ReviewedAction>
              </div>
            )}
            {d.status !== 2 && !allowed.finalize && (
              <p className="small text-muted">
                Finalization becomes available to anyone strictly after the
                voting deadline, even if jurors abstain.
              </p>
            )}
            {role === "Juror" && d.status === 2 && (
              <div className="action-box" aria-label="Juror reward">
                <h3>
                  Claimable reward: <Money amount={view.claimable} />
                </h3>
                <p className="small text-muted">
                  {view.claimed
                    ? "Your 4 mUSD reward was claimed for this case."
                    : "Every assigned juror, including those who didn’t vote, can claim 4 mUSD once."}
                </p>
                {allowed.claim && (
                  <div className="button-row">
                    <ReviewedAction
                      title="Claim 4 mUSD reward"
                      details={{ ...details, amount: view.claimable }}
                      disabled={read.isFetching}
                      submit={(context) =>
                        executeCaseAction(context, "claim", id)
                      }
                    >
                      <p>
                        Claim this case’s fixed juror reward to your own wallet.
                        It can only be claimed once.
                      </p>
                    </ReviewedAction>
                  </div>
                )}
              </div>
            )}
            {role === "Viewer" && (
              <p className="small text-muted">
                You’re not a party or juror in this case. You can finalize it
                after the voting deadline, but can’t respond, vote or claim
                rewards.
              </p>
            )}
          </section>
          <Card label="Evidence">
            <CardHeading
              title="Evidence"
              description="Only the opening and response fingerprints are recorded on-chain. Files stay private to the parties and assigned jurors."
            />
            <CardBody>
              <div className="address-line">
                <span className="label">Opening evidence</span>
                <Hash value={d.evidenceHash} />
              </div>
              <div className="address-line">
                <span className="label">Response</span>
                {ZERO.test(d.responseHash) ? (
                  <span className="small text-muted">No response recorded</span>
                ) : (
                  <Hash value={d.responseHash} />
                )}
              </div>
              {!allowed.respond && canSeeFiles && (
                <div className="mt-3">{files("evidence")}</div>
              )}
              <p className="small text-faint mt-3">
                Parties can add supplementary files until the response deadline.
                Those files are kept off-chain and remain readable by the
                parties and assigned jurors after the case closes.
              </p>
            </CardBody>
          </Card>
          <Card label="Jurors">
            <CardHeading
              title="Jurors"
              description="Three jurors assigned by deterministic rotation. Votes are public."
            />
            <CardBody className="pt-1!">
              {d.jurors.map((juror, index) => (
                <div className="address-line" key={juror}>
                  <span className="label">
                    {VOTES[view.ballots[index]]}
                    {juror.toLowerCase() === account.toLowerCase() && " (you)"}
                  </span>
                  <Hash value={juror} label="Copy juror address" />
                </div>
              ))}
            </CardBody>
          </Card>
          <ChainHistory projectIds={[d.projectId]} detail disputeIds={[id]} />
        </div>
        <aside className="stack" aria-label="Case summary">
          <Card label="Timeline">
            <CardHeading title="Timeline" />
            <CardBody>
              <ol className="steps">
                <TimelineItem
                  title="Dispute opened"
                  detail={chainDate(d.openedAt)}
                  state="done"
                />
                <TimelineItem
                  title="Response deadline (12 hours)"
                  detail={chainDate(d.responseDeadline)}
                  state={stage === "Response window" ? "current" : "done"}
                />
                <TimelineItem
                  title="Voting deadline (24 hours)"
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
                  title="Finalized"
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
              </ol>
            </CardBody>
          </Card>
          <Card label="Parties">
            <CardHeading title="Parties" />
            <CardBody className="pt-1!">
              {(
                [
                  ["Client", d.client],
                  ["Freelancer", d.freelancer],
                  ["Opened by (paid 15 mUSD)", d.opener],
                ] as const
              ).map(([label, address]) => (
                <div className="address-line" key={label}>
                  <span className="label">
                    {label}
                    {address.toLowerCase() === account.toLowerCase() &&
                      " (you)"}
                  </span>
                  <Hash value={address} label={`Copy ${label} address`} />
                </div>
              ))}
            </CardBody>
          </Card>
          <Disclosure summary="Technical details">
            <KeyValue
              stacked
              items={[
                {
                  label: "Milestone state",
                  value: MILESTONE_STATES[view.milestoneState],
                },
                {
                  label: "Juror collateral",
                  value:
                    view.assignment.state === 2
                      ? "Unlocked for this case"
                      : view.assignment.state === 1
                        ? "100 mUSD locked per assigned juror"
                        : "Assignment unavailable",
                },
                {
                  label: "Treasury fee (3 mUSD)",
                  value: view.feeReceived
                    ? "Received on-chain"
                    : "Not received yet",
                },
                {
                  label: "Total service fees (all projects)",
                  value: <Money amount={view.treasuryServiceFees} />,
                },
                {
                  label: "Total dispute fees (all cases)",
                  value: <Money amount={view.treasuryDisputeFees} />,
                },
                { label: "Latest chain time", value: chainDate(view.now) },
              ]}
            />
            <Notice tone="neutral" className="mt-3">
              <p>
                Deadlines use blockchain time. Responses must arrive before the
                response deadline; votes are accepted from that deadline until
                the voting deadline inclusive.
              </p>
            </Notice>
          </Disclosure>
        </aside>
      </div>
    </>
  );
}
