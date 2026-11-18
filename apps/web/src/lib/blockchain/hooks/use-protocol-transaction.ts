"use client";
import { useEffect, useMemo, useState } from "react";
import { useConfig, useConnection } from "wagmi";
import { getConnection, getWalletClient } from "wagmi/actions";
import { useQueryClient } from "@tanstack/react-query";
import { createPublicClient, custom, type EIP1193Provider } from "viem";
import { localChain, localClient } from "../config";
import {
  loadManifest,
  verifyManifest,
  verifyWalletManifest,
} from "../deployment";
import { IntegrationError } from "../errors";
import {
  createTransactionController,
  requestWalletSignature,
  type TransactionLifecycle,
} from "../transactions";

/** Unbound to application flows. Future callers supply a typed, reviewed wallet action. */
export function useProtocolTransaction() {
  const config = useConfig();
  const connection = useConnection();
  const queryClient = useQueryClient();
  const [state, setState] = useState<TransactionLifecycle>({ phase: "idle" });
  const address = connection.address;
  const chainId = connection.chainId;
  const connectorUid = connection.connector?.uid;
  const controller = useMemo(() => {
    const isCurrent = () => {
      const now = getConnection(config);
      return (
        now.isConnected &&
        now.address === address &&
        now.chainId === chainId &&
        now.connector?.uid === connectorUid
      );
    };
    async function validate() {
      if (!address || !isCurrent())
        throw new IntegrationError(
          "disconnected",
          "The account changed or disconnected. Reconnect before signing.",
        );
      if (chainId !== localChain.id)
        throw new IntegrationError(
          "network",
          "Switch to Hardhat Local (31337) before signing.",
        );
      const manifest = await loadManifest();
      const contracts = await verifyManifest(localClient, manifest);
      const current = getConnection(config);
      if (!current.connector || !isCurrent())
        throw new IntegrationError(
          "disconnected",
          "Wallet connection changed during validation.",
        );
      const provider =
        (await current.connector.getProvider()) as EIP1193Provider;
      const wallet = await getWalletClient(config, { chainId: localChain.id });
      await verifyWalletManifest(
        createPublicClient({
          chain: localChain,
          transport: custom(provider, { retryCount: 0 }),
        }),
        manifest,
      );
      if (
        !isCurrent() ||
        wallet.account.address !== address ||
        (await wallet.getChainId()) !== localChain.id
      )
        throw new IntegrationError(
          "network",
          "Wallet account or chain changed before signing.",
        );
      return { wallet, contracts, manifest, account: address };
    }
    const transaction = createTransactionController({
      validate,
      isCurrent,
      publish: setState,
      wait: (hash, onReplaced) =>
        localClient.waitForTransactionReceipt({
          hash,
          confirmations: 1,
          timeout: 60_000,
          pollingInterval: 1000,
          onReplaced: (replacement) =>
            onReplaced({
              reason: replacement.reason,
              hash: replacement.transactionReceipt.transactionHash,
            }),
        }),
      refresh: () =>
        queryClient.invalidateQueries(
          { queryKey: ["trustlayer"] },
          { throwOnError: true },
        ),
    });
    return {
      execute: transaction.execute,
      reset: transaction.reset,
      isBusy: () => transaction.busy,
      signMessage: (message: string) =>
        requestWalletSignature(
          validate,
          (context) => context.wallet.signMessage({ message }),
          isCurrent,
        ),
    };
  }, [address, chainId, connectorUid, config, queryClient]);
  useEffect(() => () => controller.reset(), [controller]);
  return { ...controller, state };
}
