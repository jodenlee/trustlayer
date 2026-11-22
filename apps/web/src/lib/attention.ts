import type { Address } from "viem";
import { projectActions, type ChainProject } from "./blockchain/projects";
import { caseActions, type ChainCase } from "./blockchain/arbitration";

export type AttentionKind =
  | "fund"
  | "accept"
  | "submit"
  | "approve"
  | "release"
  | "respond"
  | "vote"
  | "finalize"
  | "claim";
export interface AttentionItem {
  key: string;
  kind: AttentionKind;
  href: string;
  projectId?: bigint;
  disputeId?: bigint;
  milestone?: number;
  /** Chain-time deadline relevant to the action, when one applies. */
  deadline?: bigint;
  amount?: bigint;
}
/**
 * Actions the connected wallet can take now, derived only from the same
 * on-chain permission rules used to enable buttons. Nothing is invented: an
 * item appears only when the contract state already permits the action.
 */
export function attentionItems(
  projects: ChainProject[],
  cases: ChainCase[],
  account: Address,
  projectNow: bigint,
  caseNow: bigint,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const p of projects) {
    const a = projectActions(p, account, projectNow);
    const m = p.milestones[p.currentMilestone];
    const base = { projectId: p.id, href: `/projects/${p.id}` };
    if (a.fund)
      items.push({
        ...base,
        key: `fund:${p.id}`,
        kind: "fund",
        deadline: p.acceptBy,
        amount: p.total,
      });
    if (a.accept)
      items.push({
        ...base,
        key: `accept:${p.id}`,
        kind: "accept",
        deadline: p.acceptBy,
      });
    if (a.submit && m)
      items.push({
        ...base,
        key: `submit:${p.id}`,
        kind: "submit",
        milestone: p.currentMilestone,
        deadline: m.dueAt,
      });
    if (a.approve && m)
      items.push({
        ...base,
        key: `approve:${p.id}`,
        kind: "approve",
        milestone: p.currentMilestone,
        deadline: m.reviewEnd,
        amount: m.amount,
      });
    if (a.release && m)
      items.push({
        ...base,
        key: `release:${p.id}`,
        kind: "release",
        milestone: p.currentMilestone,
        amount: m.amount,
      });
  }
  for (const c of cases) {
    const a = caseActions(c.dispute, account, caseNow, c.vote, c.claimable);
    const base = {
      disputeId: c.id,
      projectId: c.dispute.projectId,
      milestone: Number(c.dispute.milestoneIndex),
      href: `/disputes/${c.id}`,
    };
    if (a.respond)
      items.push({
        ...base,
        key: `respond:${c.id}`,
        kind: "respond",
        deadline: c.dispute.responseDeadline,
      });
    if (a.vote)
      items.push({
        ...base,
        key: `vote:${c.id}`,
        kind: "vote",
        deadline: c.dispute.votingDeadline,
      });
    // Anyone may finalize; discovered cases already involve this wallet.
    if (a.finalize)
      items.push({ ...base, key: `finalize:${c.id}`, kind: "finalize" });
    if (a.claim)
      items.push({
        ...base,
        key: `claim:${c.id}`,
        kind: "claim",
        amount: c.claimable,
      });
  }
  // Soonest deadline first; items without a deadline keep discovery order.
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const x = a.item.deadline,
        y = b.item.deadline;
      if (x !== undefined && y !== undefined && x !== y) return x < y ? -1 : 1;
      if (x !== undefined && y === undefined) return -1;
      if (x === undefined && y !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
