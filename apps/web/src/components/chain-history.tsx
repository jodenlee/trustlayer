"use client";
import Link from "next/link";
import { useState } from "react";
import { useConnection } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVerifiedDeployment } from "@/lib/blockchain/hooks/use-protocol";
import {
  accountPool,
  classifyUnmined,
  nonceGapMessage,
  type PoolClient,
} from "@/lib/blockchain/pool";
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
  CardBody,
  CardFooter,
  CardHeading,
  DataTable,
  EmptyState,
  Hash,
  LoadingRow,
  Notice,
  PageHeading,
} from "./ui";
import { Money } from "./money";
import { useWalletCases } from "@/lib/blockchain/hooks/use-arbitration";

export function HashCopy({ hash }: { hash: `0x${string}` }) {
  return <Hash value={hash} label="Copy transaction hash" />;
}
export function ChainHistory({
  projectIds,
  detail = false,
  disputeIds = [],
}: {
  projectIds: bigint[];
  detail?: boolean;
  disputeIds?: bigint[];
}) {
  const history = useProjectHistory(projectIds, disputeIds);
  return (
    <Card label="Activity">
      <CardHeading
        title={detail ? "Activity" : "On-chain activity"}
        description={
          detail
            ? "Confirmed blockchain events, including exact payouts and fees."
            : "Confirmed blockchain events for your projects and disputes."
        }
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
      ) : !history.deployment.readable ? (
        <EmptyState
          title="Waiting for the local network"
          description="Activity loads once your wallet and the contracts are verified."
        />
      ) : history.isPending ? (
        <LoadingRow label="Loading on-chain activity…" />
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
                  <span className="row-title">{e.kind}</span>
                  <p className="row-subtitle">
                    {e.activity ?? "Related project event"}
                    {e.disputeId !== undefined && (
                      <>
                        {" "}
                        ·{" "}
                        <Link
                          className="text-link"
                          href={`/disputes/${e.disputeId}`}
                        >
                          Dispute #{e.disputeId.toString()}
                        </Link>
                      </>
                    )}
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
          title={
            history.hasNextPage
              ? "No matching events in these blocks"
              : "No activity yet"
          }
          description={
            history.hasNextPage
              ? "Load earlier blocks to see older activity."
              : "Confirmed transactions will appear here."
          }
        />
      )}
      <CardFooter>
        {history.data?.pages[0] && (
          <span>
            Blocks {history.data.pages.at(-1)!.fromBlock.toString()}–
            {history.data.pages[0].toBlock.toString()}
          </span>
        )}
        <span className="ml-auto button-row">
          {history.hasNextPage && (
            <Button
              variant="secondary"
              size="sm"
              disabled={history.isFetching || !history.deployment.ready}
              onClick={() => void history.fetchNextPage()}
            >
              Load earlier events
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={history.isFetching || !history.deployment.ready}
            onClick={() => void history.refetch()}
          >
            Refresh events
          </Button>
        </span>
      </CardFooter>
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
    <Card label="Requests this session">
      <CardHeading
        title={
          confirmedOnly
            ? "Recently confirmed this session"
            : "Requests this session"
        }
        description="Wallet requests made in this browser tab, including ones still waiting for confirmation. Cleared when you refresh."
      />
      {error && (
        <p role="alert" className="form-error mx-5 mt-3">
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
                  <span className="row-title">{a.kind}</span>
                  <p className="row-subtitle">
                    {a.state.phase}
                    {a.projectId !== undefined && ` · Project #${a.projectId}`}
                    {a.disputeId !== undefined && (
                      <>
                        {" "}
                        ·{" "}
                        <Link
                          className="text-link"
                          href={`/disputes/${a.disputeId}`}
                        >
                          Dispute #{a.disputeId.toString()}
                        </Link>
                      </>
                    )}
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
                    <span className="small text-muted">Not submitted</span>
                  )}
                  {a.state.hash &&
                    ["unconfirmed", "confirming", "submitted"].includes(
                      a.state.phase,
                    ) && (
                      <Button
                        variant="secondary"
                        size="sm"
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
                            const status = await classifyUnmined(
                              localClient as unknown as PoolClient,
                              a.state.hash!,
                            ).catch(() => undefined);
                            setError(
                              status?.kind === "nonce-gap"
                                ? nonceGapMessage(status.nonce, status.expected)
                                : status?.kind === "pending"
                                  ? "Receipt remains unresolved: still waiting to be mined. Check again shortly; do not resubmit."
                                  : status?.kind === "unknown"
                                    ? "Receipt remains unresolved: the local node has no record of this transaction."
                                    : `Receipt remains unresolved. ${e instanceof Error ? e.message : describeError(e).message}`,
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
          description="Wallet requests you make in this tab will appear here."
        />
      )}
    </Card>
  );
}
/** The local node's own view of this wallet's unmined transactions (read-only). */
export function PoolTransactions() {
  const deployment = useVerifiedDeployment();
  const address = deployment.address;
  const pool = useQuery({
    queryKey: ["trustlayer", "pool", address, deployment.chainId],
    enabled: deployment.readable && !!address,
    refetchInterval: 10_000,
    gcTime: 0,
    queryFn: () => accountPool(localClient as unknown as PoolClient, address!),
  });
  const data = pool.data;
  if (
    !data ||
    (!data.transactions.length && data.pendingNonce === data.latestNonce)
  )
    return null;
  const stuck = data.transactions.filter((t) => t.status === "queued");
  return (
    <Card label="Waiting in the local node">
      <CardHeading
        title="Waiting in the local node"
        description={`Transactions from this wallet that the node has received but not mined. The chain expects nonce ${data.latestNonce} next.`}
      />
      <DataTable
        caption="Unmined transactions in the local node"
        rows={data.transactions}
        rowKey={(t) => t.hash}
        columns={[
          {
            title: "Status",
            render: (t) =>
              t.status === "queued" ? (
                <span className="status status-danger">Stuck (nonce gap)</span>
              ) : (
                <span className="status status-warning">Pending</span>
              ),
          },
          { title: "Nonce", render: (t) => String(t.nonce) },
          { title: "Transaction", render: (t) => <HashCopy hash={t.hash} /> },
        ]}
      />
      {stuck.length > 0 && (
        <CardBody>
          <Notice tone="warning" title="These can never be mined as they are">
            <p>
              Your wallet signed them with nonce{" "}
              {stuck.map((t) => t.nonce).join(", ")}, but this chain expects{" "}
              {data.latestNonce}. They did not execute and nothing was paid. Do
              not resubmit and do not send other transactions from this wallet
              yet: filling the gap would make them execute later.
            </p>
            <ol className="list-decimal pl-5 mt-2 grid gap-1">
              <li>
                Stop using this wallet in TrustLayer. Note the hashes above.
              </li>
              <li>
                In a terminal, remove exactly these queued hashes from the local
                node: <code>npm.cmd run dev:drop-queued -- --hash 0x…</code>{" "}
                (one <code>--hash</code> per transaction). It refuses anything
                that is mined or not nonce-gapped.
              </li>
              <li>
                In MetaMask, on the local network with this account selected:
                Settings → Advanced → Clear activity and nonce data. This only
                resets MetaMask’s local history so it uses nonce{" "}
                {data.latestNonce}.
              </li>
              <li>Reload TrustLayer and submit the action once.</li>
            </ol>
          </Notice>
        </CardBody>
      )}
    </Card>
  );
}
export function WalletTransactions() {
  const projects = useWalletProjects();
  const cases = useWalletCases();
  return (
    <>
      <PageHeading
        title="Transactions"
        description="Your confirmed on-chain activity, plus wallet requests from this session."
      />
      <div className="stack">
        <PoolTransactions />
        <SessionHistory />
        {projects.hasNextPage && (
          <Notice tone="neutral">
            <p>Activity covers your most recent projects.</p>
            <Button
              variant="secondary"
              size="sm"
              disabled={projects.isFetching || !projects.deployment.ready}
              onClick={() => void projects.fetchNextPage()}
            >
              Load earlier wallet projects
            </Button>
          </Notice>
        )}
        {cases.error && (
          <p role="alert" className="form-error">
            Case discovery unavailable; related case history may be incomplete.
          </p>
        )}
        {cases.hasNextPage && (
          <Notice tone="neutral">
            <p>Activity covers your most recent disputes.</p>
            <Button
              variant="secondary"
              size="sm"
              disabled={cases.isFetching || !cases.deployment.ready}
              onClick={() => void cases.fetchNextPage()}
            >
              Load earlier wallet disputes
            </Button>
          </Notice>
        )}
        <ChainHistory
          projectIds={[
            ...new Set([
              ...projects.projects.map((p) => p.id),
              ...cases.cases.map((c) => c.dispute.projectId),
            ]),
          ]}
          disputeIds={cases.cases.map((c) => c.id)}
        />
      </div>
    </>
  );
}
