"use client";
import { useCallback, useEffect, useState } from "react";
import {
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  useSwitchChain,
  type Connector,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Dialog } from "./dialog";
import { Button, Hash, KeyValue, Notice } from "./ui";
import { localChain } from "@/lib/blockchain/config";
import { describeError } from "@/lib/blockchain/errors";
import { useBackendAuth } from "./auth-provider";

export function walletNetwork(chainId?: number) {
  return chainId === localChain.id
    ? localChain.name
    : chainId === 1
      ? "Ethereum (1)"
      : chainId === 11155111
        ? "Sepolia (11155111)"
        : chainId
          ? `Unsupported network (${chainId})`
          : "Not connected";
}
/** Injected wallets that actually expose a provider in this browser. */
export function useInjectedConnectors() {
  const connectors = useConnectors();
  const [available, setAvailable] = useState<Connector[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      connectors.map(async (connector) => ({
        connector,
        provider: await connector.getProvider().catch(() => undefined),
      })),
    ).then((results) => {
      if (!cancelled)
        setAvailable(
          results
            .filter((result) => result.provider)
            .map((result) => result.connector),
        );
    });
    return () => {
      cancelled = true;
    };
  }, [connectors, attempt]);
  const recheck = useCallback(() => {
    setAvailable(null);
    setAttempt((n) => n + 1);
  }, []);
  return { available, recheck };
}
/** Disconnect the app's wallet connection and drop cached chain reads. */
export function useWalletDisconnect() {
  const connection = useConnection();
  const disconnect = useDisconnect();
  const connect = useConnect();
  const queryClient = useQueryClient();
  return {
    pending: disconnect.isPending,
    error: disconnect.error,
    async run() {
      await disconnect.mutateAsync({ connector: connection.connector });
      await queryClient.cancelQueries({ queryKey: ["trustlayer"] });
      queryClient.removeQueries({ queryKey: ["trustlayer"] });
      connect.reset();
    },
  };
}
export function SwitchNetworkButton({ block = false }: { block?: boolean }) {
  const mutation = useSwitchChain();
  return (
    <>
      <Button
        variant="primary"
        className={block ? "btn-block" : ""}
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ chainId: localChain.id })}
      >
        {mutation.isPending
          ? "Check your wallet…"
          : `Switch to ${localChain.name}`}
      </Button>
      {mutation.error && (
        <p
          role="alert"
          aria-label="Network request error"
          className="form-error"
        >
          {describeError(mutation.error).message}
        </p>
      )}
    </>
  );
}
/** In-app wallet & account dialog. Sign-in itself happens on /sign-in. */
export function WalletDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const connection = useConnection();
  const auth = useBackendAuth();
  const router = useRouter();
  const wallet = useWalletDisconnect();
  const [error, setError] = useState("");
  return (
    <Dialog open={open} onClose={onClose} title="Wallet connection">
      {connection.isConnected && connection.address ? (
        <div className="stack-sm">
          <KeyValue
            items={[
              {
                label: "Account",
                value: <Hash value={connection.address} label="Copy address" />,
              },
              { label: "Network", value: walletNetwork(connection.chainId) },
              {
                label: "Session",
                value: auth.session ? "Signed in" : "Not signed in",
              },
            ]}
          />
          {connection.chainId !== localChain.id && (
            <Notice tone="warning" title="Wrong network">
              <p>TrustLayer reads and transactions are paused.</p>
              <div className="mt-2">
                <SwitchNetworkButton />
              </div>
            </Notice>
          )}
          <div className="button-row mt-2">
            {auth.session && (
              <Button
                variant="secondary"
                disabled={auth.busy}
                onClick={async () => {
                  await auth.logout();
                  onClose();
                  router.replace("/sign-in");
                }}
              >
                Sign out
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={wallet.pending}
              onClick={async () => {
                setError("");
                try {
                  await wallet.run();
                  onClose();
                } catch (e) {
                  setError(describeError(e).message);
                }
              }}
            >
              Disconnect wallet
            </Button>
          </div>
          <p className="small text-muted">
            Disconnecting ends this app’s connection; you will need to sign in
            again. Site permissions may remain in your wallet.
          </p>
        </div>
      ) : (
        <p className="text-muted">
          No wallet is connected. Return to the sign-in page to connect.
        </p>
      )}
      {(error || auth.error) && (
        <p
          role="alert"
          aria-label="Wallet request error"
          className="form-error mt-4"
        >
          {error || auth.error}
        </p>
      )}
    </Dialog>
  );
}
