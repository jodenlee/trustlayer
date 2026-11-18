import { notFound } from "next/navigation";
import { disputes, projects } from "@/lib/preview-data";
import { DisputeDetail } from "@/components/dispute-detail";
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
  const dispute = disputes.find((d) => d.id === id);
  if (!dispute) notFound();
  const project = projects.find((p) => p.id === dispute.projectId)!;
  return <DisputeDetail dispute={dispute} project={project} />;
}
