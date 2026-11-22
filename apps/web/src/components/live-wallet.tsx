"use client";
import { useConnection } from "wagmi";
import { RefreshCw, Wallet } from "lucide-react";
import { CONTRACT_NAMES } from "@trustlayer/contracts/metadata";
import { localChain } from "@/lib/blockchain/config";
import { LOCAL_RPC_URL } from "@/lib/blockchain/deployment";
import { describeError } from "@/lib/blockchain/errors";
import {
  useProtocolReads,
  useTokenBalance,
  useVerifiedDeployment,
} from "@/lib/blockchain/hooks/use-protocol";
import { Button, Card, CardHeading } from "./ui";
import { Money } from "./money";
import { usePreview } from "./providers";
import { SwitchNetworkButton, walletNetwork } from "./wallet";

function DeploymentFeedback({
  deployment,
}: {
  deployment: ReturnType<typeof useVerifiedDeployment>;
}) {
  if (!deployment.isConnected)
    return (
      <p className="small text-muted">
        Connect a wallet to validate your local deployment. No account data has
        been loaded.
      </p>
    );
  if (!deployment.supported)
    return (
      <div className="wallet-warning">
        <p className="small mb-3">
          Unsupported network: {walletNetwork(deployment.chainId)}. Local
          contract reads are paused.
        </p>
        <SwitchNetworkButton />
      </div>
    );
  if (deployment.isError)
    return (
      <div
        className="wallet-warning"
        role="alert"
        aria-label="Deployment setup"
      >
        <h3>
          {describeError(deployment.error).kind === "deployment"
            ? "Local setup required"
            : "Local blockchain unavailable"}
        </h3>
        <p className="small mt-2">{describeError(deployment.error).message}</p>
        <Button
          className="mt-3"
          variant="secondary"
          onClick={() => void deployment.refetch()}
        >
          <RefreshCw size={13} />
          Retry verification
        </Button>
      </div>
    );
  if (!deployment.ready)
    return (
      <p className="small text-muted" role="status">
        Checking local deployment and wallet network…
      </p>
    );
  return null;
}
export function LiveWalletCard() {
  const connection = useConnection();
  const { openWallet } = usePreview();
  const balance = useTokenBalance();
  const { deployment, token } = balance;
  return (
    <Card className="live-wallet">
      <CardHeading
        title="Live wallet"
        description="Connected account data · separate from sample projects"
        action={<Wallet size={18} className="text-muted" />}
      />
      <div className="card-body pt-0!">
        <dl className="summary-list">
          <div>
            <dt>Wallet</dt>
            <dd>{connection.isConnected ? "Connected" : "Not connected"}</dd>
          </div>
          {connection.address && (
            <div>
              <dt>Account address</dt>
              <dd>
                <code className="wallet-address">{connection.address}</code>
              </dd>
            </div>
          )}
          <div>
            <dt>Active network</dt>
            <dd>
              {connection.isConnected
                ? walletNetwork(connection.chainId)
                : "Not connected"}
            </dd>
          </div>
          <div>
            <dt>Local RPC</dt>
            <dd>{LOCAL_RPC_URL}</dd>
          </div>
          <div>
            <dt>Deployment</dt>
            <dd>
              {deployment.ready ? "Verified on RPC & wallet" : "Not verified"}
            </dd>
          </div>
          <div>
            <dt>mUSD balance</dt>
            <dd data-testid="live-balance">
              {token ? <Money amount={token.balance} /> : "—"}
            </dd>
          </div>
          {token && (
            <div>
              <dt>Token metadata</dt>
              <dd>
                {token.symbol} · {token.decimals} decimals · on-chain
              </dd>
            </div>
          )}
        </dl>
        <div className="mt-4">
          <DeploymentFeedback deployment={deployment} />
          {deployment.ready && balance.isError && (
            <p
              role="alert"
              aria-label="Token read error"
              className="form-error"
            >
              Token read failed. {describeError(balance.error).message}
            </p>
          )}
          {deployment.ready && balance.isFetching && (
            <p className="small text-muted" role="status">
              Loading token balance…
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-3 mt-5">
          <Button variant="secondary" onClick={openWallet}>
            {connection.isConnected ? "Manage wallet" : "Connect wallet"}
          </Button>
          {token && (
            <Button variant="ghost" onClick={() => void balance.refetch()}>
              <RefreshCw size={13} />
              Refresh balance
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
export function ProtocolConnectionCard() {
  const reads = useProtocolReads();
  const { deployment, protocol } = reads;
  return (
    <Card>
      <CardHeading
        title="Verified protocol"
        description={`${localChain.name} · 31337 · live public contract reads`}
      />
      <div className="card-body pt-0!">
        <DeploymentFeedback deployment={deployment} />
        {deployment.verified && (
          <dl className="summary-list contract-addresses">
            {CONTRACT_NAMES.map((name) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>
                  <code className="wallet-address">
                    {deployment.verified!.contracts[name].address}
                  </code>
                </dd>
              </div>
            ))}
          </dl>
        )}
        {deployment.ready && reads.isFetching && (
          <p className="small text-muted mt-4">
            Loading public protocol state…
          </p>
        )}
        {deployment.ready && reads.isError && (
          <p
            className="form-error mt-4"
            role="alert"
            aria-label="Protocol read error"
          >
            Public contract reads failed. {describeError(reads.error).message}
          </p>
        )}
        {protocol && (
          <>
            <dl className="summary-list mt-4">
              <div>
                <dt>Escrow liability</dt>
                <dd>
                  <Money amount={protocol.escrowLiability} />
                </dd>
              </div>
              <div>
                <dt>Juror stake / locked</dt>
                <dd>
                  <Money amount={protocol.totalStaked} /> /{" "}
                  <Money amount={protocol.totalLockedStake} />
                </dd>
              </div>
              <div>
                <dt>Reserved juror rewards</dt>
                <dd>
                  <Money amount={protocol.reservedRewards} />
                </dd>
              </div>
              <div>
                <dt>Treasury revenue</dt>
                <dd>
                  <Money amount={protocol.treasuryRevenue} />
                </dd>
              </div>
              <div>
                <dt>Arbitration configured</dt>
                <dd>{protocol.arbitrationConfigured ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>Current treasury owner</dt>
                <dd>
                  <code className="wallet-address">
                    {protocol.treasuryOwner}
                  </code>
                </dd>
              </div>
            </dl>
            <Button
              className="mt-4"
              variant="secondary"
              onClick={() => void reads.refetch()}
            >
              Refresh protocol reads
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
