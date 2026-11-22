"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Check, LockKeyhole, RefreshCw } from "lucide-react";
import { useChainProject } from "@/lib/blockchain/hooks/use-projects";
import { useProtocolTransaction } from "@/lib/blockchain/hooks/use-protocol-transaction";
import {
  executeEscrowAction,
  type EscrowAction,
} from "@/lib/blockchain/escrow-actions";
import {
  PROJECT_STATES,
  chainDate,
  normalAllocation,
  projectActions,
  projectRole,
  validEvidenceHash,
  type ChainMilestone,
  type ChainProject,
} from "@/lib/blockchain/projects";
import { deploymentScope } from "@/lib/blockchain/session";
import { describeError } from "@/lib/blockchain/errors";
import { timeUntil } from "@/lib/format";
import { useWorkflowSession } from "./workflow-provider";
import { useUi } from "./providers";
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
  LoadingRow,
  Notice,
  PageHeading,
  StatusBadge,
} from "./ui";
import { Dialog } from "./dialog";
import { Money } from "./money";
import { TransactionFeedback } from "./transaction-feedback";
import { ChainHistory } from "./chain-history";
import { ProjectArbitration } from "./project-arbitration";
import {
  usePersistentProject,
  ProjectMetadataEditor,
} from "./project-metadata";
import { PrivateFiles, fileAssociationUrl } from "./private-files";
import { backendRequest } from "@/lib/auth-client";
import type { FileRecord } from "@/lib/files";

