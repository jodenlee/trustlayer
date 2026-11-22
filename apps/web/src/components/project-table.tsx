"use client";
import Link from "next/link";
import { ArrowUpRight, PanelsTopLeft } from "lucide-react";
import type { Project } from "@/lib/models";
import { totalProjectAmount } from "@/lib/preview-data";
import { DataTable, MilestoneProgress, StatusBadge } from "./ui";
import { Money } from "./money";
export function ProjectTable({
  projects,
  compact = false,
}: {
  projects: Project[];
  compact?: boolean;
}) {
  return (
    <DataTable
      caption="Sample projects"
      rows={projects}
      rowKey={(p) => p.id}
      columns={[
        {
          title: "Project",
          render: (p) => (
            <div className="project-cell">
              <span className="project-icon">
                <PanelsTopLeft size={17} strokeWidth={1.5} aria-hidden="true" />
              </span>
              <div>
                <Link className="project-name" href={`/projects/${p.id}`}>
                  {p.title}
                </Link>
                <p className="project-subtitle">
                  {compact ? p.category : `${p.id.toUpperCase()} · ${p.role}`}
                </p>
              </div>
            </div>
          ),
        },
        { title: "Status", render: (p) => <StatusBadge status={p.state} /> },
        {
          title: compact ? "Escrowed" : "Budget",
          render: (p) => (
            <Money amount={compact ? p.escrowed : totalProjectAmount(p)} />
          ),
        },
        {
          title: "Milestones",
          render: (p) => (
            <MilestoneProgress
              completed={
                p.milestones.filter((m) => m.state === "Approved").length
              }
              total={p.milestones.length}
            />
          ),
        },
        ...(!compact
          ? [
              {
                title: "Details",
                render: (p: Project) => (
                  <Link
                    className="text-link"
                    aria-label={`View ${p.title}`}
                    href={`/projects/${p.id}`}
                  >
                    <ArrowUpRight size={16} />
                  </Link>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}
