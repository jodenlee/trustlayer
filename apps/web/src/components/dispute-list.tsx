"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Clock3, Gavel, LockKeyhole } from "lucide-react";
import { disputes, projects } from "@/lib/preview-data";
import { deadlineLabel } from "@/lib/format";
import { Card, DataTable, EmptyState, PageHeading, StatusBadge } from "./ui";
import { StatCard } from "./stats";
import { Money } from "./money";
import { usePreview } from "./providers";
export function DisputeList() {
  const { sample } = usePreview();
  const [filter, setFilter] = useState("All cases");
  const rows = sample
    ? disputes.filter((d) => filter === "All cases" || d.state === filter)
    : [];
  return (
    <>
      <PageHeading
        title="Disputes"
        description="A transparent path through disagreements, with milestone funds protected."
      />
      <div className="stats-grid">
        <StatCard
          label="Open cases"
          value={sample ? 2 : "—"}
          note="Across your sample projects"
          icon={Gavel}
        />
        <StatCard
          label="In response"
          value={sample ? 1 : "—"}
          note="12 hours for participant responses"
          icon={Clock3}
        />
        <StatCard
          label="Voting open"
          value={sample ? 1 : "—"}
          note="24 hours for assigned jurors"
          icon={Gavel}
        />
        <StatCard
          label="Frozen funds"
          value={sample ? <Money amount={1_200_000_000n} /> : "—"}
          note="Held separately from dispute fees"
          icon={LockKeyhole}
        />
      </div>
      <Card>
        <div className="toolbar">
          <div className="tabs" role="group" aria-label="Filter disputes">
            {["All cases", "Response window", "Voting open", "Finalized"].map(
              (tab) => (
                <button
                  key={tab}
                  aria-pressed={filter === tab}
                  className={`tab ${filter === tab ? "active" : ""}`}
                  onClick={() => setFilter(tab)}
                >
                  {tab}
                </button>
              ),
            )}
          </div>
          <span className="small text-muted">
            {rows.length} sample {rows.length === 1 ? "case" : "cases"}
          </span>
        </div>
        {rows.length ? (
          <DataTable
            caption="Sample disputes"
            rows={rows}
            rowKey={(d) => d.id}
            columns={[
              {
                title: "Case",
                render: (d) => {
                  const p = projects.find((p) => p.id === d.projectId)!;
                  return (
                    <div>
                      <Link className="project-name" href={`/disputes/${d.id}`}>
                        {p.title}
                      </Link>
                      <p className="project-subtitle">
                        {d.id.toUpperCase()} ·{" "}
                        {p.milestones[d.milestoneIndex].title}
                      </p>
                    </div>
                  );
                },
              },
              {
                title: "Status",
                render: (d) => <StatusBadge status={d.state} />,
              },
              {
                title: "Milestone funds",
                render: (d) => (
                  <Money
                    amount={
                      projects.find((p) => p.id === d.projectId)!.milestones[
                        d.milestoneIndex
                      ].amount
                    }
                  />
                ),
              },
              {
                title: "Next deadline",
                render: (d) => (
                  <span className="small text-muted">
                    {deadlineLabel(
                      d.state === "Response window"
                        ? d.responseDeadline
                        : d.votingDeadline,
                    )}
                  </span>
                ),
              },
              {
                title: "Details",
                render: (d) => (
                  <Link
                    className="text-link"
                    href={`/disputes/${d.id}`}
                    aria-label={`View ${d.id.toUpperCase()}`}
                  >
                    <ArrowUpRight size={16} />
                  </Link>
                ),
              },
            ]}
          />
        ) : (
          <EmptyState
            title={sample ? "No cases in this stage" : "No disputes to display"}
            description={
              sample
                ? "This preview has no finalized cases or settlement results."
                : "Cases involving your projects will appear when case reads are integrated."
            }
          />
        )}
      </Card>
      <div className="info-note mt-5">
        <Gavel size={16} />
        <p>
          A dispute costs the opener 15 mUSD. Three distinct eligible jurors
          review the milestone. Without two matching votes, the contract applies
          a 50/50 fallback.
        </p>
      </div>
    </>
  );
}
