import { getContracts, type LocalDeployment } from "@trustlayer/contracts";
import { type PublicClient } from "viem";
import { ApiError } from "./errors";
import type { MetadataScope } from "./validation";

export interface ProjectAuthority {
  manifest: LocalDeployment;
  client: string;
  freelancer: string;
  milestoneCount: number;
}
export interface ChainAuthority {
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
