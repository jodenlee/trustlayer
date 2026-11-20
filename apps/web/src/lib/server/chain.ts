import {
  getContracts,
  type LocalDeployment,
  TrustEscrowAbi,
  DisputeArbitrationAbi,
} from "@trustlayer/contracts";
import { decodeEventLog, type PublicClient, type Hash } from "viem";
import { ApiError } from "./errors";
import type { MetadataScope } from "./validation";

export interface ProjectAuthority {
  manifest: LocalDeployment;
  client: string;
  freelancer: string;
  milestoneCount: number;
}
export interface ChainAuthority {
  filesContext?(
    scope: MetadataScope,
    projectId: string,
    index: number,
    disputeId?: string,
  ): Promise<AttachmentContext>;
  fileProof?(
    scope: MetadataScope,
    context: AttachmentContext,
    category: string,
    hash: string,
    wallet: string,
    transaction: Hash,
  ): Promise<bigint>;
  project(
    scope: MetadataScope,
    projectId: string,
    wallet: string,
  ): Promise<ProjectAuthority>;
  milestone(
    scope: MetadataScope,
    projectId: string,
    index: number,
    wallet: string,
  ): Promise<ProjectAuthority>;
  dispute(
    scope: MetadataScope,
    disputeId: string,
    wallet: string,
  ): Promise<{ projectId: string; milestoneIndex: number }>;
}
export interface AttachmentContext {
  manifest: LocalDeployment;
  now: bigint;
  projectId: string;
  index: number;
  client: string;
  freelancer: string;
  projectState: number;
  currentIndex: number;
  milestone: { state: number; hash: string; dueAt: bigint; reviewEnd: bigint };
  dispute?: {
    id: string;
    opener: string;
    jurors: string[];
    state: number;
    responseDeadline: bigint;
    openingHash: string;
    responseHash: string;
  };
}
/** Fresh live validation is provided by load(), independently of browser state. */
export function chainAuthority(
  load: () => Promise<{ manifest: LocalDeployment; client: PublicClient }>,
): ChainAuthority {
  async function verified(scope: MetadataScope) {
    const { manifest, client } = await load();
    if (
      String(manifest.chainId) !== scope.chainId ||
      manifest.contracts.TrustEscrow.address.toLowerCase() !==
        scope.escrowAddress ||
      manifest.verifiedBlock.hash.toLowerCase() !== scope.deploymentHash
    )
      throw new ApiError(
        409,
        "deployment_changed",
        "The requested deployment is not the verified active deployment. Refresh the local export.",
      );
    return {
      manifest,
      client,
      contracts: getContracts(manifest, manifest.chainId),
    };
  }
  const authority: ChainAuthority = {
    async filesContext(scope, projectId, index, disputeId) {
      const { manifest, client, contracts } = await verified(scope);
      const block = await client.getBlock();
      const blockNumber = block.number;
      const count = await client.readContract({
        ...contracts.TrustEscrow,
        functionName: "nextProjectId",
        blockNumber,
      });
      if (BigInt(projectId) >= count)
        throw new ApiError(
          404,
          "project_missing",
          "On-chain project not found.",
        );
      const p = await client.readContract({
        ...contracts.TrustEscrow,
        functionName: "projects",
        args: [BigInt(projectId)],
        blockNumber,
      });
      if (index < 0 || index >= p[8])
        throw new ApiError(
          404,
          "milestone_missing",
          "On-chain milestone not found.",
        );
      const m = await client.readContract({
        ...contracts.TrustEscrow,
        functionName: "milestones",
        args: [BigInt(projectId), BigInt(index)],
        blockNumber,
      });
      const existing = await client.readContract({
        ...contracts.DisputeArbitration,
        functionName: "getMilestoneDispute",
        args: [BigInt(projectId), BigInt(index)],
        blockNumber,
      });
      if (
        disputeId !== undefined &&
        (!existing[0] || existing[1] !== BigInt(disputeId))
      )
        throw new ApiError(
          409,
          "case_binding",
          "Dispute does not belong to this project and milestone.",
        );
      const d = existing[0]
        ? await client.readContract({
            ...contracts.DisputeArbitration,
            functionName: "getDispute",
            args: [existing[1]],
            blockNumber,
          })
        : undefined;
      return {
        manifest,
        now: block.timestamp,
        projectId,
        index,
        client: p[0].toLowerCase(),
        freelancer: p[1].toLowerCase(),
        projectState: p[9],
        currentIndex: p[7],
        milestone: {
          state: m[5],
          hash: m[4].toLowerCase(),
          dueAt: m[1],
          reviewEnd: m[3],
        },
        dispute: d
          ? {
              id: String(existing[1]),
              opener: d.opener.toLowerCase(),
              jurors: d.jurors.map((a) => a.toLowerCase()),
              state: d.status,
              responseDeadline: d.responseDeadline,
              openingHash: d.evidenceHash.toLowerCase(),
              responseHash: d.responseHash.toLowerCase(),
            }
          : undefined,
      };
    },
    async fileProof(scope, context, category, hash, wallet, transaction) {
      const { client, contracts } = await verified(scope);
      const receipt = await client.getTransactionReceipt({ hash: transaction });
      if (
        receipt.status !== "success" ||
        receipt.from.toLowerCase() !== wallet ||
        (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !==
          receipt.blockHash
      )
        throw new ApiError(
          409,
          "receipt_invalid",
          "A canonical successful receipt from the uploading wallet is required.",
        );
      const address =
        category === "deliverable"
          ? contracts.TrustEscrow.address
          : contracts.DisputeArbitration.address;
      let found = false;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== address.toLowerCase()) continue;
        try {
          if (category === "deliverable") {
            const e = decodeEventLog({
              abi: TrustEscrowAbi,
              eventName: "MilestoneSubmitted",
              data: log.data,
              topics: log.topics,
            });
            found ||=
              e.args.projectId === BigInt(context.projectId) &&
              e.args.index === BigInt(context.index) &&
              e.args.evidenceHash.toLowerCase() === hash;
          } else if (category === "opening") {
            const e = decodeEventLog({
              abi: DisputeArbitrationAbi,
              eventName: "DisputeOpened",
              data: log.data,
              topics: log.topics,
            });
            found ||=
              e.args.projectId === BigInt(context.projectId) &&
              e.args.milestoneIndex === BigInt(context.index) &&
              String(e.args.disputeId) === context.dispute?.id &&
              e.args.opener.toLowerCase() === wallet &&
              e.args.evidenceHash.toLowerCase() === hash;
          } else {
            const e = decodeEventLog({
              abi: DisputeArbitrationAbi,
              eventName: "DisputeResponded",
              data: log.data,
              topics: log.topics,
            });
            found ||=
              String(e.args.disputeId) === context.dispute?.id &&
              e.args.responder.toLowerCase() === wallet &&
              e.args.evidenceHash.toLowerCase() === hash;
          }
        } catch {
          /* Ignore nonmatching events; a matching event is mandatory. */
        }
      }
      if (!found)
        throw new ApiError(
          409,
          "receipt_reference",
          "Receipt does not contain this file hash for the expected on-chain reference.",
        );
      return receipt.blockNumber;
    },
    async project(scope, projectId, wallet) {
      const { manifest, client, contracts } = await verified(scope);
      const blockNumber = await client.getBlockNumber();
      const count = await client.readContract({
        ...contracts.TrustEscrow,
        functionName: "nextProjectId",
        blockNumber,
      });
      if (BigInt(projectId) >= count)
        throw new ApiError(
          404,
          "project_missing",
          "On-chain project not found.",
        );
      const p = await client.readContract({
        ...contracts.TrustEscrow,
        functionName: "projects",
        args: [BigInt(projectId)],
        blockNumber,
      });
      const [clientWallet, freelancer] = [
        p[0].toLowerCase(),
        p[1].toLowerCase(),
      ];
      if (wallet !== clientWallet && wallet !== freelancer)
        throw new ApiError(
          403,
          "forbidden",
          "Only project participants may access this metadata.",
        );
      return {
        manifest,
        client: clientWallet,
        freelancer,
        milestoneCount: p[8],
      };
    },
    async milestone(scope, projectId, index, wallet) {
      const project = await authority.project(scope, projectId, wallet);
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= project.milestoneCount
      )
        throw new ApiError(
          404,
          "milestone_missing",
          "On-chain milestone not found.",
        );
      return project;
    },
    async dispute(scope, disputeId, wallet) {
      const { client, contracts } = await verified(scope);
      const blockNumber = await client.getBlockNumber();
      const count = await client.readContract({
        ...contracts.DisputeArbitration,
        functionName: "nextDisputeId",
        blockNumber,
      });
      if (BigInt(disputeId) >= count)
        throw new ApiError(
          404,
          "dispute_missing",
          "On-chain dispute not found.",
        );
      const d = await client.readContract({
        ...contracts.DisputeArbitration,
        functionName: "getDispute",
        args: [BigInt(disputeId)],
        blockNumber,
      });
      if (
        ![d.client, d.freelancer, ...d.jurors].some(
          (a) => a.toLowerCase() === wallet,
        )
      )
        throw new ApiError(
          403,
          "forbidden",
          "Only participants and assigned jurors may access dispute metadata.",
        );
      return {
        projectId: String(d.projectId),
        milestoneIndex: Number(d.milestoneIndex),
      };
    },
  };
  return authority;
}
