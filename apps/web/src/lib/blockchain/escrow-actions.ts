import { encodeFunctionData, type Abi, type Hash } from "viem";
import { localChain, localClient } from "./config";
import { IntegrationError } from "./errors";
import {
  projectActions,
  readProject,
  validEvidenceHash,
  validateProjectDraft,
  type ProjectDraft,
} from "./projects";
import type { ProtocolWriteContext } from "./hooks/use-protocol-transaction";

type ContractRequest = {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
};
export type ActionReadClient = Pick<
  typeof localClient,
  | "readContract"
  | "getBlock"
  | "getCode"
  | "getLogs"
  | "getContractEvents"
  | "simulateContract"
  | "estimateGas"
  | "getGasPrice"
  | "getBalance"
>;
export async function sendChecked(
  context: ProtocolWriteContext,
  request: ContractRequest,
  client: ActionReadClient = localClient,
): Promise<Hash> {
  await client.simulateContract({ ...request, account: context.account });
  const data = encodeFunctionData(request);
  const [estimate, gasPrice, ethBalance] = await Promise.all([
    client.estimateGas({ account: context.account, to: request.address, data }),
    client.getGasPrice(),
    client.getBalance({ address: context.account }),
  ]);
  const gas = (estimate * 120n) / 100n;
  if (ethBalance < gas * gasPrice)
    throw new IntegrationError(
      "unknown",
      "Insufficient local ETH for gas. Provision local ETH outside this app before signing.",
    );
  await context.assertCurrent();
  return context.wallet.writeContract({
    ...request,
    account: context.account,
    chain: localChain,
    gas,
  });
}
export async function createEscrowProject(
  context: ProtocolWriteContext,
  draft: ProjectDraft,
  client: ActionReadClient = localClient,
) {
  const block = await client.getBlock({ blockTag: "latest" });
  const validated = validateProjectDraft(
    draft,
    block.timestamp,
    context.account,
  );
  return sendChecked(
    context,
    {
      ...context.contracts.TrustEscrow,
      functionName: "createProject",
      args: [
        validated.freelancer,
        validated.amounts,
        validated.dueDates,
        validated.metadataHash,
      ],
    },
    client,
  );
}
export type EscrowAction =
  "approveToken" | "fund" | "accept" | "submit" | "approve" | "release";
export async function executeEscrowAction(
  context: ProtocolWriteContext,
  kind: EscrowAction,
  id: bigint,
  evidence?: string,
  client: ActionReadClient = localClient,
  reviewedMilestoneIndex?: number,
) {
  const block = await client.getBlock({ blockTag: "latest" });
  const project = await readProject(
    client,
    context.contracts,
    id,
    block.number,
  );
  const allowed = projectActions(project, context.account, block.timestamp);
  if (
    ["submit", "approve", "release"].includes(kind) &&
    reviewedMilestoneIndex !== undefined &&
    reviewedMilestoneIndex !== project.currentMilestone
  )
    throw new IntegrationError(
      "unknown",
      "The current milestone changed since review. Refresh and review the intended milestone again before signing.",
    );
  if (kind === "fund" || kind === "approveToken") {
    if (!allowed.fund)
      throw new IntegrationError(
        "unknown",
        "Only this project's client may fund it before the acceptance deadline while it is unfunded.",
      );
    const [balance, allowance] = await Promise.all([
      client.readContract({
        ...context.contracts.MockUSD,
        functionName: "balanceOf",
        args: [context.account],
      }),
      client.readContract({
        ...context.contracts.MockUSD,
        functionName: "allowance",
        args: [context.account, context.contracts.TrustEscrow.address],
      }),
    ]);
    if (balance < project.total)
      throw new IntegrationError(
        "unknown",
        "Insufficient mUSD balance for the full project budget. No tokens were deposited.",
      );
    if (kind === "approveToken") {
      if (allowance >= project.total)
        throw new IntegrationError(
          "unknown",
          "The escrow allowance is already sufficient. Review the separate funding action.",
        );
      return sendChecked(
        context,
        {
          ...context.contracts.MockUSD,
          functionName: "approve",
          args: [context.contracts.TrustEscrow.address, project.total],
        },
        client,
      );
    }
    if (allowance < project.total)
      throw new IntegrationError(
        "unknown",
        "Approve the required mUSD allowance and wait for its confirmation before funding.",
      );
  } else if (!allowed[kind])
    throw new IntegrationError(
      "unknown",
      "This wallet, project state, milestone state or chain deadline does not permit the selected action. Refresh the project.",
    );
  const escrow = context.contracts.TrustEscrow;
  if (kind === "fund")
    return sendChecked(
      context,
      { ...escrow, functionName: "fundProject", args: [id] },
      client,
    );
  if (kind === "accept")
    return sendChecked(
      context,
      { ...escrow, functionName: "acceptProject", args: [id] },
      client,
    );
  const index = BigInt(project.currentMilestone);
  if (kind === "submit") {
    if (!evidence || !validEvidenceHash(evidence))
      throw new IntegrationError(
        "unknown",
        "Enter a non-zero 32-byte content hash (0x followed by 64 hexadecimal characters). Do not paste private deliverables.",
      );
    return sendChecked(
      context,
      {
        ...escrow,
        functionName: "submitMilestone",
        args: [id, index, evidence],
      },
      client,
    );
  }
  return sendChecked(
    context,
    {
      ...escrow,
      functionName:
        kind === "approve" ? "approveMilestone" : "releaseAfterReviewTimeout",
      args: [id, index],
    },
    client,
  );
}
