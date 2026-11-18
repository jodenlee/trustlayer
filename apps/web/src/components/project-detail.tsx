"use client";
import Link from "next/link";
import { ArrowLeft, Check, Info, LockKeyhole, UserRound } from "lucide-react";
import type { Project } from "@/lib/models";
import { disputes, totalProjectAmount } from "@/lib/preview-data";
import { dateLabel } from "@/lib/format";
import {
  Button,
  Card,
  CardHeading,
  EmptyState,
  MilestoneProgress,
  PageHeading,
  StatusBadge,
  TextLink,
} from "./ui";
import { Money } from "./money";
import { usePreview } from "./providers";
export function ProjectDetail({ project }: { project: Project }) {
  const { sample } = usePreview();
  if (!sample)
    return (
      <>
        <PageHeading
          title="Project details"
          description="No account project has been loaded."
        />
        <Card>
          <EmptyState
            title="You’re viewing an empty workspace"
            description="Switch to sample data to explore this illustrative project."
            action={<TextLink href="/projects">Back to projects</TextLink>}
          />
        </Card>
      </>
    );
  const completed = project.milestones.filter(
    (m) => m.state === "Approved",
  ).length;
  return (
    <>
      <Link className="back-link" href="/projects">
        <ArrowLeft size={14} />
        All projects
      </Link>
      <PageHeading
        eyebrow={`${project.id.toUpperCase()} · SAMPLE PROJECT`}
        title={project.title}
        description={project.description}
        action={<StatusBadge status={project.state} />}
      />
      <div className="detail-grid">
        <div className="space-y-5">
          <Card>
            <div className="card-body">
              <div className="flex items-center justify-between gap-5">
                <div>
                  <p className="small text-muted">Project budget</p>
                  <p className="text-xl font-semibold text-navy mt-1">
                    <Money amount={totalProjectAmount(project)} />
                  </p>
                </div>
                <div>
                  <p className="small text-muted mb-2">Milestone progress</p>
                  <MilestoneProgress
                    completed={completed}
                    total={project.milestones.length}
                  />
                </div>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeading
              title="Milestones"
              description="Sequential delivery. Explicit review. One settlement per milestone."
            />
            <ol className="milestone-list">
              {project.milestones.map((m, i) => {
                const dispute = disputes.find(
                  (d) => d.projectId === project.id && d.milestoneIndex === i,
                );
                return (
                  <li className="milestone-row" key={m.title}>
                    <span
                      className={`milestone-number ${m.state === "Approved" ? "complete" : ""}`}
                    >
                      {m.state === "Approved" ? (
                        <Check size={14} />
                      ) : (
                        String(i + 1).padStart(2, "0")
                      )}
                    </span>
                    <div className="milestone-content">
                      <div className="milestone-top">
                        <h3>{m.title}</h3>
                        <Money amount={m.amount} />
                      </div>
                      <div className="milestone-meta">
                        <StatusBadge status={m.state} />
                        <span>Due {dateLabel(m.due)}</span>
                      </div>
                      {m.state === "Submitted" && (
                        <div className="milestone-actions">
                          <Button disabled>Review & approve</Button>
                          <span className="small text-muted">
                            72-hour review window · wallet integration required
                          </span>
                        </div>
                      )}
                      {dispute && (
                        <div className="milestone-actions">
                          <LockKeyhole size={15} className="text-muted" />
                          <span className="small text-muted">
                            Frozen for arbitration
                          </span>
                          <TextLink href={`/disputes/${dispute.id}`}>
                            View case
                          </TextLink>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
          <div className="info-note">
            <Info size={15} />
            <p>
              Actions are unavailable in this preview. Evidence files will stay
              private and off-chain; only content hashes belong on-chain.
            </p>
          </div>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeading title="Project participants" />
            <div className="card-body pt-0!">
              {[
                { label: "Client", name: project.client },
                { label: "Freelancer", name: project.freelancer },
              ].map((person) => (
                <div className="person-row" key={person.label}>
                  <span className="person-avatar">
                    <UserRound size={15} />
                  </span>
                  <div>
                    <p className="small text-muted">{person.label}</p>
                    <strong>{person.name}</strong>
                    <p className="small text-muted">
                      Sample identity · wallet unavailable
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeading title="Escrow overview" />
            <div className="card-body pt-0!">
              <dl className="summary-list">
                <div>
                  <dt>Funding state</dt>
                  <dd>Funded (sample)</dd>
                </div>
                <div>
                  <dt>Remaining escrow</dt>
                  <dd>
                    <Money amount={project.escrowed} />
                  </dd>
                </div>
                <div>
                  <dt>Service fee</dt>
                  <dd>1% of freelancer payout</dd>
                </div>
                <div>
                  <dt>Your preview role</dt>
                  <dd>{project.role}</dd>
                </div>
              </dl>
              <div className="info-note mt-5">
                <LockKeyhole size={14} />
                <p>
                  Principal, juror stake, and treasury revenue are accounted for
                  separately.
                </p>
              </div>
              {project.state === "Awaiting acceptance" && (
                <>
                  <Button className="w-full mt-5" disabled>
                    Accept project
                  </Button>
                  <p className="small text-muted mt-2">
                    The freelancer has 7 days after funding to accept.
                  </p>
                </>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
