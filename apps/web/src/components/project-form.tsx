"use client";
import { useState, type FormEvent } from "react";
import { ArrowLeft, Info, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { parseMUSD, formatMUSD } from "@/lib/format";
import { Button, Card, CardHeading, Field, Input, PageHeading } from "./ui";
import { Dialog } from "./dialog";

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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [freelancer, setFreelancer] = useState("");
  const [milestones, setMilestones] = useState<DraftMilestone[]>([
    blankMilestone(),
  ]);
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const total = milestones.reduce(
    (sum, m) => sum + (parseMUSD(m.amount) ?? 0n),
    0n,
  );
  function update(index: number, key: keyof DraftMilestone, value: string) {
    setMilestones((current) =>
      current.map((m, i) => (i === index ? { ...m, [key]: value } : m)),
    );
  }
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    let failure = "";
    if (!title.trim() || !description.trim())
      failure = "Add a project name and scope before reviewing.";
    else if (
      !/^0x[\da-fA-F]{40}$/.test(freelancer) ||
      /^0x0{40}$/i.test(freelancer)
    )
      failure =
        "Enter a non-zero, 42-character Ethereum wallet address for the freelancer.";
    else {
      let previous = Date.now() + 7 * 24 * 60 * 60 * 1000;
      for (let i = 0; i < milestones.length; i++) {
        const m = milestones[i];
        const due = Date.parse(`${m.due}T00:00:00Z`);
        if (!m.title.trim()) {
          failure = `Add a name for milestone ${i + 1}.`;
          break;
        }
        if (parseMUSD(m.amount) === null) {
          failure = `Milestone ${i + 1} needs a positive mUSD amount with at most six decimal places, within uint256.`;
          break;
        }
        if (!Number.isFinite(due) || due <= previous) {
          failure =
            i === 0
              ? "The first due date must be more than 7 days from now to leave room for acceptance (UTC)."
              : "Milestone due dates must be in strictly increasing order (UTC).";
          break;
        }
        previous = due;
      }
      if (total > (1n << 256n) - 1n)
        failure =
          "The combined milestone budget exceeds the contract amount limit.";
    }
    setError(failure);
    if (!failure) setReview(true);
  }
  return (
    <>
      <Link href="/projects" className="back-link">
        <ArrowLeft size={14} />
        All projects
      </Link>
      <PageHeading
        title="Start with a clear agreement"
        description="Define the work and milestones. This form prepares a local draft only."
      />
      <form noValidate onSubmit={onSubmit}>
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
                  hint="An EVM address. No wallet or account is queried in this preview."
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
                    Drafts stay in this page’s memory. Nothing is uploaded,
                    saved to a backend, or sent on-chain.
                  </p>
                </div>
                <Button className="w-full mt-5" type="submit">
                  Review draft
                </Button>
              </div>
            </Card>
          </div>
        </div>
        {error && (
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
          Creating and funding a project will require a connected wallet and an
          explicit transaction in a later phase. This draft has not been
          submitted.
        </p>
        <Button className="w-full mt-5" disabled>
          Create project · wallet required
        </Button>
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
