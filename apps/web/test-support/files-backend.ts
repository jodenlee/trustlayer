import type { ChainAuthority } from "../src/lib/server/chain";
import { ApiError } from "../src/lib/server/errors";
import { authBackend } from "./auth-backend";
import { testStorage } from "./storage";
import type { escrowRpc } from "./escrow-rpc";
import type { DisputeRecord } from "../src/lib/blockchain/arbitration";

/** Browser fixture: actual SIWE/SQL/storage service; deterministic chain adapter.
 * Receipt cryptography and actual contract reads are checked by verify-files-workflow. */
export async function filesBackend(
  origin: string,
  state: ReturnType<typeof escrowRpc> & { cases?: DisputeRecord[] },
) {
  const manifest = state.manifest,
    storage = testStorage();
  const chain: ChainAuthority = {
    async project(scope, id, wallet) {
      if (
        scope.deploymentHash !== manifest.verifiedBlock.hash.toLowerCase() ||
        scope.escrowAddress !==
          manifest.contracts.TrustEscrow.address.toLowerCase()
      )
        throw new ApiError(409, "deployment_changed", "Deployment changed");
      const p = state.projects[Number(id)];
      if (!p)
        throw new ApiError(404, "project_missing", "On-chain project missing");
      if (![p.client, p.freelancer].some((a) => a.toLowerCase() === wallet))
        throw new ApiError(
          403,
          "forbidden",
          "Only project participants may access this metadata.",
        );
      return {
        manifest,
        client: p.client.toLowerCase(),
        freelancer: p.freelancer.toLowerCase(),
        milestoneCount: p.milestones.length,
      };
    },
    async milestone(scope, id, index, wallet) {
      const p = await chain.project(scope, id, wallet);
      if (index >= p.milestoneCount)
        throw new ApiError(404, "milestone_missing", "Missing milestone");
      return p;
    },
    async dispute() {
      throw new ApiError(404, "dispute_missing", "No case in this fixture");
    },
    async filesContext(scope, id, index) {
      const p = state.projects[Number(id)];
      await chain.project(scope, id, p?.client.toLowerCase() ?? "");
      const m = p.milestones[index];
      if (!m) throw new ApiError(404, "milestone_missing", "Missing milestone");
      const d = state.cases?.find(
        (d) => String(d.projectId) === id && Number(d.milestoneIndex) === index,
      );
      return {
        manifest,
        now: state.time(),
        projectId: id,
        index,
        client: p.client.toLowerCase(),
        freelancer: p.freelancer.toLowerCase(),
        projectState: p.state,
        currentIndex: p.current,
        milestone: {
          state: m.state,
          hash: m.evidence.toLowerCase(),
          dueAt: m.dueAt,
          reviewEnd: m.reviewEnd,
        },
        dispute: d
          ? {
              id: String(state.cases!.indexOf(d)),
              opener: d.opener.toLowerCase(),
              jurors: d.jurors.map((a) => a.toLowerCase()),
              state: d.status,
              responseDeadline: d.responseDeadline,
              openingHash: d.evidenceHash,
              responseHash: d.responseHash,
            }
          : undefined,
      };
    },
    async fileProof() {
      if (
        !state.writes.includes("submitMilestone") &&
        !state.writes.includes("respondToDispute")
      )
        throw new ApiError(409, "receipt_reference", "Missing test receipt");
      return 21n;
    },
  };
  return {
    ...(await authBackend(origin, { chain, storage: storage.storage })),
    storage,
  };
}
