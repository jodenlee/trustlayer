"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { parseMUSD, formatMUSD } from "@/lib/format";
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeading,
  Field,
  Input,
  KeyValue,
  Notice,
  PageHeading,
} from "./ui";
import { Dialog } from "./dialog";
import { useRouter } from "next/navigation";
import { useVerifiedDeployment } from "@/lib/blockchain/hooks/use-protocol";
import { useProtocolTransaction } from "@/lib/blockchain/hooks/use-protocol-transaction";
import { localClient } from "@/lib/blockchain/config";
import { createEscrowProject } from "@/lib/blockchain/escrow-actions";
import {
  createdProjectFromReceipt,
  validateProjectDraft,
  type ProjectDraft,
} from "@/lib/blockchain/projects";
import { deploymentScope } from "@/lib/blockchain/session";
import { useWorkflowSession } from "./workflow-provider";
import { useUi } from "./providers";
import { TransactionFeedback } from "./transaction-feedback";
import { describeError, IntegrationError } from "@/lib/blockchain/errors";
import { useBackendAuth } from "./auth-provider";
import { syncConfirmedProject } from "@/lib/metadata-client";
import {
  classifyUnmined,
  nonceGapMessage,
  type PoolClient,
} from "@/lib/blockchain/pool";

interface DraftMilestone {
  title: string;
  description?: string;
  amount: string;
  due: string;
}
const blankMilestone = (): DraftMilestone => ({
  title: "",
  amount: "",
  due: "",
});
export function ProjectForm() {
  const deployment = useVerifiedDeployment();
  const tx = useProtocolTransaction();
  const session = useWorkflowSession();
  const router = useRouter();
  const { toast } = useUi();
  const auth = useBackendAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [freelancer, setFreelancer] = useState("");
  const [milestones, setMilestones] = useState<DraftMilestone[]>([
    blankMilestone(),
  ]);
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [synchronizing, setSynchronizing] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const creatingRef = useRef(false);
  const dialogFeedback = useRef<HTMLDivElement>(null);
  const [creationConfirmed, setCreationConfirmed] = useState(false);
  const [reviewedDraft, setReviewedDraft] = useState<{
    draft: ProjectDraft;
    prepared: ReturnType<typeof validateProjectDraft>;
  }>();
  const [reviewContext, setReviewContext] = useState<{
    scope: string;
    actor: string;
  }>();
  const sameReviewContext =
    !!reviewContext &&
    !!deployment.verified &&
    reviewContext.scope === deploymentScope(deployment.verified.manifest) &&
    reviewContext.actor === deployment.address?.toLowerCase();
  useEffect(() => {
    if (review && (tx.state.phase !== "idle" || error))
      dialogFeedback.current?.scrollIntoView({ block: "nearest" });
  }, [review, tx.state.phase, error]);
  const total = milestones.reduce(
    (sum, m) => sum + (parseMUSD(m.amount) ?? 0n),
    0n,
  );
  function update(index: number, key: keyof DraftMilestone, value: string) {
    setMilestones((current) =>
      current.map((m, i) => (i === index ? { ...m, [key]: value } : m)),
    );
  }
  // An unresolved creation from this form: reopen it instead of a new draft.
  const pendingCreation =
    tx.state.phase === "unconfirmed" && !!tx.state.hash && !!reviewedDraft;
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pendingCreation) {
      setReview(true);
      return;
    }
    if (creatingRef.current || tx.isBusy() || creationConfirmed) {
      setError(
        "A project request is already pending or confirmed. Check Transactions before creating another project.",
      );
      return;
    }
    setReviewing(true);
    try {
      const now = deployment.ready
        ? (await localClient.getBlock({ blockTag: "latest" })).timestamp
        : BigInt(Math.floor(Date.now() / 1000));
      const draft = {
        title,
        description,
        freelancer,
        milestones: milestones.map((m) => ({ ...m })),
      };
      const prepared = validateProjectDraft(draft, now, deployment.address);
      setReviewedDraft({ draft, prepared });
      setError("");
      setReviewContext(
        deployment.verified && deployment.address
          ? {
              scope: deploymentScope(deployment.verified.manifest),
              actor: deployment.address.toLowerCase(),
            }
          : undefined,
      );
      setReview(true);
    } catch (failure) {
      setError(
        failure instanceof IntegrationError
          ? failure.message
          : "Unable to read chain time. Check the local node before reviewing.",
      );
    } finally {
      setReviewing(false);
    }
  }
  /**
   * After a canonical successful receipt: read the project ID from that
   * receipt's logs and synchronize metadata idempotently. Never sends another
   * blockchain transaction; also used when a delayed receipt is recovered.
   */
  async function finishCreation(
    transactionHash: `0x${string}`,
    config: NonNullable<typeof deployment.verified>,
    account: `0x${string}`,
    draft: ProjectDraft,
    prepared: ReturnType<typeof validateProjectDraft>,
  ) {
    setCreationConfirmed(true);
    const receipt = await localClient.getTransactionReceipt({
      hash: transactionHash,
    });
    const id = await createdProjectFromReceipt(
      receipt.logs,
      config.contracts.TrustEscrow.address,
      account,
    );
    session.saveMetadata(
      deploymentScope(config.manifest),
      id,
      prepared.metadata,
    );
    let synchronized = false;
    if (auth.session?.address === account.toLowerCase()) {
      setSynchronizing(true);
      const sync = await syncConfirmedProject(config.manifest, id, {
        title: draft.title,
        description: draft.description,
        milestones: draft.milestones.map((m, index) => ({
          index,
          name: m.title,
          description: m.description?.trim() || m.title,
        })),
      });
      synchronized = sync.synced;
    }
    toast(
      auth.session
        ? synchronized
          ? `Project #${id} created on-chain. Metadata synchronized. Funding is a separate step.`
          : `Project #${id} created on-chain. Metadata not synchronized; retry in Project metadata. Do not create another project.`
        : `Project #${id} created. Funding is a separate step.`,
    );
    setReview(false);
    router.push(`/projects/${id}`);
  }
  /**
   * Re-check an unresolved creation by its original hash. Success completes
   * the same creation; a revert frees the form for a new attempt; anything
   * else keeps the attempt blocked with the node's explanation.
   */
  async function recheckCreation() {
    const hash = tx.state.hash;
    const config = deployment.verified;
    const account = deployment.address;
    if (!hash || !reviewedDraft || rechecking) return;
    if (!config || !account) {
      setError(
        "The local network is being re-verified. Wait for it (or use Retry verification), then check the receipt again. Do not resubmit.",
      );
      return;
    }
    setRechecking(true);
    setError("");
    const attempt = session
      .attempts()
      .find((a) => a.state.hash?.toLowerCase() === hash.toLowerCase());
    try {
      const receipt = await localClient
        .getTransactionReceipt({ hash })
        .catch(() => undefined);
      if (!receipt) {
        const status = await classifyUnmined(
          localClient as unknown as PoolClient,
          hash,
        );
        setError(
          status.kind === "nonce-gap"
            ? nonceGapMessage(status.nonce, status.expected)
            : status.kind === "unknown"
              ? "The local node has no record of this transaction. It may have been sent to a different network. It is not confirmed; check MetaMask's network before retrying."
              : status.kind === "nonce-used"
                ? "Another transaction from this wallet used the same nonce, so this one can no longer be mined. Check Transactions before creating the project again."
                : "Still waiting to be mined. Check again shortly; do not resubmit.",
        );
        return;
      }
      const sent = await localClient.getTransaction({ hash });
      if (
        sent.from.toLowerCase() !== account.toLowerCase() ||
        sent.to?.toLowerCase() !==
          config.contracts.TrustEscrow.address.toLowerCase()
      )
        throw new Error(
          "This receipt does not belong to a project creation by this wallet.",
        );
      if (attempt)
        session.update(attempt.id, {
          ...attempt.state,
          phase: receipt.status === "success" ? "confirmed" : "reverted",
          blockNumber: receipt.blockNumber,
          message:
            receipt.status === "success"
              ? "Receipt verified after a delayed confirmation."
              : "The mined transaction reverted.",
        });
      if (receipt.status !== "success") {
        tx.reset();
        setError(
          "The transaction was mined but reverted, so no project was created. You can review and submit again.",
        );
        return;
      }
      await finishCreation(
        hash,
        config,
        account,
        reviewedDraft.draft,
        reviewedDraft.prepared,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : describeError(e).message);
    } finally {
      setRechecking(false);
    }
  }
  async function createProject() {
    const config = deployment.verified;
    const account = deployment.address;
    if (creatingRef.current || tx.isBusy() || creationConfirmed) {
      setError(
        "A project request is already pending or confirmed. Check Transactions before retrying.",
      );
      return;
    }
    creatingRef.current = true;
    setCreating(true);
    setError("");
    try {
      if (!account)
        throw new IntegrationError(
          "disconnected",
          "Connect your client wallet before creating a project.",
        );
      if (!deployment.supported)
        throw new IntegrationError(
          "network",
          "Switch your wallet to Hardhat Local (31337).",
        );
      if (!config)
        throw new IntegrationError(
          "deployment",
          "The deployment is not verified. Check the local node and exported manifest, then review again.",
        );
      if (!sameReviewContext || !reviewedDraft)
        throw new IntegrationError(
          "disconnected",
          "The wallet or deployment changed. Review the draft again before signing.",
        );
      const { draft, prepared } = reviewedDraft;
      // Start observable lifecycle tracking before any asynchronous write preflight.
      // createEscrowProject revalidates the reviewed draft using fresh chain time.
      const result = await tx.execute(
        (context) => createEscrowProject(context, draft),
        {
          kind: "Project created",
          amount: prepared.total,
          expectedScope: reviewContext!.scope,
        },
      );
      if (!result) return;
      await finishCreation(
        result.transactionHash,
        config,
        account,
        draft,
        prepared,
      );
    } catch (e) {
      setError(
        e instanceof IntegrationError
          ? describeError(e).message
          : e instanceof Error
            ? e.message
            : "Project creation failed. Check transaction history before retrying.",
      );
    } finally {
      creatingRef.current = false;
      setCreating(false);
      setSynchronizing(false);
    }
  }
  return (
    <>
      <Link href="/projects" className="back-link">
        <ArrowLeft size={14} aria-hidden="true" />
        Projects
      </Link>
      <PageHeading
        title="New project"
        description="Describe the work, choose the freelancer and set milestones. You’ll fund escrow after the project is created."
      />
      {!review && (
        <div className="mb-4">
          <TransactionFeedback state={tx.state} />
        </div>
      )}
      <form noValidate onSubmit={(event) => void onSubmit(event)}>
        <div className="grid-main">
          <div className="stack">
            <Card label="Project">
              <CardHeading title="Project" />
              <CardBody className="form-stack">
                <Field id="project-title" label="Project name">
                  <Input
                    id="project-title"
                    maxLength={100}
                    placeholder="e.g. Brand & website refresh"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </Field>
                <Field
                  id="scope"
                  label="Scope of work"
                  hint="What will be delivered and how it will be reviewed. Don’t include confidential material."
                >
                  <textarea
                    id="scope"
                    className="textarea"
                    aria-describedby="scope-hint"
                    maxLength={2000}
                    placeholder="What will be delivered, and how will it be reviewed?"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    required
                  />
                </Field>
                <Field
                  id="freelancer"
                  label="Freelancer wallet address"
                  hint="Ask the freelancer for their wallet address. Only that wallet can accept the project."
                >
                  <Input
                    id="freelancer"
                    aria-describedby="freelancer-hint"
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="0x…"
                    value={freelancer}
                    onChange={(e) => setFreelancer(e.target.value.trim())}
                    required
                  />
                </Field>
              </CardBody>
            </Card>
            <Card label="Milestones">
              <CardHeading
                title="Milestones"
                description="One to five milestones, delivered and paid in order. Due dates are in UTC."
              />
              <ol className="milestones mt-3">
                {milestones.map((m, i) => (
                  <li key={i} className="milestone">
                    <span className="milestone-number" aria-hidden="true">
                      {i + 1}
                    </span>
                    <div className="form-stack min-w-0">
                      <div className="flex items-end gap-2">
                        <div className="flex-1 min-w-0">
                          <Field
                            id={`milestone-${i}-title`}
                            label="Deliverable"
                          >
                            <Input
                              id={`milestone-${i}-title`}
                              placeholder="e.g. Discovery & direction"
                              value={m.title}
                              maxLength={120}
                              onChange={(e) =>
                                update(i, "title", e.target.value)
                              }
                            />
                          </Field>
                        </div>
                        {milestones.length > 1 && (
                          <Button
                            variant="ghost"
                            className="icon-button"
                            aria-label={`Remove milestone ${i + 1}`}
                            onClick={() =>
                              setMilestones((current) =>
                                current.filter((_, j) => j !== i),
                              )
                            }
                          >
                            <Trash2 size={15} />
                          </Button>
                        )}
                      </div>
                      <div className="field-grid">
                        <Field
                          id={`milestone-${i}-amount`}
                          label="Amount (mUSD)"
                        >
                          <Input
                            id={`milestone-${i}-amount`}
                            inputMode="decimal"
                            placeholder="0.00"
                            value={m.amount}
                            onChange={(e) =>
                              update(i, "amount", e.target.value)
                            }
                          />
                        </Field>
                        <Field id={`milestone-${i}-due`} label="Due date (UTC)">
                          <Input
                            id={`milestone-${i}-due`}
                            type="date"
                            value={m.due}
                            onChange={(e) => update(i, "due", e.target.value)}
                          />
                        </Field>
                      </div>
                      <Field
                        id={`milestone-${i}-description`}
                        label="Milestone description (optional)"
                      >
                        <textarea
                          className="textarea"
                          id={`milestone-${i}-description`}
                          maxLength={4000}
                          rows={2}
                          value={m.description ?? ""}
                          onChange={(e) =>
                            update(i, "description", e.target.value)
                          }
                        />
                      </Field>
                    </div>
                  </li>
                ))}
              </ol>
              <CardFooter>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={milestones.length >= 5}
                  onClick={() =>
                    setMilestones((current) => [...current, blankMilestone()])
                  }
                >
                  <Plus size={14} aria-hidden="true" />
                  Add milestone {milestones.length >= 5 && "(limit reached)"}
                </Button>
              </CardFooter>
            </Card>
          </div>
          <aside className="sticky-side">
            <Card label="Summary">
              <CardHeading title="Summary" />
              <CardBody className="stack-sm">
                <KeyValue
                  items={[
                    { label: "Payment token", value: "MockUSD (mUSD)" },
                    { label: "Milestones", value: `${milestones.length} of 5` },
                    { label: "Service fee", value: "1% of each payout" },
                    { label: "Review window", value: "72 hours" },
                  ]}
                />
                <div className="figures figures-1">
                  <div>
                    <dt>Project budget</dt>
                    <dd className="money">
                      {formatMUSD(total)} <span className="currency">mUSD</span>
                    </dd>
                  </div>
                </div>
                <p className="small text-muted">
                  You fund the full budget into escrow. The service fee is taken
                  from the freelancer’s payouts, not added to your budget.
                </p>
                <Notice tone="neutral">
                  <p>
                    The project name and descriptions are saved privately after
                    creation. Only a fingerprint, wallet addresses, amounts and
                    deadlines go on-chain.
                  </p>
                </Notice>
                <Button
                  className="btn-block"
                  type="submit"
                  disabled={
                    reviewing ||
                    creating ||
                    (tx.isBusy() && !pendingCreation) ||
                    creationConfirmed
                  }
                >
                  {reviewing
                    ? "Checking draft…"
                    : pendingCreation
                      ? "Check pending creation"
                      : "Review draft"}
                </Button>
                {error && !review && (
                  <p
                    role="alert"
                    aria-label="Draft validation"
                    className="form-error"
                  >
                    {error}
                  </p>
                )}
              </CardBody>
            </Card>
          </aside>
        </div>
      </form>
      <Dialog
        open={review}
        onClose={() => setReview(false)}
        title="Review your project draft"
      >
        <div className="stack-sm">
          <span className="chip w-fit">Local draft · not created</span>
          <div>
            <h3>{title}</h3>
            <p className="small text-muted mt-1 whitespace-pre-wrap break-words">
              {description}
            </p>
          </div>
          <KeyValue
            items={[
              { label: "Milestones", value: milestones.length },
              { label: "Budget", value: `${formatMUSD(total)} mUSD` },
            ]}
          />
          <p className="small text-muted">
            {deployment.ready
              ? "This creates an unfunded project with you as the client. Check the amounts and dates — they can’t be changed later. Funding is a separate step afterwards."
              : "Connect a wallet to a verified local deployment to create this project. This is still an unsubmitted local draft."}{" "}
            Creating needs a little local ETH for gas, but no mUSD.
          </p>
          {!deployment.ready && deployment.isConnected && (
            <Notice tone="warning" role="status">
              <p>
                {!deployment.supported
                  ? "Switch your wallet to Hardhat Local (31337)."
                  : deployment.error
                    ? describeError(deployment.error).message
                    : "Verifying the local deployment. Wait for verification before signing."}
              </p>
            </Notice>
          )}
          <div ref={dialogFeedback} className="stack-sm">
            <TransactionFeedback state={tx.state} />
            {error && (
              <p
                role="alert"
                aria-label="Project creation"
                className="form-error"
              >
                {error}
              </p>
            )}
          </div>
          <Button
            className="btn-block"
            disabled={
              !deployment.ready ||
              creating ||
              tx.isBusy() ||
              creationConfirmed ||
              !sameReviewContext
            }
            onClick={() => void createProject()}
          >
            {synchronizing
              ? "Project confirmed · saving details…"
              : creating
                ? "Creating project…"
                : creationConfirmed
                  ? "Project confirmed · check Transactions"
                  : deployment.ready
                    ? "Create project in wallet"
                    : "Create project · not enabled"}
          </Button>
          {tx.state.phase === "unconfirmed" && tx.state.hash && (
            <Button
              variant="secondary"
              className="btn-block"
              disabled={rechecking || creating}
              onClick={() => void recheckCreation()}
            >
              {rechecking ? "Checking receipt…" : "Check receipt again"}
            </Button>
          )}
          {deployment.ready && !sameReviewContext && (
            <p className="small text-muted">
              The connection changed since draft review. Continue editing, then
              review again.
            </p>
          )}
          <Button
            className="btn-block"
            variant="ghost"
            onClick={() => setReview(false)}
          >
            Continue editing
          </Button>
        </div>
      </Dialog>
    </>
  );
}
