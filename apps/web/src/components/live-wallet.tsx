"use client";
import { useConnection } from "wagmi";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { CONTRACT_NAMES } from "@trustlayer/contracts/metadata";
import { localChain } from "@/lib/blockchain/config";
import { LOCAL_RPC_URL } from "@/lib/blockchain/deployment";
import { describeError } from "@/lib/blockchain/errors";
import {
  useProtocolReads,
  useTokenBalance,
} from "@/lib/blockchain/hooks/use-protocol";
import {
  Button,
  Card,
  CardBody,
  CardHeading,
  Disclosure,
  Hash,
  KeyValue,
} from "./ui";
import { Money } from "./money";
import { useUi } from "./providers";
import { useBackendAuth } from "./auth-provider";
import { walletNetwork } from "./wallet";

/** Signed-in wallet, network verification, balance and session controls. */
export function WalletSummary() {
  const connection = useConnection();
  const { openWallet } = useUi();
  const auth = useBackendAuth();
  const router = useRouter();
  const balance = useTokenBalance();
  const { deployment, token } = balance;
  return (
    <Card label="Wallet and session">
      <CardHeading title="Wallet & session" />
      <CardBody className="pt-2!">
        <KeyValue
          items={[
            {
              label: "Account",
              value: connection.address ? (
                <Hash value={connection.address} label="Copy address" />
              ) : (
                "Not connected"
              ),
            },
            {
              label: "Network",
              value: connection.isConnected
                ? walletNetwork(connection.chainId)
                : "Not connected",
            },
            {
              label: "Deployment",
              value: deployment.ready
                ? "Verified on RPC & wallet"
                : "Not verified",
            },
            {
              label: "mUSD balance",
              value: token ? <Money amount={token.balance} /> : "—",
              testId: "live-balance",
            },
            {
              label: "Session expires",
              value: auth.session
                ? new Date(auth.session.expiresAt).toLocaleString()
                : "—",
            },
          ]}
        />
        {deployment.ready && balance.isError && (
          <p
            role="alert"
            aria-label="Token read error"
            className="form-error mt-3"
          >
            Token read failed. {describeError(balance.error).message}
          </p>
        )}
        <div className="button-row mt-4">
          <Button variant="secondary" onClick={openWallet}>
            Manage wallet
          </Button>
          {token && (
            <Button variant="ghost" onClick={() => void balance.refetch()}>
              <RefreshCw size={13} aria-hidden="true" />
              Refresh balance
            </Button>
          )}
          <Button
            variant="ghost"
            className="ml-auto"
            disabled={auth.busy}
            onClick={async () => {
              await auth.logout();
              router.replace("/sign-in");
            }}
          >
            Sign out
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
/** Public protocol state and verified contract addresses, for troubleshooting. */
export function ProtocolDetails() {
  const reads = useProtocolReads();
  const { deployment, protocol } = reads;
  const token = useTokenBalance().token;
  return (
    <Disclosure
      summary="Protocol & contract details"
      hint={`${localChain.name} · ${localChain.id}`}
    >
      <div className="stack-sm">
        <KeyValue
          stacked
          items={[
            { label: "RPC endpoint", value: LOCAL_RPC_URL },
            ...(token
              ? [
                  {
                    label: "Token metadata",
                    value: `${token.symbol} · ${token.decimals} decimals · on-chain`,
                  },
                ]
              : []),
            ...(deployment.verified
              ? CONTRACT_NAMES.map((name) => ({
                  label: name,
                  value: (
                    <Hash
                      value={deployment.verified!.contracts[name].address}
                      full
                    />
                  ),
                }))
              : []),
          ]}
        />
        {deployment.ready && reads.isFetching && (
          <p className="small text-muted">Loading public protocol state…</p>
        )}
        {deployment.ready && reads.isError && (
          <p
            className="form-error"
            role="alert"
            aria-label="Protocol read error"
          >
            Public contract reads failed. {describeError(reads.error).message}
          </p>
        )}
        {protocol && (
          <>
            <KeyValue
              items={[
                {
                  label: "Escrow liability",
                  value: <Money amount={protocol.escrowLiability} />,
                },
                {
                  label: "Juror stake / locked",
                  value: (
                    <>
                      <Money amount={protocol.totalStaked} /> /{" "}
                      <Money amount={protocol.totalLockedStake} />
                    </>
                  ),
                },
                {
                  label: "Reserved juror rewards",
                  value: <Money amount={protocol.reservedRewards} />,
                },
                {
                  label: "Treasury revenue",
                  value: <Money amount={protocol.treasuryRevenue} />,
                },
                {
                  label: "Arbitration configured",
                  value: protocol.arbitrationConfigured ? "Yes" : "No",
                },
                {
                  label: "Current treasury owner",
                  value: <Hash value={protocol.treasuryOwner} />,
                },
              ]}
            />
            <div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void reads.refetch()}
              >
                Refresh protocol reads
              </Button>
            </div>
          </>
        )}
      </div>
    </Disclosure>
  );
}
