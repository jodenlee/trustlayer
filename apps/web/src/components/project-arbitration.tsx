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
import { Disclosure, Field, Input, KeyValue } from "./ui";
import { Money } from "./money";
import { useWorkflowInput } from "./workflow-provider";
import { useState } from "react";
import { PrivateFiles, fileAssociationUrl } from "./private-files";
import { backendRequest } from "@/lib/auth-client";
import type { FileRecord } from "@/lib/files";
import { useUi } from "./providers";
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
  const { toast } = useUi();
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
  if (!read.deployment.readable) return null;
  if (read.error)
    return (
      <p role="alert" className="form-error">
        Dispute eligibility unavailable. {describeError(read.error).message}
      </p>
    );
  if (!view)
    return (
      <p role="status" className="small text-muted">
        Checking dispute eligibility…
      </p>
    );
  if (view.existing[0])
    return (
      <p className="small">
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
    <Disclosure
      summary="Problem with this milestone? Open a dispute"
      hint={`Until ${chainDate(project.milestones[index].reviewEnd)}`}
    >
      <div className="stack-sm">
        <p className="small text-muted">
          Opening a dispute freezes{" "}
          <Money amount={project.milestones[index].amount} /> for this milestone
          and asks three jurors to decide. You pay a 15 mUSD dispute fee. The
          other party gets 12 hours to respond, then jurors have 24 hours to
          vote.
        </p>
        <KeyValue
          items={[
            { label: "Your balance", value: <Money amount={view.balance} /> },
            {
              label: "Approved for disputes",
              value: <Money amount={view.allowance} />,
            },
          ]}
        />
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
        <Field
          id={`dispute-evidence-${index}`}
          label="Opening evidence hash"
          hint="Filled in automatically after a private upload. Only this fingerprint is recorded publicly; the file stays off-chain."
        >
          <Input
            id={`dispute-evidence-${index}`}
            value={evidence}
            spellCheck={false}
            onChange={(e) => setEvidence(e.target.value.trim())}
            placeholder="0x followed by 64 hexadecimal characters"
          />
        </Field>
        {view.balance < DISPUTE_FEE && (
          <p role="alert" className="form-error">
            Insufficient mUSD: the opener needs 15 mUSD to pay the fee.
          </p>
        )}
        <div className="button-row">
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
              openMilestoneDispute(
                context,
                project.id,
                index,
                evidence,
                approval,
              )
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
                          fileAssociationUrl(
                            context.manifest,
                            attachment.file.id,
                          ),
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
                ? "Allow the dispute contract to take exactly 15 mUSD. This doesn’t open the dispute yet; once it’s confirmed, review opening separately."
                : "Pay the 15 mUSD fee and open the case. The milestone is frozen and three jurors are assigned in the same transaction; if three eligible jurors aren’t available, the transaction fails and no fee is taken."}
            </p>
            <p className="mt-3 small">
              Project #{project.id.toString()} · Milestone {index + 1}. After
              the case closes, the fee pays three jurors 4 mUSD each and 3 mUSD
              to the protocol treasury.
            </p>
          </ReviewedAction>
        </div>
      </div>
    </Disclosure>
  );
}
