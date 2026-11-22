import type { LocalDeployment } from "@trustlayer/contracts";
import type { PersistentProject } from "./files";
import { backendRequest } from "./auth-client";
export function metadataScope(manifest: LocalDeployment) {
  return new URLSearchParams({
    chainId: String(manifest.chainId),
    escrowAddress: manifest.contracts.TrustEscrow.address.toLowerCase(),
    deploymentHash: manifest.verifiedBlock.hash.toLowerCase(),
  });
}
export interface MetadataDraft {
  title: string;
  description: string;
  milestones: { index: number; name?: string; description: string }[];
  expectedRevision?: number;
}
export const projectMetadataUrl = (manifest: LocalDeployment, id: bigint) =>
  `/api/projects/${id}?${metadataScope(manifest)}`;
export async function synchronizeMetadata(
  manifest: LocalDeployment,
  id: bigint,
  data: MetadataDraft,
) {
  return backendRequest<{ project: PersistentProject }>(
    projectMetadataUrl(manifest, id),
    "PUT",
    data,
  );
}
/** Chain confirmation has already succeeded. A metadata error never re-sends it. */
export async function syncConfirmedProject(
  manifest: LocalDeployment,
  id: bigint,
  data: MetadataDraft,
) {
  try {
    await synchronizeMetadata(manifest, id, data);
    return { synced: true as const };
  } catch (error) {
    return {
      synced: false as const,
      message:
        error instanceof Error
          ? error.message
          : "Metadata synchronization failed.",
    };
  }
}
