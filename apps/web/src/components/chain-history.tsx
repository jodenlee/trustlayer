"use client";
import Link from "next/link";
import { useState } from "react";
import { useConnection } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import {
  useProjectHistory,
  useWalletProjects,
} from "@/lib/blockchain/hooks/use-projects";
import { useWorkflowSession } from "./workflow-provider";
import { localClient } from "@/lib/blockchain/config";
import { verifyManifest } from "@/lib/blockchain/deployment";
import { chainDate } from "@/lib/blockchain/projects";
import { describeError } from "@/lib/blockchain/errors";
import {
  Button,
  Card,
  CardHeading,
  DataTable,
  EmptyState,
  PageHeading,
} from "./ui";
import { Money } from "./money";
import { usePreview } from "./providers";

export function HashCopy({ hash }: { hash: `0x${string}` }) {
  const { toast } = usePreview();
  return (
    <button
      className="text-link wallet-address"
      title={hash}
      onClick={() => {
        void navigator.clipboard
          .writeText(hash)
          .then(() => toast("Transaction hash copied."))
          .catch(() => toast(`Copy unavailable. Transaction hash: ${hash}`));
      }}
    >
      {hash.slice(0, 10)}…{hash.slice(-8)} · Copy
    </button>
  );
}
export function ChainHistory({
  projectIds,
  detail = false,
}: {
  projectIds: bigint[];
  detail?: boolean;
}) {
  const history = useProjectHistory(projectIds);
  return (
    <Card>
      <CardHeading
        title={
          detail
            ? "On-chain project events & payouts"
            : "On-chain event history"
        }
        description="Confirmed escrow events and wallet-to-escrow token approvals; bounded pages of 200 blocks."
      />
      {history.error ? (
        <EmptyState
          title="Event history unavailable"
          description={history.error.message}
          action={
            <Button variant="secondary" onClick={() => void history.refetch()}>
              Retry history
            </Button>
          }
        />
      ) : !history.deployment.ready ? (
        <EmptyState
          title="Verify deployment to read history"
          description="No historical transactions are invented when data is unavailable."
        />
      ) : history.isPending ? (
        <div role="status" className="empty-state">
          Loading on-chain event history…
        </div>
      ) : history.entries.length ? (
        <DataTable
          caption="Confirmed on-chain events"
          rows={history.entries}
          rowKey={(e) => e.id}
          columns={[
            {
              title: "Event",
              render: (e) => (
                <div>
                  <strong>{e.kind}</strong>
                  <p className="project-subtitle">
                    On-chain event · Confirmed
                    {e.projectId !== undefined && (
                      <>
                        {" "}
                        ·{" "}
                        <Link
                          className="text-link"
                          href={`/projects/${e.projectId}`}
                        >
                          Project #{e.projectId.toString()}
                        </Link>
                      </>
                    )}
                    {e.milestoneIndex !== undefined &&
                      ` · Milestone ${e.milestoneIndex + 1}`}
                  </p>
                </div>
              ),
            },
            {
              title: "Amount / allocation",
              render: (e) => (
                <div>
                  {e.amount !== undefined ? <Money amount={e.amount} /> : "—"}
                  {e.freelancerNet !== undefined && (
                    <p className="small text-muted">
                      Freelancer net <Money amount={e.freelancerNet} /> · Fee{" "}
                      <Money amount={e.serviceFee!} /> · Client refund{" "}
                      <Money amount={e.clientRefund!} />
                    </p>
                  )}
                </div>
              ),
            },
            {
              title: "Time",
              render: (e) => (
                <span className="small text-muted">
                  {e.timestamp
                    ? chainDate(e.timestamp)
                    : `Block ${e.blockNumber}`}
                </span>
              ),
            },
            { title: "Transaction", render: (e) => <HashCopy hash={e.hash} /> },
          ]}
        />
      ) : (
        <EmptyState
          title="No matching events in these blocks"
          description="Load earlier blocks for older activity. An empty page is not a statement that a project has never transacted."
        />
      )}
      <div className="card-body card-divider flex flex-wrap items-center gap-3">
        {history.data?.pages[0] && (
          <span className="small text-muted">
            Loaded block range {history.data.pages.at(-1)!.fromBlock.toString()}
            –{history.data.pages[0].toBlock.toString()}
          </span>
        )}
        {history.hasNextPage && (
          <Button
            variant="secondary"
            disabled={history.isFetching || !history.deployment.ready}
            onClick={() => void history.fetchNextPage()}
          >
            Load earlier events
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={history.isFetching || !history.deployment.ready}
          onClick={() => void history.refetch()}
        >
          Refresh events
        </Button>
      </div>
    </Card>
  );
}
export function SessionHistory({
  confirmedOnly = false,
}: {
  confirmedOnly?: boolean;
}) {
  const session = useWorkflowSession();
  const { address, chainId } = useConnection();
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState<number>();
  const [error, setError] = useState("");
  const attempts = session
    .attempts()
    .filter(
      (a) =>
        a.actor.toLowerCase() === address?.toLowerCase() &&
        a.manifest.chainId === chainId &&
        (!confirmedOnly || a.state.phase === "confirmed"),
    )
    .slice()
    .reverse()
    .slice(0, confirmedOnly ? 5 : undefined);
  return (
    <Card>
      <CardHeading
        title={
          confirmedOnly
            ? "Recently confirmed this session"
            : "This browser session"
        }
        description="In-memory client requests, separate from event history. Refreshing the page clears these records."
      />
      {error && (
        <p role="alert" className="form-error m-5">
          {error}
        </p>
      )}
      {attempts.length ? (
        <DataTable
          caption="Session transaction tracking"
          rows={attempts}
          rowKey={(a) => String(a.id)}
          columns={[
            {
              title: "Action",
              render: (a) => (
                <div>
                  <strong>{a.kind}</strong>
                  <p className="project-subtitle">
                    Session request · {a.state.phase}
                    {a.projectId !== undefined && ` · Project #${a.projectId}`}
                    {a.milestoneIndex !== undefined &&
                      ` · Milestone ${a.milestoneIndex + 1}`}
                  </p>
                  {a.state.message && (
                    <p className="small text-muted">{a.state.message}</p>
                  )}
                </div>
              ),
            },
            {
              title: "Amount",
              render: (a) =>
                a.amount === undefined ? "—" : <Money amount={a.amount} />,
            },
            {
              title: "Time",
              render: (a) =>
                a.timestamp
                  ? chainDate(a.timestamp)
                  : "Unavailable until mined",
            },
            {
              title: "Transaction",
              render: (a) => (
                <div>
                  {a.state.hash ? (
                    <HashCopy hash={a.state.hash} />
                  ) : (
                    <span className="small text-muted">No submitted hash</span>
                  )}
                  {a.state.hash &&
                    ["unconfirmed", "confirming", "submitted"].includes(
                      a.state.phase,
                    ) && (
                      <Button
                        variant="secondary"
                        className="mt-2"
                        disabled={checking !== undefined}
                        onClick={async () => {
                          setChecking(a.id);
                          setError("");
                          try {
                            await verifyManifest(localClient, a.manifest);
                            const receipt =
                              await localClient.getTransactionReceipt({
                                hash: a.state.hash!,
                              });
                            const transaction =
                              await localClient.getTransaction({
                                hash: a.state.hash!,
                              });
                            if (
                              transaction.from.toLowerCase() !==
                              a.actor.toLowerCase()
                            )
                              throw new Error(
                                "Receipt sender does not match this session request.",
                              );
                            session.update(a.id, {
                              ...a.state,
                              phase:
                                receipt.status === "success"
                                  ? a.state.replacementReason === "replaced" ||
                                    a.state.replacementReason === "cancelled"
                                    ? a.state.replacementReason
                                    : "confirmed"
                                  : "reverted",
                              blockNumber: receipt.blockNumber,
                              message:
                                receipt.status === "success"
                                  ? a.state.replacementReason === "replaced" ||
                                    a.state.replacementReason === "cancelled"
                                    ? "Replacement receipt verified; the original action was not confirmed."
                                    : "Receipt verified on the original deployment."
                                  : "The mined transaction reverted.",
                            });
                            session.timestamp(
                              a.id,
                              (
                                await localClient.getBlock({
                                  blockNumber: receipt.blockNumber,
                                })
                              ).timestamp,
                            );
                            await queryClient.invalidateQueries({
                              queryKey: ["trustlayer"],
                            });
                          } catch (e) {
                            setError(
                              `Receipt remains unresolved. ${e instanceof Error ? e.message : describeError(e).message}`,
                            );
                          } finally {
                            setChecking(undefined);
                          }
                        }}
                      >
                        {checking === a.id ? "Checking…" : "Check receipt"}
                      </Button>
                    )}
                </div>
              ),
            },
          ]}
        />
      ) : (
        <EmptyState
          title="No transaction requests this session"
          description="Submitted and confirmed requests appear here only after real wallet actions. No sample transactions are added."
        />
      )}
    </Card>
  );
}
export function WalletTransactions() {
  const projects = useWalletProjects();
  return (
    <>
      <PageHeading
        title="Transactions"
        description="On-chain events and this session’s client requests, with explicit sources."
      />
      <div className="space-y-5">
        <SessionHistory />
        {projects.hasNextPage && (
          <div className="info-note">
            Project events are filtered to loaded wallet projects.
            <Button
              variant="secondary"
              disabled={projects.isFetching || !projects.deployment.ready}
              onClick={() => void projects.fetchNextPage()}
            >
              Load earlier wallet projects
            </Button>
          </div>
        )}
        <ChainHistory projectIds={projects.projects.map((p) => p.id)} />
      </div>
    </>
  );
}
