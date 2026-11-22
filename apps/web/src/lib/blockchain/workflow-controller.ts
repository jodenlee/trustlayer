import { getConnection, getWalletClient } from "wagmi/actions";
import type { QueryClient } from "@tanstack/react-query";
import {
  createPublicClient,
  custom,
  type Address,
  type EIP1193Provider,
} from "viem";
import { localChain, localClient, type makeWalletConfig } from "./config";
import {
  loadManifest,
  verifyManifest,
  verifyWalletManifest,
} from "./deployment";
import { IntegrationError } from "./errors";
import {
  createTransactionController,
  requestWalletSignature,
  type TransactionLifecycle,
} from "./transactions";
import {
  assertReviewScope,
  type AttemptDetails,
  type createSessionStore,
} from "./session";

/** Imperative request state lives outside React render, separately for each controller. */
export function makeProtocolController(
  config: ReturnType<typeof makeWalletConfig>,
  queryClient: QueryClient,
  session: ReturnType<typeof createSessionStore>,
  publish: (state: TransactionLifecycle) => void,
  address?: Address,
  chainId?: number,
  connectorUid?: string,
) {
  let attemptId: number | undefined;
  let details: AttemptDetails = { kind: "Transaction" };
  let validatedManifest: Awaited<ReturnType<typeof loadManifest>> | undefined;
  const isCurrent = () => {
    const now = getConnection(config);
    return (
      now.isConnected &&
      now.address === address &&
      now.chainId === chainId &&
      now.connector?.uid === connectorUid
    );
  };
  async function validate(trackTransaction = true) {
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
    assertReviewScope(details.expectedScope, manifest);
    validatedManifest = manifest;
    const contracts = await verifyManifest(localClient, manifest);
    const current = getConnection(config);
    if (!current.connector || !isCurrent())
      throw new IntegrationError(
        "disconnected",
        "Wallet connection changed during validation.",
      );
    const provider = (await current.connector.getProvider()) as EIP1193Provider;
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
    if (trackTransaction) attemptId = session.begin(manifest, address, details);
    const assertCurrent = async () => {
      if (
        !isCurrent() ||
        (await wallet.getChainId()) !== localChain.id ||
        (await wallet.getAddresses())[0]?.toLowerCase() !==
          address.toLowerCase()
      )
        throw new IntegrationError(
          "disconnected",
          "The wallet account or network changed. Review the action again.",
        );
    };
    return { wallet, contracts, manifest, account: address, assertCurrent };
  }
  const transaction = createTransactionController({
    validate,
    isCurrent,
    publish,
    observe: (next) => {
      if (attemptId === undefined) return;
      const id = attemptId;
      session.update(id, next);
      if (next.phase === "confirmed" && next.blockNumber !== undefined)
        void localClient
          .getBlock({ blockNumber: next.blockNumber })
          .then((block) => session.timestamp(id, block.timestamp))
          .catch(() => {});
    },
    wait: async (hash, onReplaced) => {
      const receipt = await localClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: 60_000,
        pollingInterval: 1000,
        onReplaced: (replacement) =>
          onReplaced({
            reason: replacement.reason,
            hash: replacement.transactionReceipt.transactionHash,
          }),
      });
      if (validatedManifest)
        await verifyManifest(localClient, validatedManifest);
      return receipt;
    },
    refresh: () =>
      queryClient.invalidateQueries(
        { queryKey: ["trustlayer"] },
        { throwOnError: true },
      ),
  });
  return {
    execute: async (
      submit: Parameters<typeof transaction.execute>[0],
      info: AttemptDetails = { kind: "Transaction" },
    ) => {
      if (transaction.busy)
        throw new IntegrationError(
          "unknown",
          "A transaction request is already pending.",
        );
      details = info;
      attemptId = undefined;
      return transaction.execute(submit);
    },
    reset: transaction.reset,
    isBusy: () => transaction.busy,
    signMessage: (message: string) =>
      requestWalletSignature(
        () => validate(false),
        (context) => context.wallet.signMessage({ message }),
        isCurrent,
      ),
  };
}
