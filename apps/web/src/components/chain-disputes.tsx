"use client";
import Link from "next/link";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useWalletCases } from "@/lib/blockchain/hooks/use-arbitration";
import {
  caseActions,
  caseRole,
  caseStage,
  VOTES,
} from "@/lib/blockchain/arbitration";
import { chainDate } from "@/lib/blockchain/projects";
import { describeError } from "@/lib/blockchain/errors";
import { timeUntil } from "@/lib/format";
import {
  Button,
  Card,
  CardFooter,
  CardHeading,
  DataTable,
  EmptyState,
  LoadingRow,
  PageHeading,
  StatusBadge,
} from "./ui";
import { Money } from "./money";

const FILTERS = [
  "All cases",
  "Needs action",
  "Response window",
  "Voting open",
  "Ready to finalize",
  "Finalized",
] as const;
const roleText = {
  Client: "Client",
  Freelancer: "Freelancer",
  Juror: "Juror",
  Viewer: "Viewer",
};
export function ChainDisputes({ jurorOnly = false }: { jurorOnly?: boolean }) {
  const data = useWalletCases();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All cases");
  const account = data.deployment.address;
  const items = data.cases.filter(
    (c) => !jurorOnly || caseRole(c.dispute, account!) === "Juror",
  );
  const needsAction = (c: (typeof items)[number]) => {
    const a = caseActions(c.dispute, account!, data.now, c.vote, c.claimable);
    return a.respond || a.vote || a.finalize || a.claim;
  };
  const rows = items.filter((c) =>
    filter === "All cases"
      ? true
      : filter === "Needs action"
        ? needsAction(c)
        : caseStage(c.dispute, data.now) === filter,
  );
  const table = (
    <DataTable
      caption={jurorOnly ? "Juror assignments" : "On-chain disputes"}
      rows={rows}
      rowKey={(c) => String(c.id)}
      columns={[
        {
          title: "Case",
          render: (c) => (
            <div>
              <Link className="row-title" href={`/disputes/${c.id}`}>
                Dispute #{c.id.toString()}
              </Link>
              <p className="row-subtitle">
                Project #{c.dispute.projectId.toString()} · Milestone{" "}
                {Number(c.dispute.milestoneIndex) + 1} · You:{" "}
                {roleText[caseRole(c.dispute, account!)]}
              </p>
            </div>
          ),
        },
        {
          title: "Stage",
          render: (c) => (
            <StatusBadge status={caseStage(c.dispute, data.now)} />
          ),
        },
        {
          title: "Amount",
          render: (c) => (
            <div>
              <Money amount={c.dispute.milestoneAmount} />
              {c.claimable > 0n && (
                <p className="small text-muted">
                  Reward to claim <Money amount={c.claimable} />
                </p>
              )}
              {c.claimed && (
                <p className="small text-muted">Your reward claimed</p>
              )}
            </div>
          ),
        },
        {
          title: "Deadline / outcome",
          render: (c) => {
            const stage = caseStage(c.dispute, data.now);
            return (
              <span className="small text-muted">
                {c.dispute.status === 2
                  ? c.dispute.fallbackApplied
                    ? "50/50 fallback"
                    : VOTES[c.dispute.ruling]
                  : stage === "Response window"
                    ? `Response ${timeUntil(c.dispute.responseDeadline, data.now)}`
                    : stage === "Voting open"
                      ? `Voting ${timeUntil(c.dispute.votingDeadline, data.now)}`
                      : `Voting closed ${chainDate(c.dispute.votingDeadline)}`}
              </span>
            );
          },
        },
      ]}
    />
  );
  return (
    <>
      {!jurorOnly && (
        <PageHeading
          title="Disputes"
          description="Cases on your projects and cases you’re assigned to as a juror."
        />
      )}
      <Card label={jurorOnly ? "Your assignments" : "Disputes"}>
        {jurorOnly && (
          <CardHeading
            title="Your assignments"
            description="Cases you were selected to judge. Each one locks 100 mUSD of your stake until it is finalized."
          />
        )}
        <div className={jurorOnly ? "toolbar mt-3" : "toolbar"}>
          <div
            className="segmented"
            role="group"
            aria-label="Filter on-chain disputes"
          >
            {FILTERS.map((stage) => (
              <button
                key={stage}
                type="button"
                aria-pressed={stage === filter}
                onClick={() => setFilter(stage)}
              >
                {stage}
              </button>
            ))}
          </div>
        </div>
        {!data.deployment.readable ? (
          <EmptyState
            title="Waiting for the local network"
            description="Disputes load once your wallet and the contracts are verified."
          />
        ) : data.error ? (
          <EmptyState
            title="Couldn’t load disputes"
            description={describeError(data.error).message}
            action={
              <Button variant="secondary" onClick={() => void data.refetch()}>
                Try again
              </Button>
            }
          />
        ) : data.isPending ? (
          <LoadingRow label="Loading on-chain disputes…" />
        ) : !rows.length ? (
          <EmptyState
            title={
              items.length
                ? "No disputes match this filter"
                : jurorOnly
                  ? "No assignments yet"
                  : "No disputes"
            }
            description={
              data.hasNextPage
                ? "Load earlier disputes to keep looking."
                : items.length
                  ? "Try another filter."
                  : jurorOnly
                    ? "When you’re eligible, you’ll be assigned to cases in rotation. They’ll appear here."
                    : "Disputes on your projects, or cases you’re assigned to as a juror, will appear here."
            }
          />
        ) : (
          table
        )}
        {data.deployment.readable && (
          <CardFooter>
            <span>
              {items.length} {items.length === 1 ? "case" : "cases"}
              {data.hasNextPage ? " in the most recent IDs" : ""}
            </span>
            <span className="ml-auto button-row">
              {data.hasNextPage && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={data.isFetching || !data.deployment.ready}
                  onClick={() => void data.fetchNextPage()}
                >
                  Load earlier disputes
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={data.isFetching || !data.deployment.ready}
                onClick={() => void data.refetch()}
              >
                <RefreshCw size={13} aria-hidden="true" />
                Refresh disputes
              </Button>
            </span>
          </CardFooter>
        )}
      </Card>
    </>
  );
}
