"use client";
import Link from "next/link";
import { useState } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
import { useWalletProjects } from "@/lib/blockchain/hooks/use-projects";
import { useVerifiedDeployment } from "@/lib/blockchain/hooks/use-protocol";
import {
  PROJECT_STATES,
  projectActions,
  projectRole,
  type ChainProject,
} from "@/lib/blockchain/projects";
import { deploymentScope } from "@/lib/blockchain/session";
import { describeError } from "@/lib/blockchain/errors";
import { useWorkflowSession } from "./workflow-provider";
import {
  Button,
  ButtonLink,
  Card,
  CardFooter,
  DataTable,
  EmptyState,
  Input,
  LoadingRow,
  MilestoneProgress,
  PageHeading,
  StatusBadge,
} from "./ui";
import { Money } from "./money";
import { useProjectTitles } from "./project-metadata";

/**
 * Display names for projects: saved metadata when signed in, otherwise this
 * session's creation draft, otherwise "Project #id". Never fabricated.
 */
export function useProjectNames(projects: ChainProject[]) {
  const deployment = useVerifiedDeployment();
  const session = useWorkflowSession();
  const manifest = deployment.readable ? deployment.data?.manifest : undefined;
  const scope = deployment.data
    ? deploymentScope(deployment.data.manifest)
    : "";
  const titles = useProjectTitles(
    manifest,
    projects.map((p) => p.id),
  );
  return new Map(
    projects.map((p) => [
      String(p.id),
      titles.get(String(p.id)) ??
        session.metadata(scope, p.id, p.metadataHash)?.title ??
        `Project #${p.id}`,
    ]),
  );
}
const roleLabel = {
  Client: "You’re the client",
  Freelancer: "You’re the freelancer",
  Viewer: "Viewer",
};
export function ChainProjectTable({
  projects,
  names,
  account,
}: {
  projects: ChainProject[];
  names: Map<string, string>;
  account: `0x${string}`;
}) {
  return (
    <DataTable
      caption="On-chain wallet projects"
      rows={projects}
      rowKey={(p) => String(p.id)}
      columns={[
        {
          title: "Project",
          render: (p) => (
            <div>
              <Link className="row-title" href={`/projects/${p.id}`}>
                {names.get(String(p.id)) ?? `Project #${p.id}`}
              </Link>
              <p className="row-subtitle">
                #{p.id.toString()} · {roleLabel[projectRole(p, account)]}
              </p>
            </div>
          ),
        },
        {
          title: "Status",
          render: (p) => (
            <StatusBadge status={PROJECT_STATES[p.state] ?? "Unknown"} />
          ),
        },
        { title: "Budget", render: (p) => <Money amount={p.total} /> },
        {
          title: "In escrow",
          render: (p) => <Money amount={p.escrowRemaining} />,
        },
        {
          title: "Milestones",
          render: (p) => (
            <MilestoneProgress
              completed={p.currentMilestone}
              total={p.milestoneCount}
            />
          ),
        },
      ]}
    />
  );
}
const FILTERS = [
  "All projects",
  "Needs action",
  "Unfunded",
  "Awaiting acceptance",
  "Active",
  "Completed",
  "Closed",
] as const;
export function ChainProjects() {
  const data = useWalletProjects();
  const [search, setSearch] = useState("");
  const [filter, setFilter] =
    useState<(typeof FILTERS)[number]>("All projects");
  const { deployment } = data;
  const items = data.projects;
  const names = useProjectNames(items);
  const now = data.data?.pages[0]?.now ?? 0n;
  const needsAction = (p: ChainProject) => {
    if (!deployment.address) return false;
    const a = projectActions(p, deployment.address, now);
    return a.fund || a.accept || a.submit || a.approve || a.release;
  };
  const rows = items.filter(
    (p) =>
      (filter === "All projects" ||
        (filter === "Needs action"
          ? needsAction(p)
          : PROJECT_STATES[p.state] === filter)) &&
      `${p.id} ${names.get(String(p.id)) ?? ""} ${p.client} ${p.freelancer}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <PageHeading
        title="Projects"
        description="Agreements where you are the client or the freelancer."
        action={
          <ButtonLink href="/projects/new">
            <Plus size={16} aria-hidden="true" />
            New project
          </ButtonLink>
        }
      />
      <Card label="Projects">
        <div className="toolbar">
          <div
            className="segmented"
            role="group"
            aria-label="Filter on-chain projects"
          >
            {FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={filter === s}
                onClick={() => setFilter(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="search-field">
            <Search size={15} aria-hidden="true" />
            <Input
              aria-label="Search on-chain projects"
              placeholder="Search by name, ID or address"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {!deployment.readable ? (
          <EmptyState
            title="Waiting for the local network"
            description="Projects load once your wallet and the contracts are verified."
          />
        ) : data.isError ? (
          <EmptyState
            title="Couldn’t load your projects"
            description={describeError(data.error).message}
            action={
              <Button variant="secondary" onClick={() => void data.refetch()}>
                Retry project reads
              </Button>
            }
          />
        ) : data.isPending ? (
          <LoadingRow label="Loading on-chain projects…" />
        ) : rows.length ? (
          <ChainProjectTable
            names={names}
            projects={rows}
            account={deployment.address!}
          />
        ) : (
          <EmptyState
            title={
              items.length
                ? "No matching projects"
                : data.hasNextPage
                  ? "No projects in the most recent IDs"
                  : "No on-chain projects yet"
            }
            description={
              items.length
                ? "Try another filter or search term."
                : data.hasNextPage
                  ? "Load earlier projects to keep looking."
                  : "Create a project, or share your wallet address with a client so they can name you as the freelancer."
            }
            action={
              !items.length && !data.hasNextPage ? (
                <ButtonLink href="/projects/new" variant="secondary">
                  Create a project
                </ButtonLink>
              ) : undefined
            }
          />
        )}
        {deployment.readable && (
          <CardFooter>
            <span>
              {items.length} {items.length === 1 ? "project" : "projects"}
              {data.hasNextPage ? " in the most recent IDs" : ""}
            </span>
            <span className="ml-auto button-row">
              {data.hasNextPage && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={data.isFetching || !deployment.ready}
                  onClick={() => void data.fetchNextPage()}
                >
                  Load earlier projects
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={data.isFetching || !deployment.ready}
                onClick={() => void data.refetch()}
              >
                <RefreshCw size={13} aria-hidden="true" />
                Refresh projects
              </Button>
            </span>
          </CardFooter>
        )}
      </Card>
    </>
  );
}