const labels: Record<EscrowAction, string> = {
  approveToken: "Approve mUSD for escrow",
  fund: "Fund escrow",
  accept: "Accept project",
  submit: "Submit milestone",
  approve: "Approve & pay milestone",
  release: "Release payment after review period",
};
const roleText = {
  Client: "You’re the client",
  Freelancer: "You’re the freelancer",
  Viewer: "Viewing only",
};
function milestoneStatus(
  project: ChainProject,
  m: ChainMilestone,
  index: number,
) {
  if (m.state === 3) return "Settled";
  if (m.state === 2) return "Disputed";
  if (m.state === 1) return "In review";
  return index === project.currentMilestone && project.state === 2
    ? "Active"
    : "Pending";
}
function PayoutBreakdown({
  amount,
  feeBps,
}: {
  amount: bigint;
  feeBps: number;
}) {
  const allocation = normalAllocation(amount, feeBps);
  return (
    <dl className="breakdown" aria-label="Payout if approved">
      <div>
        <dt>Milestone amount</dt>
        <dd>
          <Money amount={allocation.gross} />
        </dd>
      </div>
      <div>
        <dt>Service fee ({feeBps / 100}%)</dt>
        <dd>
          <Money amount={allocation.serviceFee} />
        </dd>
      </div>
      <div>
        <dt>Freelancer receives</dt>
        <dd>
          <Money amount={allocation.freelancerNet} />
        </dd>
      </div>
    </dl>
  );
}
export function ChainProjectDetail({ id }: { id: bigint }) {
  const read = useChainProject(id);
  const tx = useProtocolTransaction();
  const session = useWorkflowSession();
  const { toast } = useUi();
  const [action, setAction] = useState<EscrowAction>();
  const [reviewContext, setReviewContext] = useState<{
    scope: string;
    actor: string;
    projectId: bigint;
    milestoneIndex?: number;
  }>();
  const [evidence, setEvidence] = useState("");
  const [selectedFile, setSelectedFile] = useState<{
    file: FileRecord;
    scope: string;
  }>();
  const [error, setError] = useState("");
  const view = read.view;
  const config = read.deployment.data;
  const project = view?.project;
  const account = read.deployment.address;
  const localMetadata =
    project &&
    config &&
    account &&
    [project.client.toLowerCase(), project.freelancer.toLowerCase()].includes(
      account.toLowerCase(),
    )
      ? session.metadata(
          deploymentScope(config.manifest),
          id,
          project.metadataHash,
        )
      : undefined;
  const persistent = usePersistentProject(config?.manifest, id, !!project);
  const metadata = persistent.project
    ? {
        title: persistent.project.title,
        description: persistent.project.description,
        milestones: project!.milestones.map(
          (_, i) =>
            persistent.project!.milestones.find((m) => m.onchain_index === i)
              ?.name || `Milestone ${i + 1}`,
        ),
      }
    : localMetadata;
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
        if (
          kind === "submit" &&
          config &&
          selectedFile &&
          selectedFile.scope === deploymentScope(config.manifest) &&
          selectedFile.file.uploader === account?.toLowerCase() &&
          selectedFile.file.content_hash === evidence.toLowerCase() &&
          selectedFile.file.project_id === String(id) &&
          selectedFile.file.milestone_index === reviewContext!.milestoneIndex
        ) {
          try {
            await backendRequest(
              fileAssociationUrl(config.manifest, selectedFile.file.id),
              "POST",
              { transactionHash: receipt.transactionHash },
            );
          } catch (e) {
            setError(
              `Milestone confirmed on-chain. File association needs a separate retry: ${e instanceof Error ? e.message : "Backend unavailable."} Do not submit again.`,
            );
          }
        }
        setEvidence("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : describeError(e).message);
    }
  }
  const role = project && account ? projectRole(project, account) : "Viewer";
  const available =
    project && account && view
      ? projectActions(project, account, view.now)
      : undefined;
  const current = project?.milestones[project.currentMilestone];
  const disabled = busy || read.isFetching;

  function nextStep() {
    if (!project || !view || !available) return null;
    const expired = project.state < 2 && view.now > project.acceptBy;
    if (expired)
      return (
        <div className="next-step warning">
          <span className="eyebrow-label">ACCEPTANCE WINDOW CLOSED</span>
          <h2>This project can no longer be funded or accepted</h2>
          <p>
            The acceptance deadline ({chainDate(project.acceptBy)}) has passed.
            Any funded budget remains recorded in escrow; refund handling is not
            available in this interface yet.
          </p>
        </div>
      );
    if (available.fund)
      return (
        <div className="next-step" aria-label="Next step">
          <span className="eyebrow-label">NEXT STEP</span>
          <h2>Fund the escrow</h2>
          <p>
            Deposit the full budget of <Money amount={project.total} />. The
            freelancer can accept once it’s funded, and each milestone is paid
            out only when you approve it. Fund by {chainDate(project.acceptBy)}.
          </p>
          <KeyValue
            items={[
              { label: "Your balance", value: <Money amount={view.balance} /> },
              {
                label: "Approved for escrow",
                value: <Money amount={view.allowance} />,
              },
            ]}
          />
          {view.balance < project.total && (
            <p className="form-error" role="alert" aria-label="Funding balance">
              Insufficient mUSD balance for the full budget. Top up this wallet
              with development tokens first.
            </p>
          )}
          <div className="button-row">
            {view.allowance < project.total ? (
              <Button
                disabled={disabled || view.balance < project.total}
                onClick={() => reviewAction("approveToken")}
              >
                1. Approve mUSD
              </Button>
            ) : (
              <span className="chip">
                <Check size={12} aria-hidden="true" /> mUSD approved
              </span>
            )}
            <Button
              variant={view.allowance < project.total ? "secondary" : "primary"}
              disabled={
                disabled ||
                view.balance < project.total ||
                view.allowance < project.total
              }
              onClick={() => reviewAction("fund")}
            >
              2. Fund escrow
            </Button>
          </div>
          <p className="small text-muted">
            Two separate wallet confirmations: approval lets the escrow contract
            take exactly the budget; funding moves it.
          </p>
        </div>
      );
    if (available.accept)
      return (
        <div className="next-step" aria-label="Next step">
          <span className="eyebrow-label">NEXT STEP</span>
          <h2>Review and accept this project</h2>
          <p>
            The client has funded <Money amount={project.total} /> in escrow.
            Accepting commits you to the milestones below. Accept by{" "}
            {chainDate(project.acceptBy)} (
            {timeUntil(project.acceptBy, view.now)}).
          </p>
          <div className="button-row">
            <Button disabled={disabled} onClick={() => reviewAction("accept")}>
              Accept project
            </Button>
          </div>
        </div>
      );
    const waiting = (title: string, text: React.ReactNode) => (
      <div className="next-step neutral" aria-label="Next step">
        <span className="eyebrow-text">STATUS</span>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
    );
    const n = project.currentMilestone + 1;
    if (project.state === 0)
      return waiting(
        "Waiting for the client to fund escrow",
        <>Funding must happen by {chainDate(project.acceptBy)}.</>,
      );
    if (project.state === 1)
      return waiting(
        "Waiting for the freelancer to accept",
        <>
          The budget is in escrow. Acceptance closes{" "}
          {chainDate(project.acceptBy)}.
        </>,
      );
    if (project.state === 3)
      return waiting(
        "All milestones are settled",
        "This project is complete. Payouts are listed under Activity.",
      );
    if (project.state === 4)
      return waiting(
        "This project is closed",
        "No further actions are possible.",
      );
    if (!current) return null;
    if (current.state === 2)
      return waiting(
        `Milestone ${n} is in dispute`,
        "Its funds are frozen until jurors decide. Follow the case from the milestone below.",
      );
    if (current.state === 1)
      return role === "Client"
        ? waiting(
            `Review milestone ${n}`,
            <>
              Download and check the delivery, then approve payment by{" "}
              {chainDate(current.reviewEnd)}. If there’s a problem you can open
              a dispute instead.
            </>,
          )
        : waiting(
            `Milestone ${n} is with the client for review`,
            <>
              The review window ends {chainDate(current.reviewEnd)}. After that,
              you can release the payment yourself.
            </>,
          );
    return role === "Freelancer"
      ? waiting(
          `Deliver milestone ${n}`,
          <>
            Upload your work privately and submit it by{" "}
            {chainDate(current.dueAt)} (a 48-hour grace period applies).
          </>,
        )
      : waiting(
          `Milestone ${n} is in progress`,
          <>The freelancer’s delivery is due {chainDate(current.dueAt)}.</>,
        );
  }

  return (
    <>
      <Link href="/projects" className="back-link">
        <ArrowLeft size={14} aria-hidden="true" />
        Projects
      </Link>
      <PageHeading
        eyebrow={
          project && account ? (
            <>
              <StatusBadge status={PROJECT_STATES[project.state]} />
              <span className="chip">{roleText[role]}</span>
            </>
          ) : undefined
        }
        title={metadata?.title ?? `Project #${id}`}
        description={
          metadata
            ? metadata.description
            : project
              ? "No saved description for this project."
              : undefined
        }
      />
      <div className="stack">
        <TransactionFeedback state={tx.state} />
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {busy && (
          <Notice tone="info">
            <p>
              A wallet request is pending. Wait for its confirmation, or check{" "}
              <Link className="text-link" href="/transactions">
                Transactions
              </Link>{" "}
              before retrying.
            </p>
          </Notice>
        )}
        {view && !read.deployment.ready && (
          <p role="status" className="small text-muted">
            Rechecking the network. Showing the last verified project; actions
            are paused.
          </p>
        )}
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
          <LoadingRow label="Loading project from escrow…" />
        )}
        {view && project && account && available && (
          <div className="grid-main">
            <div className="stack">
              {nextStep()}
              <Card label="Milestones">
                <CardHeading
                  title="Milestones"
                  description="Delivered and paid in order. The client has 72 hours to review each submission."
                />
                <ol className="milestones mt-3">
                  {project.milestones.map((m, index) => {
                    const isCurrent =
                      index === project.currentMilestone && project.state === 2;
                    const status = milestoneStatus(project, m, index);
                    const name =
                      metadata?.milestones[index] ?? `Milestone ${index + 1}`;
                    const files = config && (
                      <PrivateFiles
                        key={`${deploymentScope(config.manifest)}:${account}:${index}`}
                        manifest={config.manifest}
                        projectId={id}
                        index={index}
                        category="deliverable"
                        canUpload={isCurrent && available.submit}
                        onSelected={(file) => {
                          setEvidence(file.content_hash);
                          setSelectedFile({
                            file,
                            scope: deploymentScope(config.manifest),
                          });
                        }}
                      />
                    );
                    const hasEvidence =
                      m.evidenceHash !== `0x${"0".repeat(64)}`;
                    return (
                      <li
                        className={`milestone ${isCurrent ? "current" : ""} ${m.state === 3 ? "settled" : ""}`}
                        key={index}
                        id={`milestone-${index + 1}`}
                      >
                        <span className="milestone-number" aria-hidden="true">
                          {m.state === 3 ? <Check size={13} /> : index + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="milestone-top">
                            <h3>{name}</h3>
                            <Money amount={m.amount} />
                          </div>
                          <div className="milestone-meta">
                            <StatusBadge status={status} />
                            <span>Due {chainDate(m.dueAt)}</span>
                            {m.submittedAt > 0n && (
                              <span>Submitted {chainDate(m.submittedAt)}</span>
                            )}
                            {m.state === 1 && (
                              <span>
                                Review deadline {chainDate(m.reviewEnd)}
                              </span>
                            )}
                          </div>
                          {isCurrent ? (
                            <div className="milestone-work">
                              {m.state === 2 && (
                                <Notice tone="warning">
                                  <p>
                                    <LockKeyhole
                                      size={13}
                                      className="inline mr-1"
                                      aria-hidden="true"
                                    />
                                    Frozen while the dispute is resolved.
                                    Approval, submission and release are
                                    unavailable.
                                  </p>
                                </Notice>
                              )}
                              {available.submit && (
                                <div
                                  className="action-box"
                                  aria-label="Deliver milestone"
                                >
                                  <h3>Deliver this milestone</h3>
                                  {files}
                                  <Field
                                    id="submission-hash"
                                    label="Deliverable fingerprint (SHA-256)"
                                    hint="Filled in automatically after a private upload. Only this fingerprint is recorded publicly; never paste file contents."
                                  >
                                    <Input
                                      id="submission-hash"
                                      aria-describedby="submission-hash-hint"
                                      spellCheck={false}
                                      placeholder="0x followed by 64 hexadecimal characters"
                                      value={evidence}
                                      onChange={(e) =>
                                        setEvidence(e.target.value.trim())
                                      }
                                    />
                                  </Field>
                                  <div className="button-row">
                                    <Button
                                      disabled={
                                        disabled || !validEvidenceHash(evidence)
                                      }
                                      onClick={() => reviewAction("submit")}
                                    >
                                      Submit milestone
                                    </Button>
                                  </div>
                                </div>
                              )}
                              {m.state === 1 && (
                                <div
                                  className="action-box"
                                  aria-label="Review milestone"
                                >
                                  <h3>
                                    {role === "Client"
                                      ? "Review the delivery"
                                      : "Waiting for client review"}
                                  </h3>
                                  {hasEvidence && (
                                    <p className="small text-muted">
                                      Submitted fingerprint{" "}
                                      <Hash value={m.evidenceHash} />
                                    </p>
                                  )}
                                  {files}
                                  <PayoutBreakdown
                                    amount={m.amount}
                                    feeBps={project.feeBps}
                                  />
                                  <div className="button-row">
                                    {available.approve && (
                                      <Button
                                        disabled={disabled}
                                        onClick={() => reviewAction("approve")}
                                      >
                                        Approve & pay milestone
                                      </Button>
                                    )}
                                    {available.release && (
                                      <Button
                                        disabled={disabled}
                                        onClick={() => reviewAction("release")}
                                      >
                                        Release payment after review period
                                      </Button>
                                    )}
                                  </div>
                                  {role === "Freelancer" &&
                                    !available.release && (
                                      <p className="small text-muted">
                                        You can release the payment yourself
                                        strictly after the review deadline (
                                        {timeUntil(m.reviewEnd, view.now)}).
                                      </p>
                                    )}
                                </div>
                              )}
                              {!available.submit && m.state === 0 && files}
                              {m.state !== 0 && (
                                <ProjectArbitration
                                  project={project}
                                  index={index}
                                />
                              )}
                            </div>
                          ) : (
                            <>
                              {m.state === 3 && (
                                <p className="small text-muted mt-2">
                                  Settled once. A dispute ruling may have split
                                  or refunded it — see Activity for the exact
                                  payout.
                                </p>
                              )}
                              {m.state !== 0 && (
                                <Disclosure
                                  plain
                                  summary="Files and submission details"
                                  className="mt-2"
                                >
                                  {hasEvidence && (
                                    <p className="small text-muted">
                                      Submitted fingerprint{" "}
                                      <Hash value={m.evidenceHash} />
                                    </p>
                                  )}
                                  {files}
                                  <ProjectArbitration
                                    project={project}
                                    index={index}
                                  />
                                </Disclosure>
                              )}
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </Card>
              <ChainHistory projectIds={[id]} detail />
            </div>
            <aside className="stack" aria-label="Project summary">
              <Card label="Agreement">
                <CardHeading title="Agreement" />
                <CardBody className="pt-2!">
                  <KeyValue
                    items={[
                      {
                        label: "Budget",
                        value: <Money amount={project.total} />,
                      },
                      {
                        label: "In escrow",
                        value: <Money amount={project.escrowRemaining} />,
                      },
                      {
                        label: "Milestones",
                        value: `${project.currentMilestone} of ${project.milestoneCount} settled`,
                      },
                      ...(project.state < 2
                        ? [
                            {
                              label: "Accept by",
                              value: chainDate(project.acceptBy),
                            },
                          ]
                        : []),
                      {
                        label: "Service fee",
                        value: `${project.feeBps / 100}% of payouts`,
                      },
                    ]}
                  />
                </CardBody>
              </Card>
              <Card label="People">
                <CardHeading title="People" />
                <CardBody className="pt-1!">
                  {(
                    [
                      ["Client", project.client],
                      ["Freelancer", project.freelancer],
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
              {role !== "Viewer" && config && (
                <Disclosure summary="Edit project details">
                  <ProjectMetadataEditor
                    key={`${deploymentScope(config.manifest)}:${account}:${persistent.project?.revision ?? "new"}`}
                    manifest={config.manifest}
                    id={id}
                    project={persistent.project}
                    fallback={localMetadata}
                    count={project.milestoneCount}
                  />
                </Disclosure>
              )}
              <Disclosure summary="Technical details">
                <KeyValue
                  stacked
                  items={[
                    { label: "Project ID", value: id.toString() },
                    {
                      label: "Metadata hash (Keccak-256)",
                      value: <Hash value={project.metadataHash} full />,
                    },
                    { label: "Latest chain time", value: chainDate(view.now) },
                    {
                      label: "Description source",
                      value: persistent.project
                        ? "Saved project details"
                        : localMetadata
                          ? "This browser session only"
                          : "Not available",
                    },
                  ]}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  disabled={read.isFetching}
                  onClick={() => void read.refetch()}
                >
                  <RefreshCw size={13} aria-hidden="true" />
                  Refresh project
                </Button>
              </Disclosure>
            </aside>
          </div>
        )}
      </div>
      <Dialog
        open={!!action}
        onClose={() => setAction(undefined)}
        title={action ? labels[action] : "Review action"}
      >
        <div className="stack-sm">
          <p>
            {action === "approveToken"
              ? "Allow the escrow contract to take exactly the project budget from your wallet. This doesn’t deposit anything yet."
              : action === "fund"
                ? "Move the full budget from your wallet into escrow. It stays there until milestones are approved or disputes are settled."
                : action === "approve" || action === "release"
                  ? "Settle the current milestone and pay the freelancer, minus the 1% service fee. A milestone can only be paid once."
                  : action === "submit"
                    ? "Record your deliverable’s fingerprint on-chain and start the client’s 72-hour review window. The file itself stays private."
                    : "Accept this funded project and its milestones."}
          </p>
          {project && ["fund", "approveToken"].includes(action ?? "") && (
            <KeyValue
              items={[
                { label: "Amount", value: <Money amount={project.total} /> },
              ]}
            />
          )}
          {project &&
            project.milestones[project.currentMilestone] &&
            ["approve", "release"].includes(action ?? "") && (
              <PayoutBreakdown
                amount={project.milestones[project.currentMilestone].amount}
                feeBps={project.feeBps}
              />
            )}
          {action === "submit" && (
            <p className="small text-muted">
              Fingerprint <Hash value={evidence} />
            </p>
          )}
          {!sameReviewContext && (
            <Notice tone="warning">
              <p>
                The wallet, deployment or milestone changed. Close this dialog
                and review the action again.
              </p>
            </Notice>
          )}
          <p className="small text-faint">
            Project #{id.toString()} · Acting as{" "}
            {account ?? "your connected wallet"}
          </p>
          <Button
            className="btn-block"
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
        </div>
      </Dialog>
    </>
  );
}
