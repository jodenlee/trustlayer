"use client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useVerifiedDeployment } from "./use-protocol";
import { localClient } from "../config";
import { deploymentScope } from "../session";
import { readCase, readCasePage } from "../arbitration";
import type { ChainProject, ProjectCursor } from "../projects";

export function useWalletCases() {
  const deployment = useVerifiedDeployment();
  const config = deployment.data;
  const query = useInfiniteQuery({
    queryKey: [
      "trustlayer",
      "cases",
      deployment.address,
      deployment.chainId,
      config && deploymentScope(config.manifest),
    ],
    enabled: deployment.ready && !!config && !!deployment.address,
    initialPageParam: null as ProjectCursor | null,
    queryFn: ({ pageParam }) =>
      readCasePage(
        localClient,
        config!.contracts,
        deployment.address!,
        pageParam,
      ),
    getNextPageParam: (page) => page.next,
    staleTime: 10_000,
    gcTime: 0,
    refetchInterval: 15_000,
  });
  return {
    ...query,
    deployment,
    cases:
      deployment.readable && !query.isError
        ? (query.data?.pages.flatMap((p) => p.cases) ?? [])
        : [],
    now: query.data?.pages[0]?.now ?? 0n,
    scanned: query.data?.pages.reduce((n, p) => n + p.scanned, 0n) ?? 0n,
  };
}
export function useCaseDetail(id: bigint) {
  const deployment = useVerifiedDeployment();
  const config = deployment.data;
  const query = useQuery({
    queryKey: [
      "trustlayer",
      "case",
      deployment.address,
      deployment.chainId,
      config && deploymentScope(config.manifest),
      id.toString(),
    ],
    enabled: deployment.ready && !!config && !!deployment.address,
    queryFn: async () => {
      const block = await localClient.getBlock({ blockTag: "latest" });
      const [record, treasuryServiceFees, treasuryDisputeFees, feeReceived] =
        await Promise.all([
          readCase(
            localClient,
            config!.contracts,
            id,
            deployment.address!,
            block.number,
          ),
          localClient.readContract({
            ...config!.contracts.ProtocolTreasury,
            functionName: "totalServiceFeesReceived",
            blockNumber: block.number,
          }),
          localClient.readContract({
            ...config!.contracts.ProtocolTreasury,
            functionName: "totalDisputeFeesReceived",
            blockNumber: block.number,
          }),
          localClient.readContract({
            ...config!.contracts.ProtocolTreasury,
            functionName: "disputeFeeReceived",
            args: [id],
            blockNumber: block.number,
          }),
        ]);
      return {
        ...record,
        now: block.timestamp,
        treasuryServiceFees,
        treasuryDisputeFees,
        feeReceived,
      };
    },
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 5000,
  });
  return {
    ...query,
    deployment,
    isFetching: query.isFetching || deployment.isFetching,
    view: deployment.readable && !query.isError ? query.data : undefined,
  };
}
export function useOpening(project: ChainProject, index: number) {
  const deployment = useVerifiedDeployment();
  const config = deployment.data;
  const query = useQuery({
    queryKey: [
      "trustlayer",
      "opening",
      deployment.address,
      deployment.chainId,
      config && deploymentScope(config.manifest),
      String(project.id),
      index,
    ],
    enabled: deployment.ready && !!config && !!deployment.address,
    queryFn: async () => {
      const block = await localClient.getBlock({ blockTag: "latest" });
      const [existing, balance, allowance] = await Promise.all([
        localClient.readContract({
          ...config!.contracts.DisputeArbitration,
          functionName: "getMilestoneDispute",
          args: [project.id, BigInt(index)],
          blockNumber: block.number,
        }),
        localClient.readContract({
          ...config!.contracts.MockUSD,
          functionName: "balanceOf",
          args: [deployment.address!],
          blockNumber: block.number,
        }),
        localClient.readContract({
          ...config!.contracts.MockUSD,
          functionName: "allowance",
          args: [
            deployment.address!,
            config!.contracts.DisputeArbitration.address,
          ],
          blockNumber: block.number,
        }),
      ]);
      return { existing, balance, allowance, now: block.timestamp };
    },
    gcTime: 0,
    refetchInterval: 10_000,
  });
  return {
    ...query,
    deployment,
    isFetching: query.isFetching || deployment.isFetching,
    view: deployment.readable && !query.isError ? query.data : undefined,
  };
}
export function useJuror() {
  const deployment = useVerifiedDeployment();
  const config = deployment.data;
  const query = useQuery({
    queryKey: [
      "trustlayer",
      "juror",
      deployment.address,
      deployment.chainId,
      config && deploymentScope(config.manifest),
    ],
    enabled: deployment.ready && !!config && !!deployment.address,
    queryFn: async () => {
      const block = await localClient.getBlock({ blockTag: "latest" });
      const [info, eligible, balance, allowance, minimum] = await Promise.all([
        localClient.readContract({
          ...config!.contracts.JurorRegistry,
          functionName: "getJurorInfo",
          args: [deployment.address!],
          blockNumber: block.number,
        }),
        localClient.readContract({
          ...config!.contracts.JurorRegistry,
          functionName: "isEligible",
          args: [deployment.address!],
          blockNumber: block.number,
        }),
        localClient.readContract({
          ...config!.contracts.MockUSD,
          functionName: "balanceOf",
          args: [deployment.address!],
          blockNumber: block.number,
        }),
        localClient.readContract({
          ...config!.contracts.MockUSD,
          functionName: "allowance",
          args: [deployment.address!, config!.contracts.JurorRegistry.address],
          blockNumber: block.number,
        }),
        localClient.readContract({
          ...config!.contracts.JurorRegistry,
          functionName: "MIN_STAKE",
          blockNumber: block.number,
        }),
      ]);
      return { info, eligible, balance, allowance, minimum };
    },
    gcTime: 0,
    refetchInterval: 10_000,
  });
  return {
    ...query,
    deployment,
    isFetching: query.isFetching || deployment.isFetching,
    view: deployment.readable && !query.isError ? query.data : undefined,
  };
}
