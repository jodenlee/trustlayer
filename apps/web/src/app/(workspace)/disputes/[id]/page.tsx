import { notFound } from "next/navigation";
import { ChainDisputeDetail } from "@/components/chain-dispute-detail";
import { projectIdFromPath } from "@/lib/blockchain/projects";
export const metadata = { title: "Dispute" };
export default async function DisputePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Dispute IDs share the same zero-based uint256 path format as projects.
  const id = projectIdFromPath((await params).id);
  if (id === null) notFound();
  return <ChainDisputeDetail id={id} />;
}
