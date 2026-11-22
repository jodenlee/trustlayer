import { notFound } from "next/navigation";
import { ChainProjectDetail } from "@/components/chain-project-detail";
import { projectIdFromPath } from "@/lib/blockchain/projects";
export const metadata = { title: "Project" };
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = projectIdFromPath((await params).id);
  if (id === null) notFound();
  return <ChainProjectDetail id={id} />;
}
