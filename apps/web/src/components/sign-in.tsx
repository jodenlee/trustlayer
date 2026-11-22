"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useConnect, useConnection } from "wagmi";
import { Check, FileLock2, Gavel, LockKeyhole } from "lucide-react";
import { Logo } from "./brand";
import { useBackendAuth } from "./auth-provider";
import {
  SwitchNetworkButton,
  useInjectedConnectors,
  useWalletDisconnect,
  walletNetwork,
} from "./wallet";
import { Button, LoadingRow, Notice } from "./ui";
import { localChain } from "@/lib/blockchain/config";
import { describeError, shortenAddress } from "@/lib/blockchain/errors";
import { safeDestination } from "@/lib/auth-routing";

function Step({
  number,
  title,
  detail,
  state,
}: {
  number: number;
  title: string;
  detail: string;
  state: "done" | "active" | "upcoming";
}) {
  return (
    <li className={`signin-step ${state}`}>
      <span className="signin-step-number" aria-hidden="true">
        {state === "done" ? <Check size={13} strokeWidth={3} /> : number}
      </span>
      <div>
        <h2>
          {title}
          {state === "done" && <span className="sr-only"> (complete)</span>}
        </h2>
        <p>{detail}</p>
      </div>
    </li>
  );
}
/**
 * Wallet-based entry. Connection and SIWE sign-in are separate, explicit user
 * actions; nothing is signed automatically on page load. A matching valid
 * server session is restored without a new signature.
 */
export function SignIn() {
  const auth = useBackendAuth();
  const connection = useConnection();
  const connect = useConnect();
  const { available, recheck } = useInjectedConnectors();
  const disconnect = useWalletDisconnect();
  const router = useRouter();
  const search = useSearchParams();
  const params = {
    next: safeDestination(search.get("next")),
    ended: search.get("ended") === "1",
  };
  const restoring =
    connection.status === "connecting" || connection.status === "reconnecting";
  const connected = connection.isConnected && !!connection.address;
  const onNetwork = connected && connection.chainId === localChain.id;
  const signedIn = !!auth.session && !auth.checking;
  useEffect(() => {
    if (signedIn) router.replace(params.next);
  }, [signedIn, params.next, router]);

  let action;
  if (signedIn) action = <LoadingRow label="Signed in. Opening TrustLayer…" />;
  else if (auth.checking || restoring || available === null)
    action = <LoadingRow label="Checking for an existing session…" />;
  else if (!connected && !available.length)
    action = (
      <Notice tone="warning" title="No browser wallet found">
        <p>
          Install MetaMask (metamask.io) or another EVM browser wallet, then
          check again. TrustLayer never asks for a private key or recovery
          phrase.
        </p>
        <div className="mt-2">
          <Button variant="secondary" onClick={recheck}>
            Check again
          </Button>
        </div>
      </Notice>
    );
  else if (!connected)
    action = (
      <div className="signin-actions">
        {available.map((connector) => (
          <Button
            key={connector.uid}
            className="btn-block"
            disabled={connect.isPending}
            onClick={() => connect.mutate({ connector })}
          >
            {connect.isPending
              ? "Check your wallet…"
              : available.length > 1
                ? `Connect ${connector.name}`
                : "Connect wallet"}
          </Button>
        ))}
        <p className="small text-faint">
          Connecting shares your address only. It does not sign anything or send
          a transaction.
        </p>
      </div>
    );
  else if (!onNetwork)
    action = (
      <div className="signin-actions">
        <Notice tone="warning" title="Switch network">
          <p>
            Your wallet is on {walletNetwork(connection.chainId)}. TrustLayer
            currently runs on its local network (chain {localChain.id}).
          </p>
        </Notice>
        <SwitchNetworkButton block />
      </div>
    );
  else if (!auth.configured)
    action = (
      <Notice
        tone="danger"
        title="Sign-in is unavailable"
        role="alert"
        label="Backend setup"
      >
        <p>
          The server’s database is not configured, so sessions cannot be
          created. See “Getting started” in the README.
        </p>
      </Notice>
    );
  else
    action = (
      <div className="signin-actions">
        <Button
          className="btn-block"
          disabled={auth.busy}
          onClick={() => void auth.signIn()}
        >
          {auth.busy ? "Confirm in your wallet…" : "Sign in with Ethereum"}
        </Button>
        <p className="small text-faint">
          You’ll sign a one-time message proving you own this address. It’s free
          and sends no transaction.
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={auth.busy || disconnect.pending}
          onClick={() => void disconnect.run().catch(() => undefined)}
        >
          Use a different wallet
        </Button>
      </div>
    );

  const walletState = connected ? "done" : "active";
  const signState = signedIn ? "done" : onNetwork ? "active" : "upcoming";
  const walletError = connect.error ?? disconnect.error;
  return (
    <div className="signin">
      <aside className="signin-aside">
        <Logo href="/sign-in" />
        <div>
          <h2>Freelance payments, held fairly until the work is done.</h2>
          <p>
            Milestone escrow, private deliverables and independent juror review
            — enforced by smart contracts.
          </p>
        </div>
        <ul className="signin-points">
          <li>
            <LockKeyhole size={18} aria-hidden="true" />
            <div>
              <h3>Escrow per milestone</h3>
              <p>
                Clients fund upfront. Freelancers are paid as each milestone is
                approved.
              </p>
            </div>
          </li>
          <li>
            <FileLock2 size={18} aria-hidden="true" />
            <div>
              <h3>Private, verifiable deliverables</h3>
              <p>
                Files stay private; a SHA-256 fingerprint proves they weren’t
                changed.
              </p>
            </div>
          </li>
          <li>
            <Gavel size={18} aria-hidden="true" />
            <div>
              <h3>Disputes decided by jurors</h3>
              <p>
                Three staked jurors vote. Without a majority, funds split 50/50.
              </p>
            </div>
          </li>
        </ul>
        <p className="signin-legal">
          Development network · MockUSD has no monetary value · Unaudited
          contracts
        </p>
      </aside>
      <main id="main" className="signin-main">
        <div className="signin-card">
          <div className="signin-mobile-brand">
            <Logo href="/sign-in" />
          </div>
          <h1>Sign in to TrustLayer</h1>
          <p>Use your wallet to access your projects, payments and disputes.</p>
          {params.ended && !signedIn && (
            <Notice tone="info" className="mt-5">
              <p>
                Your session ended or your wallet changed. Sign in again to
                continue.
              </p>
            </Notice>
          )}
          <ol className="signin-steps">
            <Step
              number={1}
              title="Connect your wallet"
              detail={
                connected
                  ? `${shortenAddress(connection.address!)} · ${walletNetwork(connection.chainId)}`
                  : "MetaMask or another browser wallet"
              }
              state={walletState}
            />
            <Step
              number={2}
              title="Verify it’s you"
              detail="Sign a message — free, no transaction"
              state={signState}
            />
          </ol>
          {action}
          {auth.error && !signedIn && (
            <p
              role="alert"
              aria-label="Backend authentication error"
              className="form-error mt-4"
            >
              {auth.error}
            </p>
          )}
          {walletError && (
            <p
              role="alert"
              aria-label="Wallet request error"
              className="form-error mt-4"
            >
              {describeError(walletError).message}
            </p>
          )}
          <p className="signin-foot">
            Local development network (chain {localChain.id}). Sessions expire
            automatically; you can sign out at any time.
          </p>
        </div>
      </main>
    </div>
  );
}
