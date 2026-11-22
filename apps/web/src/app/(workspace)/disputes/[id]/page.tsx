import { notFound } from "next/navigation";
import { disputes, projects } from "@/lib/preview-data";
import { DisputeDetail } from "@/components/dispute-detail";
import { ChainDisputeDetail } from "@/components/chain-dispute-detail";
import { projectIdFromPath } from "@/lib/blockchain/projects";
export const metadata = { title: "Dispute details" };
export function generateStaticParams() {
  return disputes.map((d) => ({ id: d.id }));
}
export default async function DisputePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const onChainId = projectIdFromPath(id);
  if (onChainId !== null) return <ChainDisputeDetail id={onChainId} />;
  const dispute = disputes.find((d) => d.id === id);
  if (!dispute) notFound();
  const project = projects.find((p) => p.id === dispute.projectId)!;
  return <DisputeDetail dispute={dispute} project={project} />;
}
