"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Info, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { parseMUSD, formatMUSD } from "@/lib/format";
import { Button, Card, CardHeading, Field, Input, PageHeading } from "./ui";
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
import { usePreview } from "./providers";
import { TransactionFeedback } from "./transaction-feedback";
import { describeError, IntegrationError } from "@/lib/blockchain/errors";

interface DraftMilestone {
  title: string;
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
  const { toast } = usePreview();
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
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
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
      setCreationConfirmed(true);
      const receipt = await localClient.getTransactionReceipt({
        hash: result.transactionHash,
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
      toast(`Project #${id} created. Funding is a separate step.`);
      setReview(false);
      router.push(`/projects/${id}`);
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
    }
  }
  return (
    <>
      <Link href="/projects" className="back-link">
        <ArrowLeft size={14} />
        All projects
      </Link>
      <PageHeading
        title="Start with a clear agreement"
        description="Define the work and milestones. Titles and descriptions are session-only; the contract stores their metadata hash."
      />
      {!review && <TransactionFeedback state={tx.state} />}
      <form noValidate onSubmit={(event) => void onSubmit(event)}>
        <div className="detail-grid">
          <Card>
            <section className="form-section">
              <h2>Project details</h2>
              <p className="small text-muted">
                Give the agreement a name and make the scope specific.
              </p>
              <div className="form-stack">
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
                  hint="Do not include private deliverables or personal information in on-chain metadata."
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
                  hint="The freelancer’s EVM address. This draft does not query that account."
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
              </div>
            </section>
            <section className="form-section">
              <h2>Milestone plan</h2>
              <p className="small text-muted">
                One to five milestones, delivered and settled in sequence. Due
                dates use UTC.
              </p>
              <div className="form-stack">
                {milestones.map((m, i) => (
                  <div key={i} className="milestone-form">
                    <div className="milestone-form-head">
                      <h3>Milestone {String(i + 1).padStart(2, "0")}</h3>
                      {milestones.length > 1 && (
                        <Button
                          type="button"
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
                    <Field id={`milestone-${i}-title`} label="Deliverable">
                      <Input
                        id={`milestone-${i}-title`}
                        placeholder="e.g. Discovery & direction"
                        value={m.title}
                        maxLength={120}
                        onChange={(e) => update(i, "title", e.target.value)}
                      />
                    </Field>
                    <div className="field-grid mt-4">
                      <Field id={`milestone-${i}-amount`} label="Amount (mUSD)">
                        <Input
                          id={`milestone-${i}-amount`}
                          inputMode="decimal"
                          placeholder="0.00"
                          value={m.amount}
                          onChange={(e) => update(i, "amount", e.target.value)}
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
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={milestones.length >= 5}
                  onClick={() =>
                    setMilestones((current) => [...current, blankMilestone()])
                  }
                >
                  <Plus size={15} />
                  Add milestone {milestones.length >= 5 && "(limit reached)"}
                </Button>
              </div>
            </section>
          </Card>
          <div className="sticky-summary">
            <Card>
              <CardHeading title="Agreement summary" />
              <div className="card-body pt-0!">
                <dl className="summary-list">
                  <div>
                    <dt>Payment token</dt>
                    <dd>MockUSD · 6 decimals</dd>
                  </div>
                  <div>
                    <dt>Milestones</dt>
                    <dd>{milestones.length} of 5</dd>
                  </div>
                  <div>
                    <dt>Service fee</dt>
                    <dd>1% of freelancer payout</dd>
                  </div>
                  <div>
                    <dt>Review period</dt>
                    <dd>72 hours</dd>
                  </div>
                </dl>
                <div className="summary-total">
                  <span>Project budget</span>
                  <span className="money">
                    {formatMUSD(total)} <span className="currency">mUSD</span>
                  </span>
                </div>
                <p className="small text-muted mt-4">
                  The client funds the full budget. Fees are deducted from
                  freelancer payouts, rather than added to this budget.
                </p>
                <div className="info-note mt-5">
                  <Info size={15} />
                  <p>
                    Titles, scope and milestone descriptions stay in browser
                    memory and disappear on refresh. Only a metadata hash,
                    wallet addresses, amounts and deadlines are stored on-chain
                    after confirmation. Do not include confidential content.
                  </p>
                </div>
                <Button
                  className="w-full mt-5"
                  type="submit"
                  disabled={
                    reviewing || creating || tx.isBusy() || creationConfirmed
                  }
                >
                  {reviewing ? "Checking draft…" : "Review draft"}
                </Button>
              </div>
            </Card>
          </div>
        </div>
        {error && !review && (
          <p
            role="alert"
            aria-label="Draft validation"
            className="form-error mt-5"
          >
            {error}
          </p>
        )}
      </form>
      <Dialog
        open={review}
        onClose={() => setReview(false)}
        title="Review your project draft"
      >
        <span className="badge badge-blue">Local draft · not created</span>
        <div ref={dialogFeedback} className="mt-4">
          <TransactionFeedback state={tx.state} />
          {error && (
            <p
              role="alert"
              aria-label="Project creation"
              className="form-error mt-3"
            >
              {error}
            </p>
          )}
        </div>
        <h3 className="mt-4">{title}</h3>
        <p className="small text-muted mt-2 whitespace-pre-wrap break-words">
          {description}
        </p>
        <dl className="summary-list mt-4">
          <div>
            <dt>Milestones</dt>
            <dd>{milestones.length}</dd>
          </div>
          <div>
            <dt>Budget</dt>
            <dd>{formatMUSD(total)} mUSD</dd>
          </div>
        </dl>
        <p className="small text-muted mt-4">
          {deployment.ready
            ? "You will create an unfunded project as the connected client wallet. Review all amounts and deadlines. Creation does not approve tokens or fund escrow."
            : "Connect a wallet to a verified persistent local deployment to create this project. This remains an unsubmitted local draft."}{" "}
          Descriptive metadata is not permanently saved. Creation requires local
          ETH for gas; it does not require mUSD. Token approval and escrow
          funding are separate later steps.
        </p>
        {!deployment.ready && deployment.isConnected && (
          <p role="status" className="wallet-warning mt-3">
            {!deployment.supported
              ? "Switch your wallet to Hardhat Local (31337)."
              : deployment.error
                ? describeError(deployment.error).message
                : "Verifying the local deployment. Wait for verification before signing."}
          </p>
        )}
        <Button
          className="w-full mt-5"
          type="button"
          disabled={
            !deployment.ready ||
            creating ||
            tx.isBusy() ||
            creationConfirmed ||
            !sameReviewContext
          }
          onClick={() => void createProject()}
        >
          {creating
            ? "Creating project…"
            : creationConfirmed
              ? "Project confirmed · check Transactions"
              : deployment.ready
                ? "Create project in wallet"
                : "Create project · not enabled"}
        </Button>
        {deployment.ready && !sameReviewContext && (
          <p className="small text-muted mt-3">
            The connection changed since draft review. Continue editing, then
            review again.
          </p>
        )}
        <Button
          className="w-full mt-2"
          variant="ghost"
          onClick={() => setReview(false)}
        >
          Continue editing
        </Button>
      </Dialog>
    </>
  );
}
