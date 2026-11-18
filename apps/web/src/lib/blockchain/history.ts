import { MockUSDAbi, TrustEscrowAbi } from "@trustlayer/contracts";
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
  const [escrowLogs, approvals] = await Promise.all([
    client.getLogs({
      address: contracts.TrustEscrow.address,
      fromBlock,
      toBlock: latest,
    }),
    client.getContractEvents({
      ...contracts.MockUSD,
      eventName: "Approval",
      args: { owner: account, spender: contracts.TrustEscrow.address },
      fromBlock,
      toBlock: latest,
      strict: true,
    }),
  ]);
  if (escrowLogs.length + approvals.length > 2000)
    throw new Error(
      "This 200-block history page is too dense for the local UI. Use a block explorer or a future event indexer; no partial page was presented as complete.",
    );
  const ids = new Set(projectIds.map(String));
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
  for (const log of approvals)
    if (log.transactionHash && log.blockNumber !== null)
      entries.push({
        id: `${log.transactionHash}:${log.logIndex}`,
        hash: log.transactionHash,
        blockNumber: log.blockNumber,
        kind: "mUSD allowance approved",
        amount: log.args.value,
        source: "On-chain event",
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
