import {
  MockUSDAbi,
  TrustEscrowAbi,
  DisputeArbitrationAbi,
  JurorRegistryAbi,
} from "@trustlayer/contracts";
import { decodeEventLog, type Address, type Hash } from "viem";
import type { ContractClients } from "./types";
import type { ReadClient } from "./projects";

export const HISTORY_BLOCK_PAGE = 200n;
export interface HistoryEntry {
  id: string;
  kind: string;
  hash: Hash;
  blockNumber: bigint;
  projectId?: bigint;
  disputeId?: bigint;
  activity?: "Wallet activity" | "Related case event" | "Related project event";
  milestoneIndex?: number;
  amount?: bigint;
  freelancerGross?: bigint;
  freelancerNet?: bigint;
  clientRefund?: bigint;
  serviceFee?: bigint;
  timestamp?: bigint;
  source: "On-chain event";
}
export async function findDeploymentBlock(
  client: ReadClient,
  address: Address,
  anchor: bigint,
) {
  let low = 0n;
  let high = anchor;
  let steps = 0;
  while (low < high) {
    if (++steps > 64)
      throw new Error("Deployment history search exceeded its bounded budget.");
    const mid = (low + high) / 2n;
    const code = await client.getCode({ address, blockNumber: mid });
    if (!code || code === "0x") low = mid + 1n;
    else high = mid;
  }
  return low;
}
export async function readHistoryPage(
  client: ReadClient,
  contracts: ContractClients,
  account: Address,
  projectIds: readonly bigint[],
  start: bigint,
  before?: bigint,
  disputeIds: readonly bigint[] = [],
) {
  const latest =
    before ?? (await client.getBlock({ blockTag: "latest" })).number;
  const fromBlock =
    latest - start >= HISTORY_BLOCK_PAGE
      ? latest - HISTORY_BLOCK_PAGE + 1n
      : start;
  if (latest < start)
    return {
      entries: [] as HistoryEntry[],
      next: undefined,
      fromBlock: start,
      toBlock: latest,
    };
  const [escrowLogs, approvals, arbitrationLogs, registryLogs] =
    await Promise.all([
      client.getLogs({
        address: contracts.TrustEscrow.address,
        fromBlock,
        toBlock: latest,
      }),
      client.getContractEvents({
        ...contracts.MockUSD,
        eventName: "Approval",
        args: { owner: account },
        fromBlock,
        toBlock: latest,
        strict: true,
      }),
      client.getLogs({
        address: contracts.DisputeArbitration.address,
        fromBlock,
        toBlock: latest,
      }),
      client.getLogs({
        address: contracts.JurorRegistry.address,
        fromBlock,
        toBlock: latest,
      }),
    ]);
  if (
    escrowLogs.length +
      approvals.length +
      arbitrationLogs.length +
      registryLogs.length >
    2000
  )
    throw new Error(
      "This 200-block history page is too dense for the local UI. Use a block explorer or a future event indexer; no partial page was presented as complete.",
    );
  const ids = new Set(projectIds.map(String));
  const cases = new Set(disputeIds.map(String));
  const entries: HistoryEntry[] = [];
  for (const log of escrowLogs) {
    try {
      const event = decodeEventLog({
        abi: TrustEscrowAbi,
        data: log.data,
        topics: log.topics,
      });
      if (
        !("projectId" in event.args) ||
        !ids.has(String(event.args.projectId)) ||
        log.blockNumber === null ||
        !log.transactionHash
      )
        continue;
      const base = {
        id: `${log.transactionHash}:${log.logIndex}`,
        hash: log.transactionHash,
        blockNumber: log.blockNumber,
        projectId: event.args.projectId,
        source: "On-chain event" as const,
      };
      if (event.eventName === "MilestoneSettled")
        entries.push({
          ...base,
          kind: "Milestone settled",
          milestoneIndex: Number(event.args.index),
          amount: event.args.grossAmount,
          freelancerGross: event.args.freelancerGross,
          freelancerNet: event.args.freelancerNet,
          clientRefund: event.args.clientRefund,
          serviceFee: event.args.serviceFee,
        });
      else if (event.eventName === "ProjectCreated")
        entries.push({ ...base, kind: "Project created" });
      else if (event.eventName === "ProjectFunded")
        entries.push({
          ...base,
          kind: "Escrow funded",
          amount: event.args.amount,
        });
      else if (event.eventName === "ProjectAccepted")
        entries.push({ ...base, kind: "Project accepted" });
      else if (event.eventName === "MilestoneSubmitted")
        entries.push({
          ...base,
          kind: "Milestone submitted",
          milestoneIndex: Number(event.args.index),
        });
      else if (event.eventName === "ProjectClosed")
        entries.push({ ...base, kind: "Project closed" });
    } catch {
      /* Unrelated escrow/configuration events are not transaction history rows. */
    }
  }
  for (const log of arbitrationLogs) {
    if (log.blockNumber === null || !log.transactionHash) continue;
    try {
      const event = decodeEventLog({
        abi: DisputeArbitrationAbi,
        data: log.data,
        topics: log.topics,
      });
      if (
        !("disputeId" in event.args) ||
        !cases.has(String(event.args.disputeId))
      )
        continue;
      const actor =
        "juror" in event.args
          ? event.args.juror
          : "opener" in event.args
            ? event.args.opener
            : "responder" in event.args
              ? event.args.responder
              : "payer" in event.args
                ? event.args.payer
                : undefined;
      const names: Record<string, string> = {
        DisputeOpened: "Dispute opened",
        DisputeFeeCollected: "Dispute opening fee paid",
        DisputeResponded: "Response hash recorded",
        VoteCast: "Public juror vote",
        DisputeFinalized: "Dispute finalized",
        JurorRewardClaimed: "Juror reward claimed",
        JurorRewardsReserved: "Juror rewards reserved",
        ProtocolFeeDeposited: "Dispute protocol fee deposited",
        VerdictReached: "On-chain verdict reached",
      };
      if (!names[event.eventName]) continue;
      entries.push({
        id: `${log.transactionHash}:${log.logIndex}`,
        hash: log.transactionHash,
        blockNumber: log.blockNumber,
        disputeId: event.args.disputeId,
        projectId: "projectId" in event.args ? event.args.projectId : undefined,
        milestoneIndex:
          "milestoneIndex" in event.args
            ? Number(event.args.milestoneIndex)
            : undefined,
        amount:
          "amount" in event.args
            ? event.args.amount
            : "milestoneAmount" in event.args
              ? event.args.milestoneAmount
              : undefined,
        kind: names[event.eventName],
        source: "On-chain event",
        activity:
          actor?.toLowerCase() === account.toLowerCase()
            ? "Wallet activity"
            : "Related case event",
      });
    } catch {
      /* Configuration or unknown events are not activity rows. */
    }
  }
  for (const log of registryLogs) {
    if (log.blockNumber === null || !log.transactionHash) continue;
    try {
      const event = decodeEventLog({
        abi: JurorRegistryAbi,
        data: log.data,
        topics: log.topics,
      });
      if (
        !("juror" in event.args) ||
        event.args.juror.toLowerCase() !== account.toLowerCase()
      )
        continue;
      const names: Record<string, string> = {
        JurorRegistered: "Juror registered",
        StakeDeposited: "Stake deposited",
        StakeWithdrawn: "Stake withdrawn",
        JurorAssigned: "Juror assigned",
        StakeLocked: "Case stake locked",
        StakeUnlocked: "Case stake unlocked",
      };
      if (!names[event.eventName]) continue;
      entries.push({
        id: `${log.transactionHash}:${log.logIndex}`,
        hash: log.transactionHash,
        blockNumber: log.blockNumber,
        kind: names[event.eventName],
        amount: "amount" in event.args ? event.args.amount : undefined,
        disputeId: "disputeId" in event.args ? event.args.disputeId : undefined,
        source: "On-chain event",
        activity: "Wallet activity",
      });
    } catch {
      /* Unknown/configuration events are not personal registry activity. */
    }
  }
  const spenders = new Set(
    [
      contracts.TrustEscrow.address,
      contracts.DisputeArbitration.address,
      contracts.JurorRegistry.address,
    ].map((a) => a.toLowerCase()),
  );
  for (const log of approvals)
    if (
      log.transactionHash &&
      log.blockNumber !== null &&
      log.args.spender &&
      spenders.has(log.args.spender.toLowerCase())
    )
      entries.push({
        id: `${log.transactionHash}:${log.logIndex}`,
        hash: log.transactionHash,
        blockNumber: log.blockNumber,
        kind: "mUSD allowance approved",
        amount: log.args.value,
        source: "On-chain event",
        activity: "Wallet activity",
      });
  entries.sort((a, b) =>
    a.blockNumber > b.blockNumber
      ? -1
      : a.blockNumber < b.blockNumber
        ? 1
        : a.id.localeCompare(b.id),
  );
  // A timestamp is optional. Bound additional block lookups rather than blocking large pages.
  const blocks = [...new Set(entries.map((e) => e.blockNumber))].slice(0, 30);
  const timestamps = new Map<bigint, bigint>();
  for (let i = 0; i < blocks.length; i += 4)
    await Promise.all(
      blocks.slice(i, i + 4).map(async (blockNumber) => {
        try {
          timestamps.set(
            blockNumber,
            (await client.getBlock({ blockNumber })).timestamp,
          );
        } catch {
          /* hash/block remain useful when timestamp unavailable */
        }
      }),
    );
  return {
    entries: entries.map((e) => ({
      ...e,
      timestamp: timestamps.get(e.blockNumber),
    })),
    next: fromBlock > start ? fromBlock - 1n : undefined,
    fromBlock,
    toBlock: latest,
  };
}
// Keep token ABI available through the generated package; no custom event signatures.
export const tokenApprovalAbi = MockUSDAbi;
