"use client";
import {
  BriefcaseBusiness,
  CircleCheck,
  FileCheck2,
  Gavel,
  LockKeyhole,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { projects, disputes } from "@/lib/preview-data";
import {
  ButtonLink,
  Card,
  CardHeading,
  EmptyState,
  PageHeading,
  StatusBadge,
  TextLink,
} from "./ui";
import { ProjectTable } from "./project-table";
import { StatCard } from "./stats";
import { Money } from "./money";
import { usePreview } from "./providers";
import { LiveWalletCard } from "./live-wallet";

export function Dashboard() {
  const { sample, name } = usePreview();
  const active = projects.filter((p) => p.state === "Active");
  return (
    <>
      <PageHeading
        title={`Welcome back, ${name.trim().split(/\s+/)[0] || "there"}`}
        description="A clear view of your work, funds, and next steps."
        action={
          <ButtonLink href="/projects/new">
            <Plus size={16} />
            New project
          </ButtonLink>
        }
      />
      <div className="mb-6">
        <LiveWalletCard />
      </div>
      <div className="stats-grid">
        <StatCard
          label="Active projects"
          value={sample ? active.length : "—"}
          note={
            sample
              ? "Across client & freelancer roles"
              : "Project data is not integrated yet"
          }
          icon={BriefcaseBusiness}
        />
        <StatCard
          label="Escrowed funds"
          value={
            sample ? (
              <Money
                amount={projects.reduce((sum, p) => sum + p.escrowed, 0n)}
              />
            ) : (
              "—"
            )
          }
          note="Held for unsettled milestones"
          icon={LockKeyhole}
        />
        <StatCard
          label="Pending milestones"
          value={
            sample
              ? projects
                  .flatMap((p) => p.milestones)
                  .filter((m) => m.state === "Pending").length
              : "—"
          }
          note="Upcoming work across projects"
          icon={FileCheck2}
        />
        <StatCard
          label="Open disputes"
          value={sample ? disputes.length : "—"}
          note="Milestone funds remain frozen"
          icon={Gavel}
        />
      </div>
      <div className="dashboard-grid">
        <Card>
          <CardHeading
            title="Active projects"
            description="Keep your current work moving."
            action={<TextLink href="/projects">All projects</TextLink>}
          />
          {sample ? (
            <ProjectTable projects={active} compact />
          ) : (
            <EmptyState
              title="Your next project starts here"
              description="Real project reads are not integrated yet. You can explore the local creation form now."
              action={
                <ButtonLink href="/projects/new" variant="secondary">
                  Explore project form
                </ButtonLink>
              }
            />
          )}
        </Card>
        <Card>
          <CardHeading
            title="Needs attention"
            description="A little clarity on what comes next."
          />
          {sample ? (
            <>
              <div className="attention-item">
                <StatusBadge status="Submitted" />
                <h3>Design system ready for review</h3>
                <p>Brand & website refresh · Milestone 2</p>
                <TextLink href="/projects/tl-1042">Review milestone</TextLink>
              </div>
              <div className="attention-item">
                <StatusBadge status="Voting open" />
                <h3>A case is in its voting window</h3>
                <p>Product launch illustrations · DP-2001</p>
                <TextLink href="/disputes/dp-2001">View dispute</TextLink>
              </div>
            </>
          ) : (
            <EmptyState
              title="All clear for now"
              description="Review requests and dispute notices will appear here."
            />
          )}
        </Card>
      </div>
      <div className="dashboard-lower">
        <Card>
          <CardHeading
            title="Recent activity"
            description={
              sample
                ? "Illustrative workspace activity · not transaction records"
                : "Workspace updates will appear here."
            }
          />
          {sample ? (
            <ul className="activity-list">
              <li>
                <span className="activity-icon">
                  <FileCheck2 size={15} />
                </span>
                <div>
                  <h3>A milestone is ready for review</h3>
                  <p className="small text-muted">
                    Brand & website refresh · Design system
                  </p>
                </div>
                <time dateTime="2026-11-18">18 Nov</time>
              </li>
              <li>
                <span className="activity-icon">
                  <Gavel size={15} />
                </span>
                <div>
                  <h3>Evidence overview prepared</h3>
                  <p className="small text-muted">
                    Product launch illustrations · Sample case
                  </p>
                </div>
                <time dateTime="2026-11-18">18 Nov</time>
              </li>
              <li>
                <span className="activity-icon">
                  <CircleCheck size={15} />
                </span>
                <div>
                  <h3>Project scope reviewed</h3>
                  <p className="small text-muted">
                    Mobile onboarding flow · Sample project
                  </p>
                </div>
                <time dateTime="2026-11-17">17 Nov</time>
              </li>
            </ul>
          ) : (
            <EmptyState
              title="Nothing to catch up on"
              description="No account activity has been loaded."
            />
          )}
        </Card>
        <aside className="protocol-card">
          <ShieldCheck size={26} strokeWidth={1.5} />
          <h2>One milestone at a time.</h2>
          <p>
            Funds move through explicit contract states. A disputed milestone
            stays frozen until arbitration settles it.
          </p>
          <TextLink href="/#how-it-works">Understand the process</TextLink>
        </aside>
      </div>
    </>
  );
}
