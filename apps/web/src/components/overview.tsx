"use client";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Coins,
  FileUp,
  Gavel,
  Handshake,
  Plus,
  Scale,
  Wallet,
} from "lucide-react";
import { useWalletProjects } from "@/lib/blockchain/hooks/use-projects";
import { useWalletCases } from "@/lib/blockchain/hooks/use-arbitration";
import { useTokenBalance } from "@/lib/blockchain/hooks/use-protocol";
import { attentionItems, type AttentionItem } from "@/lib/attention";
import { describeError } from "@/lib/blockchain/errors";
import { chainDate } from "@/lib/blockchain/projects";
import { timeUntil } from "@/lib/format";
import {
  Button,
  ButtonLink,
  Card,
  CardHeading,
  EmptyState,
  LoadingRow,
  PageHeading,
} from "./ui";
import { Money } from "./money";
import { ChainProjectTable, useProjectNames } from "./chain-projects";
import { useProfile } from "./shell";

const copy: Record<
  AttentionItem["kind"],
  { title: (i: AttentionItem) => string; icon: typeof Wallet; tone?: string }
> = {
  fund: { title: () => "Fund escrow to start the project", icon: Wallet },
  accept: { title: () => "Review and accept this project", icon: Handshake },
  submit: {
    title: (i) => `Deliver milestone ${(i.milestone ?? 0) + 1}`,
    icon: FileUp,
  },
  approve: {
    title: (i) => `Review milestone ${(i.milestone ?? 0) + 1}`,
    icon: BadgeCheck,
  },
  release: {
    title: (i) => `Release payment for milestone ${(i.milestone ?? 0) + 1}`,
    icon: Coins,
  },
  respond: {
    title: (i) => `Respond to dispute #${i.disputeId}`,
    icon: Gavel,
    tone: "warning",
  },
  vote: {
    title: (i) => `Vote on dispute #${i.disputeId}`,
    icon: Scale,
    tone: "warning",
  },
  finalize: {
    title: (i) => `Finalize dispute #${i.disputeId}`,
    icon: Gavel,
  },
  claim: { title: () => "Claim your juror reward", icon: Coins },
};
function detail(item: AttentionItem, now: bigint, name?: string) {
  const project = name ?? `Project #${item.projectId}`;
  const when =
    item.deadline !== undefined
      ? ` · ${timeUntil(item.deadline, now)} (${chainDate(item.deadline)})`
      : "";
  switch (item.kind) {
    case "release":
      return `${project} · The client’s 72-hour review window has passed`;
    case "finalize":
      return `${project} · Voting has closed; anyone involved can settle it`;
    case "claim":
      return `${project} · Dispute #${item.disputeId} is finalized`;
    default:
      return `${project}${when}`;
  }
}
function Attention({
  items,
  now,
  names,
}: {
  items: AttentionItem[];
  now: bigint;
  names: Map<string, string>;
}) {
  if (!items.length)
    return (
      <EmptyState
        title="You’re all caught up"
        description="Nothing needs your action right now. New requests from clients, freelancers and disputes will appear here."
      />
    );
  return (
    <ul className="task-list">
      {items.map((item) => {
        const { title, icon: Icon, tone } = copy[item.kind];
        return (
          <li className="task" key={item.key}>
            <span className={`task-icon ${tone ?? ""}`} aria-hidden="true">
              <Icon size={17} />
            </span>
            <div className="min-w-0">
              <h3>{title(item)}</h3>
              <p>
                {detail(
                  item,
                  now,
                  item.projectId !== undefined
                    ? names.get(String(item.projectId))
                    : undefined,
                )}
                {item.amount !== undefined && (
                  <>
                    {" · "}
                    <Money amount={item.amount} />
                  </>
                )}
              </p>
            </div>
            <Link
              className="btn btn-secondary btn-sm"
              href={item.href}
              aria-label={`${title(item)}: open`}
            >
              Open
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
export function Overview() {
  const projects = useWalletProjects();
  const cases = useWalletCases();
  const balance = useTokenBalance();
  const profile = useProfile();
  const { deployment } = projects;
  const names = useProjectNames(projects.projects);
  const account = deployment.address;
  const projectNow = projects.data?.pages[0]?.now ?? 0n;
  const loaded = deployment.readable && projects.isSuccess;
  const casesLoaded = deployment.readable && cases.isSuccess;
  const items =
    loaded && casesLoaded && account
      ? attentionItems(
          projects.projects,
          cases.cases,
          account,
          projectNow,
          cases.now,
        )
      : [];
  const first = profile.data?.profile.display_name?.trim().split(/\s+/)[0];
  const escrow = projects.projects.reduce((n, p) => n + p.escrowRemaining, 0n);
  const openCases = cases.cases.filter((c) => c.dispute.status === 1).length;
  const partial = projects.hasNextPage || cases.hasNextPage;
  return (
    <>
      <PageHeading
        title={first ? `Welcome back, ${first}` : "Overview"}
        description="What needs your attention across your projects and disputes."
        action={
          <ButtonLink href="/projects/new">
            <Plus size={16} aria-hidden="true" />
            New project
          </ButtonLink>
        }
      />
      <div className="stack">
        <dl className="figures" aria-label="Account summary">
          <div>
            <dt>Wallet balance</dt>
            <dd data-testid="live-balance">
              {balance.token ? <Money amount={balance.token.balance} /> : "—"}
            </dd>
          </div>
          <div>
            <dt>Held in escrow</dt>
            <dd>{loaded ? <Money amount={escrow} /> : "—"}</dd>
          </div>
          <div>
            <dt>Active projects</dt>
            <dd>
              {loaded
                ? projects.projects.filter((p) => p.state === 2).length
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Open disputes</dt>
            <dd>{casesLoaded ? openCases : "—"}</dd>
          </div>
        </dl>
        {balance.deployment.ready && balance.isError && (
          <p role="alert" aria-label="Token read error" className="form-error">
            Token read failed. {describeError(balance.error).message}
          </p>
        )}
        <Card label="Needs your attention">
          <CardHeading
            title="Needs your attention"
            description={
              partial
                ? "Based on your most recent projects and disputes."
                : undefined
            }
          />
          {!deployment.readable ? (
            <EmptyState
              title="Waiting for the local network"
              description="Your projects load once the wallet and contracts are verified."
            />
          ) : projects.isError || cases.isError ? (
            <EmptyState
              title="Couldn’t load your activity"
              description={describeError(projects.error ?? cases.error).message}
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    void projects.refetch();
                    void cases.refetch();
                  }}
                >
                  Try again
                </Button>
              }
            />
          ) : !loaded || !casesLoaded ? (
            <LoadingRow label="Loading your projects and disputes…" />
          ) : (
            <Attention items={items} now={projectNow} names={names} />
          )}
        </Card>
        <Card label="Recent projects">
          <CardHeading
            title="Recent projects"
            action={
              projects.projects.length > 0 ? (
                <Link className="text-link small" href="/projects">
                  All projects
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              ) : undefined
            }
          />
          <div className="mt-3">
            {!loaded ? (
              deployment.readable && !projects.isError ? (
                <LoadingRow label="Loading on-chain projects…" />
              ) : null
            ) : projects.projects.length ? (
              <ChainProjectTable
                projects={projects.projects.slice(0, 5)}
                names={names}
                account={account!}
              />
            ) : (
              <EmptyState
                title="No projects yet"
                description="Create a project to agree milestones with a freelancer, or share your wallet address with a client so they can add you."
                action={
                  <ButtonLink href="/projects/new" variant="secondary">
                    Create your first project
                  </ButtonLink>
                }
              />
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
