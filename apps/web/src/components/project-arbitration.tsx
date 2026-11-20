"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOpening } from "@/lib/blockchain/hooks/use-arbitration";
import {
  DISPUTE_FEE,
  openingAllowed,
  openedDisputeFromReceipt,
} from "@/lib/blockchain/arbitration";
import { openMilestoneDispute } from "@/lib/blockchain/arbitration-actions";
import { localClient } from "@/lib/blockchain/config";
import {
  chainDate,
  validEvidenceHash,
  type ChainProject,
} from "@/lib/blockchain/projects";
import { describeError } from "@/lib/blockchain/errors";
import { ReviewedAction } from "./reviewed-action";
import { Field, Input } from "./ui";
import { Money } from "./money";
import { useWorkflowInput } from "./workflow-provider";
import { useState } from "react";
import { PrivateFiles, fileAssociationUrl } from "./private-files";
import { backendRequest } from "@/lib/auth-client";
import type { FileRecord } from "@/lib/files";
import { usePreview } from "./providers";
import { deploymentScope } from "@/lib/blockchain/session";

export function ProjectArbitration({
  project,
  index,
}: {
  project: ChainProject;
  index: number;
}) {
  const read = useOpening(project, index);
  const router = useRouter();
  const { toast } = usePreview();
  const [attachment, setAttachment] = useState<{
    file: FileRecord;
    scope: string;
  }>();
  const [evidence, setEvidence] = useWorkflowInput(
    read.deployment.data?.manifest,
    read.deployment.address,
    `opening:${project.id}:${index}`,
  );
  const view = read.view;
  if (!read.deployment.ready) return null;
  if (read.error)
    return (
      <p role="alert" className="form-error mt-4">
        Dispute eligibility unavailable. {describeError(read.error).message}
      </p>
    );
  if (!view)
    return (
      <p role="status" className="small mt-4">
        Checking dispute eligibility…
      </p>
    );
  if (view.existing[0])
    return (
      <p className="mt-4">
        <Link className="text-link" href={`/disputes/${view.existing[1]}`}>
          View on-chain dispute #{view.existing[1].toString()}
        </Link>
      </p>
    );
  if (
    !openingAllowed(project, index, read.deployment.address!, view.now, false)
  )
    return null;
  const approval = view.allowance < DISPUTE_FEE;
  return (
    <div className="mt-5 space-y-3">
      <h3>Dispute this milestone</h3>
      <p className="small text-muted">
        Disputable amount <Money amount={project.milestones[index].amount} /> ·
        Dispute opening deadline{" "}
        {chainDate(project.milestones[index].reviewEnd)}. You pay 15 mUSD as the
        opener. Opening freezes this milestone on-chain and reserves three
        jurors through predictable rotation.
      </p>
      <p className="small">
        Your mUSD balance <Money amount={view.balance} /> · Arbitration
        allowance <Money amount={view.allowance} />
      </p>
      <Field
        id={`dispute-evidence-${index}`}
        label="Opening evidence hash"
        hint="A nonzero public bytes32 reference. Upload privately to use a verified SHA-256 content hash; file bytes stay off-chain."
      >
        <Input
          id={`dispute-evidence-${index}`}
          value={evidence}
          onChange={(e) => setEvidence(e.target.value.trim())}
          placeholder="0x followed by 64 hexadecimal characters"
        />
      </Field>
      <PrivateFiles
        key={`${deploymentScope(read.deployment.data!.manifest)}:${read.deployment.address}`}
        manifest={read.deployment.data!.manifest}
        projectId={project.id}
        index={index}
        category="opening"
        canUpload
        onSelected={(file) => {
          setEvidence(file.content_hash);
          setAttachment({
            file,
            scope: deploymentScope(read.deployment.data!.manifest),
          });
        }}
      />
      {view.balance < DISPUTE_FEE && (
        <p role="alert" className="form-error">
          Insufficient mUSD: the opener needs 15 mUSD to pay the fee.
        </p>
      )}
      <ReviewedAction
        title={approval ? "Approve 15 mUSD dispute fee" : "Open dispute"}
        disabled={
          read.isFetching ||
          view.balance < DISPUTE_FEE ||
          !validEvidenceHash(evidence)
        }
        details={{
          projectId: project.id,
          milestoneIndex: index,
          amount: DISPUTE_FEE,
        }}
        submit={(context) =>
          openMilestoneDispute(context, project.id, index, evidence, approval)
        }
        onConfirmed={
          approval
            ? undefined
            : async (receipt, context) => {
                const mined = await localClient.getTransactionReceipt({
                  hash: receipt.transactionHash,
                });
                const id = openedDisputeFromReceipt(
                  mined.logs,
                  context.contracts.DisputeArbitration.address,
                  project.id,
                  index,
                  context.account,
                );
                if (
                  attachment?.scope === deploymentScope(context.manifest) &&
                  attachment.file.content_hash === evidence.toLowerCase() &&
                  attachment.file.project_id === String(project.id) &&
                  attachment.file.milestone_index === index &&
                  attachment.file.uploader === context.account.toLowerCase()
                ) {
                  try {
                    await backendRequest(
                      fileAssociationUrl(context.manifest, attachment.file.id),
                      "POST",
                      {
                        transactionHash: receipt.transactionHash,
                        disputeId: String(id),
                      },
                    );
                  } catch {
                    toast(
                      "Dispute confirmed on-chain. Private evidence association needs a separate retry using this receipt; do not open another dispute.",
                    );
                  }
                }
                router.push(`/disputes/${id}`);
              }
        }
      >
        <p>
          {approval
            ? "Grant arbitration exactly 15 mUSD of allowance. This does not open a dispute or pay the fee; wait for confirmation, then review opening separately."
            : "Pay 15 mUSD from your wallet and open the case for this milestone. The contract freezes escrow and locks three jurors atomically; if fewer than three eligible nonparticipants can be reserved, the entire transaction reverts."}
        </p>
        <p className="mt-3">
          Project #{project.id.toString()} · Milestone {index + 1}. Fee
          distribution after finalization: 3 mUSD treasury and three 4 mUSD
          juror claims.
        </p>
      </ReviewedAction>
    </div>
  );
}
