"use client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useVerifiedDeployment } from "./use-protocol";
import { localClient } from "../config";
import { readProject, readProjectPage, type ProjectCursor } from "../projects";
import { findDeploymentBlock, readHistoryPage } from "../history";
import { deploymentScope } from "../session";

export function useWalletProjects() {
  const deployment = useVerifiedDeployment();
  const config = deployment.data;
  const query = useInfiniteQuery({
    queryKey: [
      "trustlayer",
      "projects",
      deployment.address,
      deployment.chainId,
      config && deploymentScope(config.manifest),
    ],
    initialPageParam: null as ProjectCursor | null,
    enabled: deployment.ready && !!config && !!deployment.address,
    queryFn: ({ pageParam }) =>
      readProjectPage(
        localClient,
        config!.contracts,
        deployment.address!,
        pageParam,
      ),
    getNextPageParam: (page) => page.next,
    staleTime: 10_000,
    gcTime: 0,
  });
  return {
    ...query,
    deployment,
    projects:
      deployment.ready && !query.isError
        ? (query.data?.pages.flatMap((p) => p.projects) ?? [])
        : [],
    scanned: query.data?.pages.reduce((n, p) => n + p.scanned, 0n) ?? 0n,
  };
}
export function useChainProject(id: bigint) {
  const deployment = useVerifiedDeployment();
  const config = deployment.data;
  const query = useQuery({
    queryKey: [
      "trustlayer",
      "project",
      deployment.address,
      deployment.chainId,
      config && deploymentScope(config.manifest),
      id.toString(),
    ],
    enabled: deployment.ready && !!config,
    queryFn: async () => {
      const block = await localClient.getBlock({ blockTag: "latest" });
      const [project, balance, allowance, treasuryRevenue] = await Promise.all([
        readProject(localClient, config!.contracts, id, block.number),
        localClient.readContract({
          ...config!.contracts.MockUSD,
          functionName: "balanceOf",
          args: [deployment.address!],
          blockNumber: block.number,
        }),
        localClient.readContract({
          ...config!.contracts.MockUSD,
          functionName: "allowance",
          args: [deployment.address!, config!.contracts.TrustEscrow.address],
          blockNumber: block.number,
        }),
        localClient.readContract({
          ...config!.contracts.ProtocolTreasury,
          functionName: "totalServiceFeesReceived",
          blockNumber: block.number,
        }),
      ]);
      return {
        project,
        balance,
        allowance,
        treasuryRevenue,
        now: block.timestamp,
      };
    },
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 10_000,
  });
  return {
    ...query,
    deployment,
    view: deployment.ready && !query.isError ? query.data : undefined,
  };
}
export function useProjectHistory(projectIds: readonly bigint[]) {
  const deployment = useVerifiedDeployment();
  const config = deployment.data;
  const start = useQuery({
    queryKey: [
      "trustlayer",
      "deployment-start",
      config && deploymentScope(config.manifest),
    ],
    enabled: deployment.ready && !!config,
    queryFn: () =>
      findDeploymentBlock(
        localClient,
        config!.contracts.TrustEscrow.address,
        BigInt(config!.manifest.verifiedBlock.number),
      ),
    staleTime: Infinity,
  });
  const query = useInfiniteQuery({
    queryKey: [
      "trustlayer",
      "history",
      deployment.address,
      deployment.chainId,
      config && deploymentScope(config.manifest),
      projectIds.map(String).sort().join(","),
    ],
    initialPageParam: undefined as bigint | undefined,
    enabled: deployment.ready && start.isSuccess && !!config,
    queryFn: ({ pageParam }) =>
      readHistoryPage(
        localClient,
        config!.contracts,
        deployment.address!,
        projectIds,
        start.data!,
        pageParam,
      ),
    getNextPageParam: (page) => page.next,
    staleTime: 10_000,
    gcTime: 0,
  });
  return {
    ...query,
    deployment,
    error: query.error ?? start.error,
    entries:
      deployment.ready && !query.isError
        ? (query.data?.pages.flatMap((p) => p.entries) ?? [])
        : [],
  };
}
