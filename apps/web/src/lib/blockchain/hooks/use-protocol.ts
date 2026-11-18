"use client";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import { createPublicClient, custom, type EIP1193Provider } from "viem";
import { TOKEN_DECIMALS } from "@trustlayer/contracts/metadata";
import { localChain, localClient } from "../config";
import {
  loadManifest,
  verifyManifest,
  verifyWalletManifest,
} from "../deployment";
import { IntegrationError } from "../errors";

export function useVerifiedDeployment() {
  const { address, chainId, connector, isConnected } = useConnection();
  const supported = chainId === localChain.id;
  const query = useQuery({
    queryKey: ["trustlayer", "deployment", address, chainId, connector?.uid],
    enabled: isConnected && supported && !!connector,
    staleTime: 30_000,
    refetchOnMount: false,
    gcTime: 0,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const manifest = await loadManifest(signal);
      const contracts = await verifyManifest(localClient, manifest);
      const provider = (await connector!.getProvider()) as EIP1193Provider;
      const walletClient = createPublicClient({
        chain: localChain,
        transport: custom(provider, { retryCount: 0 }),
      });
      // Same chain ID alone is insufficient: the wallet must see the same anchored deployment.
      await verifyWalletManifest(walletClient, manifest);
      return { manifest, contracts };
    },
  });
  // Never expose previous data during invalidation, revalidation, account or chain changes.
  const ready =
    isConnected && supported && query.isSuccess && !query.isFetching;
  return {
    ...query,
    ready,
    verified: ready ? query.data : undefined,
    supported,
    address,
    chainId,
    isConnected,
  };
}

export function useTokenBalance() {
  const deployment = useVerifiedDeployment();
  const { verified, address } = deployment;
  const query = useQuery({
    queryKey: [
      "trustlayer",
      "token",
      address,
      deployment.chainId,
      verified?.manifest.verifiedBlock.hash,
    ],
    enabled: !!verified && !!address,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!verified || !address)
        throw new IntegrationError("disconnected", "Connect a wallet first.");
      const token = verified.contracts.MockUSD;
      const [balance, decimals, symbol] = await Promise.all([
        localClient.readContract({
          ...token,
          functionName: "balanceOf",
          args: [address],
        }),
        localClient.readContract({ ...token, functionName: "decimals" }),
        localClient.readContract({ ...token, functionName: "symbol" }),
      ]);
      if (decimals !== TOKEN_DECIMALS || symbol !== "mUSD")
        throw new IntegrationError(
          "deployment",
          "On-chain token metadata does not match six-decimal MockUSD. Re-export and verify your deployment.",
        );
      return { balance, decimals, symbol };
    },
  });
  return {
    ...query,
    deployment,
    token:
      deployment.ready && query.isSuccess && !query.isFetching
        ? query.data
        : undefined,
  };
}

export function useProtocolReads() {
  const deployment = useVerifiedDeployment();
  const { verified } = deployment;
  const query = useQuery({
    queryKey: [
      "trustlayer",
      "protocol",
      deployment.address,
      deployment.chainId,
      verified?.manifest.verifiedBlock.hash,
    ],
    enabled: !!verified,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!verified)
        throw new IntegrationError("deployment", "Verify deployment first.");
      const c = verified.contracts;
      const [
        escrowLiability,
        totalStaked,
        totalLockedStake,
        reservedRewards,
        treasuryRevenue,
        treasuryOwner,
        arbitrationConfigured,
      ] = await Promise.all([
        localClient.readContract({
          ...c.TrustEscrow,
          functionName: "totalEscrowLiability",
        }),
        localClient.readContract({
          ...c.JurorRegistry,
          functionName: "totalStaked",
        }),
        localClient.readContract({
          ...c.JurorRegistry,
          functionName: "totalLockedStake",
        }),
        localClient.readContract({
          ...c.DisputeArbitration,
          functionName: "reservedJurorRewards",
        }),
        localClient.readContract({
          ...c.ProtocolTreasury,
          functionName: "availableRevenue",
        }),
        localClient.readContract({
          ...c.ProtocolTreasury,
          functionName: "owner",
        }),
        localClient.readContract({
          ...c.DisputeArbitration,
          functionName: "isConfigured",
        }),
      ]);
      return {
        escrowLiability,
        totalStaked,
        totalLockedStake,
        reservedRewards,
        treasuryRevenue,
        treasuryOwner,
        arbitrationConfigured,
      };
    },
  });
  return {
    ...query,
    deployment,
    protocol:
      deployment.ready && query.isSuccess && !query.isFetching
        ? query.data
        : undefined,
  };
}
