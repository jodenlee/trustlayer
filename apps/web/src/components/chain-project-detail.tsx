"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { useChainProject } from "@/lib/blockchain/hooks/use-projects";
import { useProtocolTransaction } from "@/lib/blockchain/hooks/use-protocol-transaction";
import {
  executeEscrowAction,
  type EscrowAction,
} from "@/lib/blockchain/escrow-actions";
import {
  PROJECT_STATES,
  MILESTONE_STATES,
  chainDate,
  normalAllocation,
  projectActions,
  projectRole,
  validEvidenceHash,
} from "@/lib/blockchain/projects";
import { deploymentScope } from "@/lib/blockchain/session";
import { describeError } from "@/lib/blockchain/errors";
import { useWorkflowSession } from "./workflow-provider";
import { usePreview } from "./providers";
import {
  Button,
  Card,
  CardHeading,
  EmptyState,
  Field,
  Input,
  PageHeading,
  StatusBadge,
} from "./ui";
import { Dialog } from "./dialog";
import { Money } from "./money";
import { LiveWalletCard } from "./live-wallet";
import { TransactionFeedback } from "./transaction-feedback";
import { ChainHistory } from "./chain-history";

const labels: Record<EscrowAction, string> = {
  approveToken: "Approve exact mUSD allowance",
  fund: "Fund escrow",
  accept: "Accept project",
  submit: "Submit milestone",
  approve: "Approve & pay milestone",
  release: "Release after review timeout",
};
export function ChainProjectDetail({ id }: { id: bigint }) {
  const read = useChainProject(id);
  const tx = useProtocolTransaction();
  const session = useWorkflowSession();
  const { toast } = usePreview();
  const [action, setAction] = useState<EscrowAction>();
  const [reviewContext, setReviewContext] = useState<{
    scope: string;
    actor: string;
    projectId: bigint;
    milestoneIndex?: number;
  }>();
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState("");
  const view = read.view;
  const config = read.deployment.data;
  const project = view?.project;
  const account = read.deployment.address;
  const metadata =
    project && config
      ? session.metadata(
          deploymentScope(config.manifest),
          id,
          project.metadataHash,
        )
      : undefined;
  const busy = tx.isBusy();
  const sameReviewContext =
    !!config &&
    !!reviewContext &&
    reviewContext.scope === deploymentScope(config.manifest) &&
    reviewContext.actor === account?.toLowerCase() &&
    reviewContext.projectId === id &&
    (reviewContext.milestoneIndex === undefined ||
      reviewContext.milestoneIndex === project?.currentMilestone);
  function reviewAction(kind: EscrowAction) {
    if (!config || !account) return;
    setReviewContext({
      scope: deploymentScope(config.manifest),
      actor: account.toLowerCase(),
      projectId: id,
      milestoneIndex: ["submit", "approve", "release"].includes(kind)
        ? project?.currentMilestone
        : undefined,
    });
    setAction(kind);
  }
  const actionAllowed =
    !!action &&
    !!project &&
    !!account &&
    !!view &&
    projectActions(project, account, view.now)[
      action === "approveToken" ? "fund" : action
    ];
  async function confirm() {
    if (!action || !project) return;
    const kind = action;
    if (!sameReviewContext) {
      setError(
        "The wallet, deployment or milestone changed. Review this action again before signing.",
      );
      setAction(undefined);
      return;
    }
    setAction(undefined);
    setError("");
    try {
      const receipt = await tx.execute(
        (context) =>
          executeEscrowAction(
            context,
            kind,
            id,
            evidence,
            undefined,
            reviewContext!.milestoneIndex,
          ),
        {
          kind: labels[kind],
          expectedScope: reviewContext!.scope,
          projectId: id,
          milestoneIndex: ["submit", "approve", "release"].includes(kind)
            ? project.currentMilestone
            : undefined,
          amount:
            kind === "fund" || kind === "approveToken"
              ? project.total
              : kind === "approve" || kind === "release"
                ? project.milestones[project.currentMilestone]?.amount
                : undefined,
        },
      );
      if (receipt?.status === "success") {
        toast(`${labels[kind]} confirmed.`);
        setEvidence("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : describeError(e).message);
    }
  }
  return (
    <>
      <Link href="/projects" className="back-link">
        <ArrowLeft size={14} />
        All projects
      </Link>
      <PageHeading
        title={metadata?.title ?? `Project #${id}`}
        eyebrow="ON-CHAIN AGREEMENT"
        description={
          metadata
            ? `${metadata.description} · Descriptive metadata exists only in this browser session.`
            : "Titles and descriptions are not stored on-chain. Session metadata is unavailable for this project."
        }
      />
      <TransactionFeedback state={tx.state} />
      {error && (
        <p role="alert" className="form-error my-4">
          {error}
        </p>
      )}
      {busy && (
        <p className="info-note my-4">
          A wallet request is pending or unconfirmed. Wait for its receipt, or
          check{" "}
          <Link className="text-link" href="/transactions">
            Transactions
          </Link>{" "}
          before retrying.
        </p>
      )}
      {!read.deployment.ready && <LiveWalletCard />}
      {read.deployment.ready && read.isError && (
        <Card>
          <EmptyState
            title="Project unavailable"
            description={
              read.error instanceof Error
                ? read.error.message
                : "Refresh the verified project data."
            }
            action={
              <Button variant="secondary" onClick={() => void read.refetch()}>
                Retry project
              </Button>
            }
          />
        </Card>
      )}
      {read.deployment.ready && !view && !read.isError && (
        <div role="status" className="empty-state">
          Loading project from escrow…
        </div>
      )}
      {view && project && account && (
        <>
          <div className="detail-grid">
            <div className="space-y-5">
              <Card>
                <CardHeading
                  title="Agreement & funding"
                  action={
                    <StatusBadge status={PROJECT_STATES[project.state]} />
                  }
                />
                <div className="card-body pt-0!">
                  <dl className="summary-list">
                    <div>
                      <dt>Your role</dt>
                      <dd>{projectRole(project, account)}</dd>
                    </div>
                    <div>
                      <dt>Budget</dt>
                      <dd>
                        <Money amount={project.total} />
                      </dd>
                    </div>
                    <div>
                      <dt>Remaining escrow</dt>
                      <dd>
                        <Money amount={project.escrowRemaining} />
                      </dd>
                    </div>
                    <div>
                      <dt>Acceptance deadline</dt>
                      <dd>{chainDate(project.acceptBy)}</dd>
                    </div>
                    <div>
                      <dt>Latest read chain time</dt>
                      <dd>{chainDate(view.now)}</dd>
                    </div>
                  </dl>
                  {projectActions(project, account, view.now).fund && (
                    <div className="mt-5 space-y-3">
                      <p className="small text-muted">
                        Wallet balance <Money amount={view.balance} /> · Escrow
                        allowance <Money amount={view.allowance} />
                      </p>
                      {view.balance < project.total && (
                        <p
                          className="form-error"
                          role="alert"
                          aria-label="Funding balance"
                        >
                          Insufficient mUSD balance for the full budget. Tokens
                          must be provisioned outside this app.
                        </p>
                      )}
                      {view.allowance < project.total ? (
                        <Button
                          disabled={
                            busy ||
                            read.isFetching ||
                            view.balance < project.total
                          }
                          onClick={() => reviewAction("approveToken")}
                        >
                          1. Approve exact mUSD allowance
                        </Button>
                      ) : (
                        <p className="small text-muted">
                          Allowance is sufficient. Approval has not funded
                          escrow.
                        </p>
                      )}
                      <Button
                        className="ml-2"
                        disabled={
                          busy ||
                          read.isFetching ||
                          view.balance < project.total ||
                          view.allowance < project.total
                        }
                        onClick={() => reviewAction("fund")}
                      >
                        2. Fund escrow
                      </Button>
                      <p className="small text-muted">
                        These are two separate transactions. Funding stays
                        disabled until the confirmed allowance is read from the
                        token.
                      </p>
                    </div>
                  )}
                  {projectActions(project, account, view.now).accept && (
                    <Button
                      className="mt-5"
                      disabled={busy || read.isFetching}
                      onClick={() => reviewAction("accept")}
                    >
                      Accept project
                    </Button>
                  )}
                  {project.state < 2 && view.now > project.acceptBy && (
                    <p className="small text-muted mt-4">
                      The acceptance deadline has passed. Funding and acceptance
                      are unavailable. Refund actions are not part of Phase 3C.
                    </p>
                  )}
                </div>
              </Card>
              <Card>
                <CardHeading
                  title="Milestones"
                  description="Contract order, amounts and deadlines. Indexes are zero-based on-chain."
                />
                <ol className="milestone-list">
                  {project.milestones.map((m, index) => {
                    const available = projectActions(
                      project,
                      account,
                      view.now,
                    );
                    const current = index === project.currentMilestone;
                    const allocation = normalAllocation(
                      m.amount,
                      project.feeBps,
                    );
                    return (
                      <li className="milestone-row" key={index}>
                        <span className="milestone-number">{index + 1}</span>
                        <div className="milestone-content">
                          <div className="milestone-top">
                            <h3>
                              {metadata?.milestones[index] ??
                                `Milestone ${index + 1}`}
                            </h3>
                            <Money amount={m.amount} />
                          </div>
                          <div className="milestone-meta">
                            <StatusBadge status={MILESTONE_STATES[m.state]} />
                            <span>Due {chainDate(m.dueAt)}</span>
                          </div>
                          {m.submittedAt > 0n && (
                            <p className="small text-muted mt-3">
                              Submitted {chainDate(m.submittedAt)} · Review
                              deadline {chainDate(m.reviewEnd)}
                            </p>
                          )}
                          {m.evidenceHash !== `0x${"0".repeat(64)}` && (
                            <p className="wallet-address mt-3">
                              Public evidence hash: {m.evidenceHash}
                            </p>
                          )}
                          {m.state === 2 && (
                            <p className="info-note mt-4">
                              <LockKeyhole size={14} />
                              Frozen for arbitration. Approval, timeout release
                              and submission are unavailable. Dispute actions
                              are outside this phase.
                            </p>
                          )}
                          {m.state === 3 && (
                            <p className="small text-muted mt-3">
                              Settled once. Load the matching on-chain
                              settlement event below for the actual freelancer
                              allocation, refund and fee; a settled milestone
                              does not imply a full freelancer payout.
                            </p>
                          )}
                          {current && available.submit && (
                            <div className="mt-4 space-y-3">
                              <Field
                                id="submission-hash"
                                label="Non-sensitive content hash"
                                hint="Only this 32-byte hash is public. Never paste private deliverables. Secure uploads and evidence storage come in a later backend phase."
                              >
                                <Input
                                  id="submission-hash"
                                  aria-describedby="submission-hash-hint"
                                  placeholder="0x followed by 64 hexadecimal characters"
                                  value={evidence}
                                  onChange={(e) =>
                                    setEvidence(e.target.value.trim())
                                  }
                                />
                              </Field>
                              <Button
                                disabled={
                                  busy ||
                                  read.isFetching ||
                                  !validEvidenceHash(evidence)
                                }
                                onClick={() => reviewAction("submit")}
                              >
                                Submit milestone
                              </Button>
                            </div>
                          )}
                          {current && m.state === 1 && (
                            <div className="milestone-actions">
                              <div className="small text-muted">
                                Full freelancer payout if approved: gross{" "}
                                <Money amount={allocation.gross} /> · Service
                                fee <Money amount={allocation.serviceFee} /> ·
                                Net <Money amount={allocation.freelancerNet} />
                              </div>
                              {available.approve && (
                                <Button
                                  disabled={busy || read.isFetching}
                                  onClick={() => reviewAction("approve")}
                                >
                                  Approve & pay milestone
                                </Button>
                              )}
                              {available.release && (
                                <Button
                                  disabled={busy || read.isFetching}
                                  onClick={() => reviewAction("release")}
                                >
                                  Release after review timeout
                                </Button>
                              )}
                              {projectRole(project, account) === "Freelancer" &&
                                !available.release && (
                                  <p className="small text-muted">
                                    Timeout release requires chain time strictly
                                    after the review deadline.
                                  </p>
                                )}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </Card>
            </div>
            <div className="space-y-5">
              <Card>
                <CardHeading title="Participants" />
                <div className="card-body pt-0!">
                  <p className="small text-muted">Client</p>
                  <code className="wallet-address">{project.client}</code>
                  <p className="small text-muted mt-4">Freelancer</p>
                  <code className="wallet-address">{project.freelancer}</code>
                  <p className="small text-muted mt-4">Acting wallet</p>
                  <code className="wallet-address">{account}</code>
                </div>
              </Card>
              <Card>
                <CardHeading title="Protocol accounting" />
                <div className="card-body pt-0!">
                  <p className="small text-muted">
                    Service fee: {project.feeBps / 100}% of freelancer gross,
                    rounded down in base units.
                  </p>
                  <p className="small text-muted mt-4">
                    Treasury service fees received across all projects:
                  </p>
                  <Money amount={view.treasuryRevenue} />
                  <p className="small text-muted mt-4">
                    This is cumulative protocol revenue, not the fee for this
                    project alone. The matching MilestoneSettled event below
                    records this milestone’s actual fee.
                  </p>
                  <p className="wallet-address mt-4">
                    Metadata hash: {project.metadataHash}
                  </p>
                  <Button
                    variant="secondary"
                    className="mt-4"
                    disabled={read.isFetching}
                    onClick={() => void read.refetch()}
                  >
                    Refresh project
                  </Button>
                </div>
              </Card>
            </div>
          </div>
          <div className="mt-6">
            <ChainHistory projectIds={[id]} detail />
          </div>
        </>
      )}
      <Dialog
        open={!!action}
        onClose={() => setAction(undefined)}
        title={action ? labels[action] : "Review action"}
      >
        <p>
          Act as {account ?? "your connected wallet"} on Hardhat Local for
          project #{id.toString()}.
        </p>
        {!sameReviewContext && (
          <p className="wallet-warning mt-3">
            The wallet, deployment or milestone changed. Close this dialog and
            review the action again.
          </p>
        )}
        <p className="small text-muted mt-4">
          {action === "approveToken"
            ? "This grants the escrow exactly the required project amount as allowance. It does not deposit tokens or accept the project."
            : action === "fund"
              ? "This transfers the full budget from your wallet into escrow. It is separate from token approval."
              : action === "approve" || action === "release"
                ? "This permanently settles the current milestone, paying freelancer net of the 1% service fee. It cannot be paid twice."
                : action === "submit"
                  ? "Only the non-sensitive evidence hash will be stored publicly on-chain. No files will be uploaded."
                  : "Accepting activates the funded agreement for this freelancer wallet."}
        </p>
        {project && ["fund", "approveToken"].includes(action ?? "") && (
          <p className="mt-4">
            <Money amount={project.total} />
          </p>
        )}
        {project &&
          project.milestones[project.currentMilestone] &&
          ["approve", "release"].includes(action ?? "") && (
            <div className="small text-muted mt-4">
              <p>
                Milestone {project.currentMilestone + 1} · Gross{" "}
                <Money
                  amount={project.milestones[project.currentMilestone].amount}
                />
              </p>
              <p>
                Service fee{" "}
                <Money
                  amount={
                    normalAllocation(
                      project.milestones[project.currentMilestone].amount,
                      project.feeBps,
                    ).serviceFee
                  }
                />{" "}
                · Freelancer net{" "}
                <Money
                  amount={
                    normalAllocation(
                      project.milestones[project.currentMilestone].amount,
                      project.feeBps,
                    ).freelancerNet
                  }
                />
              </p>
            </div>
          )}
        <Button
          className="w-full mt-5"
          disabled={
            busy ||
            !read.deployment.ready ||
            read.isFetching ||
            !actionAllowed ||
            !sameReviewContext
          }
          onClick={() => void confirm()}
        >
          Confirm in wallet
        </Button>
      </Dialog>
    </>
  );
}
