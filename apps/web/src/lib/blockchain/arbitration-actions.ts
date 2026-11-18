import { type Hash } from "viem";
import { localClient } from "./config";
import { IntegrationError } from "./errors";
import { sendChecked, type ActionReadClient } from "./escrow-actions";
import type { ProtocolWriteContext } from "./hooks/use-protocol-transaction";
import { readProject, validEvidenceHash } from "./projects";
import {
  DISPUTE_FEE,
  openingAllowed,
  readCase,
  caseActions,
} from "./arbitration";
import { parseMUSD } from "../format";

const fail = (message: string): never => {
  throw new IntegrationError("unknown", message);
};
export function stakeAmount(value: string) {
  const amount = parseMUSD(value);
  if (amount === null)
    return fail(
      "Enter a positive mUSD amount with at most six decimal places within uint256.",
    );
  return amount;
}
export async function openMilestoneDispute(
  context: ProtocolWriteContext,
  projectId: bigint,
  index: number,
  evidence: string,
  approveOnly = false,
  client: ActionReadClient = localClient,
): Promise<Hash> {
  const block = await client.getBlock({ blockTag: "latest" });
  const [project, existing] = await Promise.all([
    readProject(client, context.contracts, projectId, block.number),
    client.readContract({
      ...context.contracts.DisputeArbitration,
      functionName: "getMilestoneDispute",
      args: [projectId, BigInt(index)],
      blockNumber: block.number,
    }),
  ]);
  if (
    !openingAllowed(
      project,
      index,
      context.account,
      block.timestamp,
      existing[0],
    )
  )
    fail(
      "This wallet, milestone, existing case or review deadline does not permit opening. Refresh the project and review again.",
    );
  if (!validEvidenceHash(evidence))
    fail(
      "Enter a nonzero 32-byte evidence hash. Never include confidential deliverables.",
    );
  const target = context.contracts.DisputeArbitration;
  const [balance, allowance] = await Promise.all([
    client.readContract({
      ...context.contracts.MockUSD,
      functionName: "balanceOf",
      args: [context.account],
    }),
    client.readContract({
      ...context.contracts.MockUSD,
      functionName: "allowance",
      args: [context.account, target.address],
    }),
  ]);
  if (balance < DISPUTE_FEE)
    fail(
      "Insufficient mUSD: the participant opening this dispute must pay 15 mUSD from their own wallet.",
    );
  if (approveOnly) {
    if (allowance >= DISPUTE_FEE)
      fail(
        "The dispute-fee allowance is already sufficient. Opening is a separate action.",
      );
    return sendChecked(
      context,
      {
        ...context.contracts.MockUSD,
        functionName: "approve",
        args: [target.address, DISPUTE_FEE],
      },
      client,
    );
  }
  if (allowance < DISPUTE_FEE)
    fail(
      "Approve 15 mUSD to arbitration and wait for confirmation before opening.",
    );
  try {
    await client.readContract({
      ...context.contracts.JurorRegistry,
      functionName: "previewJurors",
      args: [project.client, project.freelancer],
    });
  } catch {
    fail(
      "Cannot reserve three eligible jurors excluding both participants. Check juror stakes and the local RPC, then retry.",
    );
  }
  return sendChecked(
    context,
    {
      ...target,
      functionName: "openDispute",
      args: [projectId, BigInt(index), evidence],
    },
    client,
  );
}
export type CaseAction = "respond" | "vote" | "finalize" | "claim";
export async function executeCaseAction(
  context: ProtocolWriteContext,
  kind: CaseAction,
  id: bigint,
  value?: number | string,
  client: ActionReadClient = localClient,
): Promise<Hash> {
  const block = await client.getBlock({ blockTag: "latest" });
  const current = await readCase(
    client,
    context.contracts,
    id,
    context.account,
    block.number,
  );
  if (
    !caseActions(
      current.dispute,
      context.account,
      block.timestamp,
      current.vote,
      current.claimable,
    )[kind]
  )
    fail(
      "The wallet, current case state, recorded vote/reward or on-chain deadline does not permit this action. Refresh and review again.",
    );
  const target = context.contracts.DisputeArbitration;
  if (kind === "respond") {
    if (typeof value !== "string" || !validEvidenceHash(value))
      fail(
        "Enter a nonzero 32-byte response hash; private files stay off-chain.",
      );
    return sendChecked(
      context,
      { ...target, functionName: "respondToDispute", args: [id, value] },
      client,
    );
  }
  if (kind === "vote") {
    if (typeof value !== "number" || ![1, 2, 3].includes(value))
      fail("Choose Freelancer wins, Client wins or Split.");
    return sendChecked(
      context,
      { ...target, functionName: "castVote", args: [id, value] },
      client,
    );
  }
  return sendChecked(
    context,
    {
      ...target,
      functionName: kind === "claim" ? "claimJurorReward" : "finalizeDispute",
      args: [id],
    },
    client,
  );
}
export type JurorAction = "register" | "approveStake" | "deposit" | "withdraw";
export async function executeJurorAction(
  context: ProtocolWriteContext,
  kind: JurorAction,
  amount = 0n,
  client: ActionReadClient = localClient,
): Promise<Hash> {
  const target = context.contracts.JurorRegistry;
  const info = await client.readContract({
    ...target,
    functionName: "getJurorInfo",
    args: [context.account],
  });
  if (kind === "register") {
    if (info.registered) fail("This wallet is already registered.");
    return sendChecked(
      context,
      { ...target, functionName: "registerJuror", args: [] },
      client,
    );
  }
  if (!info.registered) fail("Register this wallet as a juror first.");
  if (amount <= 0n || amount > (1n << 256n) - 1n)
    fail("Enter a positive mUSD amount within uint256.");
  if (kind === "withdraw") {
    if (amount > info.availableStake)
      fail(
        "Only unlocked stake is withdrawable. This amount exceeds your available stake.",
      );
    return sendChecked(
      context,
      { ...target, functionName: "withdrawStake", args: [amount] },
      client,
    );
  }
  const [balance, allowance] = await Promise.all([
    client.readContract({
      ...context.contracts.MockUSD,
      functionName: "balanceOf",
      args: [context.account],
    }),
    client.readContract({
      ...context.contracts.MockUSD,
      functionName: "allowance",
      args: [context.account, target.address],
    }),
  ]);
  if (balance < amount)
    fail("Insufficient mUSD balance for this stake deposit.");
  if (kind === "approveStake") {
    if (allowance >= amount)
      fail(
        "The stake allowance is already sufficient. Deposit is a separate action.",
      );
    return sendChecked(
      context,
      {
        ...context.contracts.MockUSD,
        functionName: "approve",
        args: [target.address, amount],
      },
      client,
    );
  }
  if (allowance < amount)
    fail(
      "Approve the stake amount and wait for confirmation before depositing.",
    );
  return sendChecked(
    context,
    { ...target, functionName: "depositStake", args: [amount] },
    client,
  );
}
