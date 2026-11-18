"use client";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { projects } from "@/lib/preview-data";
import { Button, ButtonLink, Card, EmptyState, Input, PageHeading } from "./ui";
import { ProjectTable } from "./project-table";
import { usePreview } from "./providers";
export function ProjectList() {
  const [filter, setFilter] = useState("All projects");
  const [search, setSearch] = useState("");
  const { sample } = usePreview();
  const rows = sample
    ? projects.filter(
        (p) =>
          (filter === "All projects" || p.state === filter) &&
          `${p.title} ${p.id} ${p.client} ${p.freelancer}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      )
    : [];
  return (
    <>
      <PageHeading
        title="Projects"
        description="Agreements, milestones, and the work you’re building together."
        action={
          <ButtonLink href="/projects/new">
            <Plus size={16} />
            New project
          </ButtonLink>
        }
      />
      <Card>
        <div className="toolbar">
          <div className="tabs" role="group" aria-label="Filter projects">
            {["All projects", "Active", "Awaiting acceptance", "Completed"].map(
              (tab) => (
                <button
                  key={tab}
                  className={`tab ${filter === tab ? "active" : ""}`}
                  aria-pressed={filter === tab}
                  onClick={() => setFilter(tab)}
                >
                  {tab}
                </button>
              ),
            )}
          </div>
          <div className="search-field">
            <Search size={16} aria-hidden="true" />
            <Input
              aria-label="Search projects"
              placeholder="Search projects…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {rows.length ? (
          <ProjectTable projects={rows} />
        ) : (
          <EmptyState
            title={
              sample
                ? "No matching projects"
                : "A fresh start for your workspace"
            }
            description={
              sample
                ? "Try a different project name or change your filters."
                : "No account projects have been loaded. Explore the form to see how milestone agreements will work."
            }
            action={
              sample ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setFilter("All projects");
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <ButtonLink href="/projects/new" variant="secondary">
                  Explore project form
                </ButtonLink>
              )
            }
          />
        )}
      </Card>
      <p className="small text-muted mt-5">
        Escrow budgets use six-decimal MockUSD. Service fees apply only to
        freelancer payouts.
      </p>
    </>
  );
}
