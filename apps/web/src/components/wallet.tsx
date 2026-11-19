"use client";
import { useEffect, useState } from "react";
import {
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  useSwitchChain,
  type Connector,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { Dialog } from "./dialog";
import { Button } from "./ui";
import { usePreview } from "./providers";
import { localChain } from "@/lib/blockchain/config";
import { describeError, shortenAddress } from "@/lib/blockchain/errors";
import { BackendAuthControl } from "./backend-auth";

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
export function WalletControl() {
  const { openWallet } = usePreview();
  const { address, isConnected, isConnecting, isReconnecting } =
    useConnection();
  const restoring = isConnecting || isReconnecting;
  return (
    <Button
      variant="secondary"
      aria-label={
        restoring
          ? "Restoring wallet"
          : isConnected
            ? "Manage wallet"
            : "Connect wallet"
      }
      disabled={restoring}
      onClick={openWallet}
    >
      <Wallet size={16} aria-hidden="true" />
      <span>
        {restoring
          ? "Restoring wallet…"
          : isConnected && address
            ? shortenAddress(address)
            : "Connect wallet"}
      </span>
    </Button>
  );
}
export function WalletNetworkStatus() {
  const { isConnected, chainId, isConnecting, isReconnecting } =
    useConnection();
  return (
    <span
      className={`disconnected ${isConnected && chainId !== localChain.id ? "network-warning" : ""}`}
    >
      <span className="status-dot" />
      {isConnecting || isReconnecting
        ? "Restoring wallet…"
        : isConnected
          ? walletNetwork(chainId)
          : "Not connected"}
    </span>
  );
}
export function SwitchNetworkButton() {
  const mutation = useSwitchChain();
  return (
    <>
      <Button
        variant="secondary"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ chainId: localChain.id })}
      >
        {mutation.isPending ? "Check your wallet…" : "Switch to Hardhat Local"}
      </Button>
      {mutation.error && (
        <p
          role="alert"
          aria-label="Network request error"
          className="small text-red-700 mt-2"
        >
          {describeError(mutation.error).message}
        </p>
      )}
    </>
  );
}
export function WalletDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const connectors = useConnectors();
  const connection = useConnection();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const queryClient = useQueryClient();
  const [available, setAvailable] = useState<Connector[] | null>(null);
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
  }, [connectors]);
  return (
    <Dialog open={open} onClose={onClose} title="Wallet connection">
      {connection.isConnected && connection.address ? (
        <>
          <span className="badge badge-green">Wallet connected</span>
          <p className="small text-muted mt-4">Active account</p>
          <code className="wallet-address">{connection.address}</code>
          <p className="small text-muted mt-3">
            {walletNetwork(connection.chainId)}
          </p>
          <BackendAuthControl />
          {connection.chainId !== localChain.id && (
            <div className="wallet-warning mt-4">
              <p className="small mb-3">
                Unsupported network. Contract reads are paused.
              </p>
              <SwitchNetworkButton />
            </div>
          )}
          <Button
            className="w-full mt-5"
            variant="secondary"
            disabled={disconnect.isPending}
            onClick={async () => {
              try {
                await disconnect.mutateAsync({
                  connector: connection.connector,
                });
                await queryClient.cancelQueries({ queryKey: ["trustlayer"] });
                queryClient.removeQueries({ queryKey: ["trustlayer"] });
                connect.reset();
              } catch {
                /* The mutation's error is rendered below. */
              }
            }}
          >
            Disconnect wallet
          </Button>
          <p className="small text-muted mt-3">
            Disconnecting ends this app’s active connection. Wallet site
            permissions may remain; manage them in your wallet.
          </p>
        </>
      ) : (
        <>
          <p>
            Connect MetaMask or a compatible injected EVM wallet to view your
            local-chain account.
          </p>
          <p className="small text-muted mt-3">
            Connection does not sign a message or send a transaction. Never
            enter a private key or recovery phrase here.
          </p>
          {available === null ? (
            <p className="small text-muted mt-5">Checking installed wallets…</p>
          ) : available.length ? (
            <div className="space-y-3 mt-5">
              {available.map((connector) => (
                <Button
                  className="w-full"
                  key={connector.uid}
                  disabled={connect.isPending}
                  onClick={() => connect.mutate({ connector })}
                >
                  {connect.isPending
                    ? "Check your wallet…"
                    : `Connect ${connector.name}`}
                </Button>
              ))}
            </div>
          ) : (
            <div className="wallet-warning mt-5">
              <h3>No injected wallet detected</h3>
              <p className="small mt-2">
                Install MetaMask or open this app in a browser with a compatible
                EVM wallet, then refresh the page.
              </p>
            </div>
          )}
        </>
      )}
      {(connect.error || disconnect.error) && (
        <p
          role="alert"
          aria-label="Wallet request error"
          className="form-error mt-4"
        >
          {describeError(connect.error ?? disconnect.error).message}
        </p>
      )}
    </Dialog>
  );
}
