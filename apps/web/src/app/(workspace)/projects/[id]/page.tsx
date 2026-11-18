import { notFound } from "next/navigation";
import { projects } from "@/lib/preview-data";
import { ProjectDetail } from "@/components/project-detail";
import { ChainProjectDetail } from "@/components/chain-project-detail";
import { projectIdFromPath } from "@/lib/blockchain/projects";
export const metadata = { title: "Project details" };
export function generateStaticParams() {
  return projects.map((p) => ({ id: p.id }));
}
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const onChainId = projectIdFromPath(id);
  if (onChainId !== null) return <ChainProjectDetail id={onChainId} />;
  const project = projects.find((p) => p.id === id);
  if (!project) notFound();
  return <ProjectDetail project={project} />;
}
