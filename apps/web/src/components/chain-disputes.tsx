"use client";
import Link from "next/link";
import { useState } from "react";
import { Gavel, Clock3, Coins, FileCheck2 } from "lucide-react";
import { useWalletCases } from "@/lib/blockchain/hooks/use-arbitration";
import { caseActions, caseRole, caseStage } from "@/lib/blockchain/arbitration";
import { chainDate } from "@/lib/blockchain/projects";
import { describeError, shortenAddress } from "@/lib/blockchain/errors";
import {
  Button,
  Card,
  CardHeading,
  DataTable,
  EmptyState,
  PageHeading,
  StatusBadge,
} from "./ui";
import { StatCard } from "./stats";
import { Money } from "./money";

export function ChainDisputes({
  dashboard = false,
  jurorOnly = false,
}: {
  dashboard?: boolean;
  jurorOnly?: boolean;
}) {
  const data = useWalletCases();
  const [filter, setFilter] = useState("All cases");
  const account = data.deployment.address;
  const items = data.cases.filter(
    (c) => !jurorOnly || caseRole(c.dispute, account!) === "Juror",
  );
  const rows = items.filter(
    (c) => filter === "All cases" || caseStage(c.dispute, data.now) === filter,
  );
  const loaded = data.deployment.readable && data.isSuccess;
  const actions = items.map((c) =>
    caseActions(c.dispute, account!, data.now, c.vote, c.claimable),
  );
  return (
    <>
      {!dashboard && !jurorOnly && (
        <PageHeading
          title="Disputes"
          description="Your client, freelancer and assigned-juror cases on the verified local deployment."
        />
      )}
      {(dashboard || !jurorOnly) && (
        <div className="stats-grid mt-5">
          <StatCard
            icon={Gavel}
            label="Active disputes loaded"
            value={
              loaded ? items.filter((c) => c.dispute.status === 1).length : "—"
            }
            note="Associated with the connected wallet"
          />
          <StatCard
            icon={Clock3}
            label="Awaiting your response"
            value={loaded ? actions.filter((a) => a.respond).length : "—"}
            note="Other participants may respond once"
          />
          <StatCard
            icon={FileCheck2}
            label="Assignments awaiting your vote"
            value={loaded ? actions.filter((a) => a.vote).length : "—"}
            note="Assigned, unvoted and inside voting time"
          />
          <StatCard
            icon={Gavel}
            label="Finalizable disputes loaded"
            value={loaded ? actions.filter((a) => a.finalize).length : "—"}
            note="Anyone can finalize after voting closes"
          />
          <StatCard
            icon={Coins}
            label="Unclaimed rewards loaded"
            value={
              loaded ? (
                <Money amount={items.reduce((n, c) => n + c.claimable, 0n)} />
              ) : (
                "—"
              )
            }
            note="Actual per-case claimableReward reads"
          />
        </div>
      )}
      <Card className="mt-5">
        <CardHeading
          title={
            jurorOnly ? "Your juror assignments & rewards" : "On-chain disputes"
          }
          description="Twenty candidate IDs per page; counts and rewards cover loaded cases only."
        />
        <div className="toolbar">
          <div
            className="tabs"
            role="group"
            aria-label="Filter on-chain disputes"
          >
            {[
              "All cases",
              "Response window",
              "Voting open",
              "Ready to finalize",
              "Finalized",
            ].map((stage) => (
              <button
                key={stage}
                className={`tab ${stage === filter ? "active" : ""}`}
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
            title="Verify your local connection"
            description="Case reads require a connected wallet and verified deployment. Sample cases are not substituted."
          />
        ) : data.error ? (
          <EmptyState
            title="Dispute discovery failed"
            description={describeError(data.error).message}
          />
        ) : data.isPending ? (
          <div role="status" className="empty-state">
            Loading on-chain disputes…
          </div>
        ) : !rows.length ? (
          <EmptyState
            title="No matching on-chain disputes loaded"
            description={
              data.hasNextPage
                ? "Continue scanning earlier case IDs to discover older cases and rewards."
                : "No case in this filter involves the connected wallet. No sample outcome or reward is substituted."
            }
          />
        ) : (
          <DataTable
            caption="On-chain disputes"
            rows={dashboard ? rows.slice(0, 5) : rows}
            rowKey={(c) => String(c.id)}
            columns={[
              {
                title: "Case / role",
                render: (c) => (
                  <div>
                    <Link className="project-name" href={`/disputes/${c.id}`}>
                      Dispute #{c.id.toString()}
                    </Link>
                    <p className="project-subtitle">
                      Project #{c.dispute.projectId.toString()} · Milestone{" "}
                      {c.dispute.milestoneIndex.toString()} (index) ·{" "}
                      {caseRole(c.dispute, account!)}
                    </p>
                    <p
                      className="small text-muted"
                      title={`${c.dispute.client} / ${c.dispute.freelancer}`}
                    >
                      Client {shortenAddress(c.dispute.client)} · Freelancer{" "}
                      {shortenAddress(c.dispute.freelancer)}
                    </p>
                  </div>
                ),
              },
              {
                title: "Stage / opened",
                render: (c) => (
                  <div>
                    <StatusBadge status={caseStage(c.dispute, data.now)} />
                    <p className="small text-muted mt-2">
                      Opened {chainDate(c.dispute.openedAt)}
                    </p>
                  </div>
                ),
              },
              {
                title: "Amount / reward",
                render: (c) => (
                  <div>
                    <Money amount={c.dispute.milestoneAmount} />
                    {c.claimable > 0n && (
                      <p className="small">
                        Claimable <Money amount={c.claimable} />
                      </p>
                    )}
                    {c.claimed && <p className="small">Your reward claimed</p>}
                  </div>
                ),
              },
              {
                title: "Deadlines / outcome",
                render: (c) => (
                  <p className="small text-muted">
                    {c.dispute.status === 2
                      ? `Finalized · ${c.dispute.fallbackApplied ? "50/50 fallback" : ["No ruling", "Freelancer wins", "Client wins", "Split"][c.dispute.ruling]}`
                      : `Response ${chainDate(c.dispute.responseDeadline)} · Voting ${chainDate(c.dispute.votingDeadline)}`}
                  </p>
                ),
              },
            ]}
          />
        )}
        <div className="card-body card-divider flex flex-wrap items-center gap-3">
          <span className="small text-muted">
            {data.scanned.toString()} candidate IDs scanned · {items.length}{" "}
            relevant cases loaded
          </span>
          {data.hasNextPage && (
            <Button
              variant="secondary"
              disabled={data.isFetching || !data.deployment.ready}
              onClick={() => void data.fetchNextPage()}
            >
              Load earlier disputes
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={data.isFetching || !data.deployment.ready}
            onClick={() => void data.refetch()}
          >
            Refresh disputes
          </Button>
          {dashboard && (
            <Link className="text-link" href="/disputes">
              View all loaded cases
            </Link>
          )}
        </div>
      </Card>
    </>
  );
}
