import { DisputeArbitrationAbi } from "@trustlayer/contracts";
import {
  parseEventLogs,
  type Address,
  type ContractFunctionReturnType,
} from "viem";
import { IntegrationError } from "./errors";
import {
  projectRole,
  type ChainProject,
  type ProjectCursor,
  type ReadClient,
} from "./projects";
import type { ContractClients } from "./types";

export const DISPUTE_FEE = 15_000_000n;
export const MIN_STAKE = 100_000_000n;
export const JUROR_REWARD = 4_000_000n;
export const VOTES = [
  "Not voted",
  "Freelancer wins",
  "Client wins",
  "Split",
] as const;
export type DisputeRecord = ContractFunctionReturnType<
  typeof DisputeArbitrationAbi,
  "view",
  "getDispute"
>;
export type CaseStage =
  "Response window" | "Voting open" | "Ready to finalize" | "Finalized";
export function caseStage(dispute: DisputeRecord, now: bigint): CaseStage {
  if (dispute.status === 2) return "Finalized";
  if (now < dispute.responseDeadline) return "Response window";
  if (now <= dispute.votingDeadline) return "Voting open";
  return "Ready to finalize";
}
export function caseRole(dispute: DisputeRecord, account: Address) {
  const role = projectRole(dispute, account);
  return role !== "Viewer"
    ? role
    : dispute.jurors.some((j) => j.toLowerCase() === account.toLowerCase())
      ? "Juror"
      : "Viewer";
}
export function openingAllowed(
  project: ChainProject,
  index: number,
  account: Address,
  now: bigint,
  exists: boolean,
) {
  const m = project.milestones[index];
  return (
    !exists &&
    projectRole(project, account) !== "Viewer" &&
    project.state === 2 &&
    index === project.currentMilestone &&
    m?.state === 1 &&
    now <= m.reviewEnd
  );
}
export function caseActions(
  dispute: DisputeRecord,
  account: Address,
  now: bigint,
  vote: number,
  claimable: bigint,
) {
  const role = caseRole(dispute, account);
  const open = dispute.status === 1;
  return {
    respond:
      open &&
      (role === "Client" || role === "Freelancer") &&
      account.toLowerCase() !== dispute.opener.toLowerCase() &&
      now < dispute.responseDeadline &&
      /^0x0{64}$/i.test(dispute.responseHash),
    vote:
      open &&
      role === "Juror" &&
      vote === 0 &&
      now >= dispute.responseDeadline &&
      now <= dispute.votingDeadline,
    finalize: open && now > dispute.votingDeadline,
    claim: dispute.status === 2 && role === "Juror" && claimable > 0n,
  };
}
export function settlementAllocation(
  amount: bigint,
  freelancerBps: number,
  feeBps: number,
) {
  const freelancerGross = (amount * BigInt(freelancerBps)) / 10_000n;
  const serviceFee = (freelancerGross * BigInt(feeBps)) / 10_000n;
  return {
    gross: amount,
    freelancerGross,
    freelancerNet: freelancerGross - serviceFee,
    serviceFee,
    clientRefund: amount - freelancerGross,
  };
}
export function remainingTime(deadline: bigint, now: bigint) {
  const remaining = deadline > now ? deadline - now : 0n;
  return `${remaining / 3600n}h ${(remaining % 3600n) / 60n}m ${remaining % 60n}s remaining at the latest chain block`;
}
export async function readCase(
  client: ReadClient,
  contracts: ContractClients,
  id: bigint,
  account: Address,
  blockNumber?: bigint,
) {
  const arbitration = contracts.DisputeArbitration;
  const count = await client.readContract({
    ...arbitration,
    functionName: "nextDisputeId",
    blockNumber,
  });
  if (id < 0n || id >= count)
    throw new IntegrationError(
      "unknown",
      "This dispute does not exist on the verified deployment.",
    );
  const dispute = await client.readContract({
    ...arbitration,
    functionName: "getDispute",
    args: [id],
    blockNumber,
  });
  const [ballots, claimable, claimed, assignment, project, milestone] =
    await Promise.all([
      Promise.all(
        dispute.jurors.map((juror) =>
          client.readContract({
            ...arbitration,
            functionName: "votes",
            args: [id, juror],
            blockNumber,
          }),
        ),
      ),
      client.readContract({
        ...arbitration,
        functionName: "claimableReward",
        args: [id, account],
        blockNumber,
      }),
      client.readContract({
        ...arbitration,
        functionName: "rewardClaimed",
        args: [id, account],
        blockNumber,
      }),
      client.readContract({
        ...contracts.JurorRegistry,
        functionName: "getAssignment",
        args: [id],
        blockNumber,
      }),
      client.readContract({
        ...contracts.TrustEscrow,
        functionName: "projects",
        args: [dispute.projectId],
        blockNumber,
      }),
      client.readContract({
        ...contracts.TrustEscrow,
        functionName: "milestones",
        args: [dispute.projectId, dispute.milestoneIndex],
        blockNumber,
      }),
    ]);
  const index = dispute.jurors.findIndex(
    (j) => j.toLowerCase() === account.toLowerCase(),
  );
  return {
    id,
    dispute,
    ballots,
    vote: index < 0 ? 0 : ballots[index],
    claimable,
    claimed,
    assignment,
    feeBps: project[6],
    milestoneState: milestone[5],
  };
}
export type ChainCase = Awaited<ReturnType<typeof readCase>>;
export async function readCasePage(
  client: ReadClient,
  contracts: ContractClients,
  account: Address,
  cursor: ProjectCursor | null,
) {
  const block = await client.getBlock(
    cursor ? { blockNumber: cursor.blockNumber } : { blockTag: "latest" },
  );
  const before =
    cursor?.before ??
    (await client.readContract({
      ...contracts.DisputeArbitration,
      functionName: "nextDisputeId",
      blockNumber: block.number,
    }));
  const start = before > 20n ? before - 20n : 0n;
  const cases: ChainCase[] = [];
  for (let high = before; high > start;) {
    const ids: bigint[] = [];
    while (ids.length < 4 && high > start) ids.push(--high);
    const batch = await Promise.all(
      ids.map(async (id) => {
        const d = await client.readContract({
          ...contracts.DisputeArbitration,
          functionName: "getDispute",
          args: [id],
          blockNumber: block.number,
        });
        return caseRole(d, account) === "Viewer"
          ? null
          : readCase(client, contracts, id, account, block.number);
      }),
    );
    cases.push(...batch.filter((d): d is ChainCase => d !== null));
  }
  return {
    cases,
    scanned: before - start,
    now: block.timestamp,
    next: start > 0n ? { before: start, blockNumber: block.number } : undefined,
  };
}
export function openedDisputeFromReceipt(
  logs: Parameters<typeof parseEventLogs>[0]["logs"],
  address: Address,
  projectId: bigint,
  index: number,
  opener: Address,
) {
  const event = parseEventLogs({
    abi: DisputeArbitrationAbi,
    eventName: "DisputeOpened",
    logs,
  }).find(
    (e) =>
      e.address.toLowerCase() === address.toLowerCase() &&
      e.args.projectId === projectId &&
      e.args.milestoneIndex === BigInt(index) &&
      e.args.opener.toLowerCase() === opener.toLowerCase(),
  );
  if (!event)
    throw new IntegrationError(
      "unknown",
      "Opening confirmed, but its DisputeOpened receipt event could not be verified. Check Transactions before retrying.",
    );
  return event.args.disputeId;
}
