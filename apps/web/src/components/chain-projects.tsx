"use client";
import Link from "next/link";
import { useState } from "react";
import {
  BriefcaseBusiness,
  FileCheck2,
  LockKeyhole,
  Plus,
  Search,
} from "lucide-react";
import { useWalletProjects } from "@/lib/blockchain/hooks/use-projects";
import {
  PROJECT_STATES,
  projectActions,
  projectRole,
  type ChainProject,
} from "@/lib/blockchain/projects";
import { deploymentScope } from "@/lib/blockchain/session";
import { useWorkflowSession } from "./workflow-provider";
import {
  Button,
  ButtonLink,
  Card,
  CardHeading,
  DataTable,
  EmptyState,
  Input,
  MilestoneProgress,
  PageHeading,
  StatusBadge,
} from "./ui";
import { Money } from "./money";
import { StatCard } from "./stats";
import { LiveWalletCard } from "./live-wallet";
import { describeError } from "@/lib/blockchain/errors";
import { SessionHistory } from "./chain-history";
import { ChainDisputes } from "./chain-disputes";

export function ChainProjectTable({
  projects,
  scope,
  account,
}: {
  projects: ChainProject[];
  scope: string;
  account: `0x${string}`;
}) {
  const session = useWorkflowSession();
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
              <Link className="project-name" href={`/projects/${p.id}`}>
                {session.metadata(scope, p.id, p.metadataHash)?.title ??
                  `Project #${p.id}`}
              </Link>
              <p className="project-subtitle">
                #{p.id.toString()} · {projectRole(p, account)} · On-chain
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
export function ChainProjects({ dashboard = false }: { dashboard?: boolean }) {
  const data = useWalletProjects();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All projects");
  const session = useWorkflowSession();
  const { deployment } = data;
  const scope = deployment.data
    ? deploymentScope(deployment.data.manifest)
    : "";
  const items = data.projects;
  const rows = items.filter(
    (p) =>
      (filter === "All projects" || PROJECT_STATES[p.state] === filter) &&
      `${p.id} ${session.metadata(scope, p.id, p.metadataHash)?.title ?? ""} ${p.client} ${p.freelancer}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const now = data.data?.pages[0]?.now ?? 0n;
  const loaded = deployment.ready && data.isSuccess;
  const pending = items.filter(
    (p) =>
      deployment.address &&
      (() => {
        const actions = projectActions(p, deployment.address!, now);
        return actions.submit || actions.approve || actions.release;
      })(),
  ).length;
  return (
    <>
      <PageHeading
        title={dashboard ? "Your workspace" : "Projects"}
        description="Your connected wallet’s on-chain agreements. Descriptive metadata is session-only."
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
      {dashboard && (
        <div className="stats-grid">
          <StatCard
            label="Active projects loaded"
            icon={BriefcaseBusiness}
            value={loaded ? items.filter((p) => p.state === 2).length : "—"}
            note="From the loaded discovery pages"
          />
          <StatCard
            label="Loaded project escrow"
            icon={LockKeyhole}
            value={
              loaded ? (
                <Money
                  amount={items.reduce((n, p) => n + p.escrowRemaining, 0n)}
                />
              ) : (
                "—"
              )
            }
            note="Actual remaining escrow, both roles"
          />
          <StatCard
            label="Pending milestone actions"
            icon={FileCheck2}
            value={loaded ? pending : "—"}
            note="Role and chain-time based actions"
          />
          <StatCard
            label="Projects loaded"
            icon={BriefcaseBusiness}
            value={loaded ? items.length : "—"}
            note={
              data.hasNextPage
                ? "Earlier project IDs remain to scan"
                : "Discovery complete for this snapshot"
            }
          />
        </div>
      )}
      {dashboard && (
        <div className="mt-6">
          <ChainDisputes dashboard />
          <SessionHistory confirmedOnly />
        </div>
      )}
      <Card>
        <CardHeading
          title={dashboard ? "Your projects" : "On-chain projects"}
          description="Twenty candidate IDs per page; only your client or freelancer projects are shown."
        />
        <div className="toolbar">
          <div
            className="tabs"
            role="group"
            aria-label="Filter on-chain projects"
          >
            {[
              "All projects",
              "Unfunded",
              "Awaiting acceptance",
              "Active",
              "Completed",
              "Closed",
            ].map((s) => (
              <button
                key={s}
                className={`tab ${filter === s ? "active" : ""}`}
                aria-pressed={filter === s}
                onClick={() => setFilter(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="search-field">
            <Search size={16} />
            <Input
              aria-label="Search on-chain projects"
              placeholder="Project ID or wallet…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {!deployment.ready ? (
          <EmptyState
            title="Verify your local connection"
            description="On-chain project reads are paused until your wallet and deployment are verified. Sample projects are not used as account data."
          />
        ) : data.isError ? (
          <EmptyState
            title="Project discovery failed"
            description={describeError(data.error).message}
            action={
              <Button variant="secondary" onClick={() => void data.refetch()}>
                Retry project reads
              </Button>
            }
          />
        ) : data.isPending ? (
          <div role="status" className="empty-state">
            Loading on-chain projects…
          </div>
        ) : rows.length ? (
          <ChainProjectTable
            projects={rows}
            scope={scope}
            account={deployment.address!}
          />
        ) : (
          <EmptyState
            title={
              items.length
                ? "No matching on-chain projects"
                : data.hasNextPage
                  ? "No matches in the scanned IDs"
                  : "No on-chain projects yet"
            }
            description={
              data.hasNextPage
                ? "Continue scanning earlier project IDs. No unrestricted log scan is performed."
                : "Create an agreement or ask the client to designate this wallet as the freelancer."
            }
          />
        )}
        <div className="card-body card-divider flex flex-wrap items-center gap-4">
          <span className="small text-muted">
            {data.scanned.toString()} candidate IDs scanned · {items.length}{" "}
            matching projects
          </span>
          {data.hasNextPage && (
            <Button
              variant="secondary"
              disabled={data.isFetching || !deployment.ready}
              onClick={() => void data.fetchNextPage()}
            >
              Load earlier projects
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={data.isFetching || !deployment.ready}
            onClick={() => void data.refetch()}
          >
            Refresh projects
          </Button>
        </div>
      </Card>
      {dashboard && (
        <div className="info-note mt-5">
          Counts and escrow totals cover loaded discovery pages. Confirmed
          activity is available in{" "}
          <Link className="text-link" href="/transactions">
            Transactions
          </Link>
          .
        </div>
      )}
    </>
  );
}
