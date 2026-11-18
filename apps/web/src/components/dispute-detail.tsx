"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  FileText,
  Info,
  LockKeyhole,
  UserRound,
} from "lucide-react";
import type { Dispute, Project } from "@/lib/models";
import { deadlineLabel } from "@/lib/format";
import {
  Button,
  Card,
  CardHeading,
  EmptyState,
  PageHeading,
  StatusBadge,
  TextLink,
  TimelineItem,
} from "./ui";
import { Money } from "./money";
import { Dialog } from "./dialog";
import { usePreview } from "./providers";
export function DisputeDetail({
  dispute,
  project,
}: {
  dispute: Dispute;
  project: Project;
}) {
  const [evidence, setEvidence] = useState(false);
  const { sample } = usePreview();
  const milestone = project.milestones[dispute.milestoneIndex];
  if (!sample)
    return (
      <>
        <PageHeading
          title="Dispute details"
          description="No account case has been loaded."
        />
        <Card>
          <EmptyState
            title="No case data to display"
            description="Switch to sample data to explore this illustrative case."
            action={<TextLink href="/disputes">Back to disputes</TextLink>}
          />
        </Card>
      </>
    );
  return (
    <>
      <Link href="/disputes" className="back-link">
        <ArrowLeft size={14} />
        All disputes
      </Link>
      <PageHeading
        eyebrow={`${dispute.id.toUpperCase()} · SAMPLE CASE`}
        title={milestone.title}
        description={`${project.title} · ${project.client} & ${project.freelancer}`}
        action={<StatusBadge status={dispute.state} />}
      />
      <div className="detail-grid">
        <div className="space-y-5">
          <Card>
            <CardHeading
              title="Case overview"
              action={
                <TextLink href={`/projects/${project.id}`}>
                  View project
                </TextLink>
              }
            />
            <div className="card-body pt-0!">
              <p className="text-muted text-sm">{dispute.reason}</p>
              <dl className="summary-list mt-4">
                <div>
                  <dt>Disputed amount</dt>
                  <dd>
                    <Money amount={milestone.amount} />
                  </dd>
                </div>
                <div>
                  <dt>Milestone state</dt>
                  <dd>
                    <span className="inline-flex items-center gap-1.5">
                      <LockKeyhole size={13} />
                      Frozen
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Opening fee</dt>
                  <dd>15 mUSD · paid by opener</dd>
                </div>
                <div>
                  <dt>Settlement outcome</dt>
                  <dd>Not finalized</dd>
                </div>
              </dl>
            </div>
          </Card>
          <Card>
            <CardHeading
              title="Evidence overview"
              description="A private record of the agreement and the work."
            />
            <div className="card-body pt-0!">
              <div className="flex gap-3 items-start p-4 rounded-lg border border-[#e5e9ef]">
                <FileText size={20} className="text-muted mt-1" />
                <div className="flex-1">
                  <h3>Participant evidence</h3>
                  <p className="small text-muted mt-1">
                    Sample case summary only. No evidence files, personal
                    information, or content hashes have been loaded.
                  </p>
                  <Button
                    className="mt-3"
                    variant="secondary"
                    onClick={() => setEvidence(true)}
                  >
                    About private evidence
                  </Button>
                </div>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeading
              title="Assigned jurors"
              description="Three distinct jurors · participants excluded"
            />
            <div className="card-body pt-0!">
              {[1, 2, 3].map((i) => (
                <div className="person-row" key={i}>
                  <span className="person-avatar">
                    <UserRound size={15} />
                  </span>
                  <div className="flex-1">
                    <strong>Juror {String(i).padStart(2, "0")}</strong>
                    <p className="small text-muted">
                      Sample assignment · 100 mUSD locked
                    </p>
                  </div>
                  <span className="badge badge-gray">
                    {dispute.state === "Response window"
                      ? "Voting not started"
                      : "Vote not loaded"}
                  </span>
                </div>
              ))}
            </div>
          </Card>
          <div className="info-note">
            <Info size={15} />
            <p>
              Two matching votes determine the outcome. Options are freelancer
              wins, client wins, or split. Without a valid majority, funds split
              50/50. A 1% service fee applies to any freelancer payout.
            </p>
          </div>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeading
              title="Resolution timeline"
              description="Fixed sample dates · all times UTC"
            />
            <ul className="timeline">
              <TimelineItem
                title="Dispute opened"
                detail={deadlineLabel(dispute.openedAt)}
                state="done"
              />
              <TimelineItem
                title="Response deadline"
                detail={`${deadlineLabel(dispute.responseDeadline)} · 12 hours after opening`}
                state={dispute.state === "Response window" ? "current" : "done"}
              />
              <TimelineItem
                title="Voting deadline"
                detail={`${deadlineLabel(dispute.votingDeadline)} · 24 hours after response`}
                state={dispute.state === "Voting open" ? "current" : "upcoming"}
              />
              <TimelineItem
                title="Permissionless finalization"
                detail="Available strictly after the voting deadline, including when jurors abstain."
              />
            </ul>
          </Card>
          <Card>
            <CardHeading title="Case actions" />
            <div className="card-body pt-0! space-y-3">
              <Button className="w-full" disabled>
                Cast vote · not enabled
              </Button>
              <Button className="w-full" variant="secondary" disabled>
                Finalize dispute
              </Button>
              <p className="small text-muted">
                No votes or settlement calls can be submitted in this preview.
                Smart contracts enforce the timing boundaries.
              </p>
            </div>
          </Card>
        </div>
      </div>
      <Dialog
        open={evidence}
        onClose={() => setEvidence(false)}
        title="Private evidence"
      >
        <FileText size={27} className="text-muted" />
        <p className="mt-4">
          Private evidence storage is planned for a later phase. This preview
          does not upload or retrieve files.
        </p>
        <p className="small text-muted mt-3">
          Confidential deliverables and personal information must stay
          off-chain. Future storage must authenticate participants and assigned
          jurors, with content hashes for integrity.
        </p>
        <Button className="mt-5" onClick={() => setEvidence(false)}>
          Understood
        </Button>
      </Dialog>
    </>
  );
}
