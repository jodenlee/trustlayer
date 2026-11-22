import {
  getAddress,
  isAddress,
  keccak256,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { TrustEscrowAbi } from "@trustlayer/contracts";
import { parseMUSD } from "../format";
import { IntegrationError } from "./errors";
import type { ContractClients } from "./types";
import type { localClient } from "./config";

export const PROJECT_STATES = [
  "Unfunded",
  "Awaiting acceptance",
  "Active",
  "Completed",
  "Closed",
] as const;
export const MILESTONE_STATES = [
  "Pending",
  "Submitted",
  "Disputed",
  "Settled",
] as const;
export const ACCEPTANCE_SECONDS = 7n * 86400n;
export const DELIVERY_GRACE_SECONDS = 48n * 3600n;
export const PROJECT_PAGE_SIZE = 20n;
export type ReadClient = Pick<
  typeof localClient,
  "readContract" | "getBlock" | "getCode" | "getLogs" | "getContractEvents"
>;
export interface ChainMilestone {
  amount: bigint;
  dueAt: bigint;
  submittedAt: bigint;
  reviewEnd: bigint;
  evidenceHash: Hex;
  state: number;
}
export interface ChainProject {
  id: bigint;
  client: Address;
  freelancer: Address;
  metadataHash: Hex;
  total: bigint;
  escrowRemaining: bigint;
  acceptBy: bigint;
  feeBps: number;
  currentMilestone: number;
  milestoneCount: number;
  state: number;
  milestones: ChainMilestone[];
}
export interface ProjectDraft {
  title: string;
  description: string;
  freelancer: string;
  milestones: {
    title: string;
    description?: string;
    amount: string;
    due: string;
  }[];
}
export interface SessionMetadata {
  title: string;
  description: string;
  milestones: string[];
  metadataHash: Hex;
}
export function projectIdFromPath(value: string): bigint | null {
  if (!/^(0|[1-9]\d*)$/.test(value) || value.length > 78) return null;
  const id = BigInt(value);
  return id <= (1n << 256n) - 1n ? id : null;
}
export function projectRole(
  project: Pick<ChainProject, "client" | "freelancer">,
  account: string,
) {
  return project.client.toLowerCase() === account.toLowerCase()
    ? "Client"
    : project.freelancer.toLowerCase() === account.toLowerCase()
      ? "Freelancer"
      : "Viewer";
}
export function normalAllocation(amount: bigint, feeBps: number) {
  const serviceFee = (amount * BigInt(feeBps)) / 10_000n;
  return { gross: amount, serviceFee, freelancerNet: amount - serviceFee };
}
export function validateProjectDraft(
  draft: ProjectDraft,
  chainNow: bigint,
  client?: Address,
) {
  const fail = (message: string): never => {
    throw new IntegrationError("unknown", message);
  };
  if (!draft.title.trim() || !draft.description.trim())
    fail("Add a project name and scope before reviewing.");
  if (
    !isAddress(draft.freelancer) ||
    getAddress(draft.freelancer) === zeroAddress
  )
    fail("Enter a valid non-zero Ethereum wallet address for the freelancer.");
  const freelancer = getAddress(draft.freelancer);
  if (client && freelancer.toLowerCase() === client.toLowerCase())
    fail("The freelancer cannot be the client wallet.");
  if (draft.milestones.length < 1 || draft.milestones.length > 5)
    fail("A project must have one to five milestones.");
  let previous = chainNow + ACCEPTANCE_SECONDS;
  const amounts: bigint[] = [];
  const dueDates: bigint[] = [];
  for (const [index, milestone] of draft.milestones.entries()) {
    if (!milestone.title.trim()) fail(`Add a name for milestone ${index + 1}.`);
    const amount = parseMUSD(milestone.amount);
    if (amount === null)
      fail(
        `Milestone ${index + 1} needs a positive mUSD amount with at most six decimal places, within uint256.`,
      );
    const date = /^\d{4}-\d{2}-\d{2}$/.test(milestone.due)
      ? Date.parse(`${milestone.due}T00:00:00Z`)
      : NaN;
    if (!Number.isFinite(date)) fail("Enter a valid UTC due date.");
    if (new Date(date).toISOString().slice(0, 10) !== milestone.due)
      fail("Enter an existing UTC calendar date.");
    const due = BigInt(date / 1000);
    if (due <= previous || due > (1n << 64n) - 1n)
      fail(
        index === 0
          ? "The first due date must be more than 7 days after the current chain time (UTC)."
          : "Milestone due dates must be in strictly increasing order (UTC).",
      );
    amounts.push(amount!);
    dueDates.push(due);
    previous = due;
  }
  const total = amounts.reduce((a, b) => a + b, 0n);
  if (total > (1n << 256n) - 1n)
    fail("The combined milestone budget exceeds the contract amount limit.");
  const metadata = {
    title: draft.title.trim(),
    description: draft.description.trim(),
    milestones: draft.milestones.map((m) => m.title.trim()),
  };
  const metadataHash = keccak256(
    stringToHex(
      JSON.stringify({
        version: 1,
        ...metadata,
        amounts: amounts.map(String),
        dueDates: dueDates.map(String),
      }),
    ),
  );
  return {
    freelancer,
    amounts,
    dueDates,
    total,
    metadataHash,
    metadata: { ...metadata, metadataHash } satisfies SessionMetadata,
  };
}
export function validEvidenceHash(value: string): value is Hex {
  return /^0x[\da-f]{64}$/i.test(value) && !/^0x0{64}$/i.test(value);
}
export function chainDate(value: bigint) {
  if (!value) return "Not set";
  if (value > 8_640_000_000_000n) return `${value} Unix seconds`;
  return new Date(Number(value) * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", " UTC");
}
export function projectActions(
  project: ChainProject,
  account: Address,
  now: bigint,
) {
  const role = projectRole(project, account);
  const m = project.milestones[project.currentMilestone];
  return {
    fund: role === "Client" && project.state === 0 && now <= project.acceptBy,
    accept:
      role === "Freelancer" && project.state === 1 && now <= project.acceptBy,
    submit:
      role === "Freelancer" &&
      project.state === 2 &&
      m?.state === 0 &&
      now <= m.dueAt + DELIVERY_GRACE_SECONDS,
    approve: role === "Client" && project.state === 2 && m?.state === 1,
    release:
      role === "Freelancer" &&
      project.state === 2 &&
      m?.state === 1 &&
      now > m.reviewEnd,
  };
}
export async function readProject(
  client: ReadClient,
  contracts: ContractClients,
  id: bigint,
  blockNumber?: bigint,
): Promise<ChainProject> {
  const next = await client.readContract({
    ...contracts.TrustEscrow,
    functionName: "nextProjectId",
    blockNumber,
  });
  if (id < 0n || id >= next)
    throw new IntegrationError(
      "unknown",
      "This on-chain project does not exist.",
    );
  const p = await client.readContract({
    ...contracts.TrustEscrow,
    functionName: "projects",
    args: [id],
    blockNumber,
  });
  const milestones = await Promise.all(
    Array.from({ length: p[8] }, async (_, i) => {
      const m = await client.readContract({
        ...contracts.TrustEscrow,
        functionName: "milestones",
        args: [id, BigInt(i)],
        blockNumber,
      });
      return {
        amount: m[0],
        dueAt: m[1],
        submittedAt: m[2],
        reviewEnd: m[3],
        evidenceHash: m[4],
        state: m[5],
      };
    }),
  );
  return {
    id,
    client: p[0],
    freelancer: p[1],
    metadataHash: p[2],
    total: p[3],
    escrowRemaining: p[4],
    acceptBy: p[5],
    feeBps: p[6],
    currentMilestone: p[7],
    milestoneCount: p[8],
    state: p[9],
    milestones,
  };
}
export interface ProjectCursor {
  before: bigint;
  blockNumber: bigint;
}
export async function readProjectPage(
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
      ...contracts.TrustEscrow,
      functionName: "nextProjectId",
      blockNumber: block.number,
    }));
  const start = before > PROJECT_PAGE_SIZE ? before - PROJECT_PAGE_SIZE : 0n;
  const projects: ChainProject[] = [];
  // Four concurrent candidate reads, at most twenty candidates and five milestones each.
  for (let high = before; high > start;) {
    const ids: bigint[] = [];
    while (ids.length < 4 && high > start) ids.push(--high);
    const candidates = await Promise.all(
      ids.map(async (id) => {
        const p = await client.readContract({
          ...contracts.TrustEscrow,
          functionName: "projects",
          args: [id],
          blockNumber: block.number,
        });
        return p[0].toLowerCase() === account.toLowerCase() ||
          p[1].toLowerCase() === account.toLowerCase()
          ? readProject(client, contracts, id, block.number)
          : null;
      }),
    );
    projects.push(...candidates.filter((p): p is ChainProject => !!p));
  }
  return {
    projects,
    scanned: before - start,
    now: block.timestamp,
    next: start > 0n ? { before: start, blockNumber: block.number } : undefined,
  };
}
export function createdProjectFromReceipt(
  logs: Parameters<typeof import("viem").parseEventLogs>[0]["logs"],
  escrow: Address,
  account: Address,
) {
  // Imported below through the existing generated ABI, never predicted from nextProjectId.
  return import("viem").then(({ parseEventLogs }) => {
    const events = parseEventLogs({
      abi: TrustEscrowAbi,
      eventName: "ProjectCreated",
      logs,
    });
    const event = events.find(
      (e) =>
        e.address.toLowerCase() === escrow.toLowerCase() &&
        e.args.client.toLowerCase() === account.toLowerCase(),
    );
    if (!event)
      throw new IntegrationError(
        "unknown",
        "Creation confirmed, but the ProjectCreated receipt event could not be verified. Check transaction history before retrying.",
      );
    return event.args.projectId;
  });
}
