"use client";
import { CheckCircle2, XCircle } from "lucide-react";
import type { TransactionLifecycle } from "@/lib/blockchain/transactions";
import { Disclosure, Hash, Spinner } from "./ui";

const titles: Record<string, string> = {
  validating: "Checking wallet and network…",
  "awaiting-signature": "Confirm in your wallet",
  confirming: "Waiting for confirmation…",
  submitted: "Submitted",
  confirmed: "Confirmed",
  reverted: "Transaction failed",
  failed: "Not completed",
  unconfirmed: "Confirmation unknown",
  rejected: "Declined in wallet",
  cancelled: "Cancelled by a replacement",
  replaced: "Replaced by another transaction",
};
/** Actual signing and receipt state shared by escrow workflows. */
export function TransactionFeedback({
  state,
}: {
  state: TransactionLifecycle;
}) {
  if (state.phase === "idle") return null;
  const pending = ["validating", "awaiting-signature", "confirming"].includes(
    state.phase,
  );
  const tone =
    state.phase === "confirmed"
      ? "success"
      : ["reverted", "failed", "rejected", "cancelled", "replaced"].includes(
            state.phase,
          )
        ? "failed"
        : "";
  return (
    <div role="status" aria-live="polite" className={`tx-feedback ${tone}`}>
      <div className="tx-feedback-head">
        {pending ? (
          <Spinner />
        ) : tone === "success" ? (
          <CheckCircle2 size={16} aria-hidden="true" />
        ) : tone === "failed" ? (
          <XCircle size={16} aria-hidden="true" />
        ) : null}
        <span>
          {state.phase === "unconfirmed" && state.errorKind === "nonce"
            ? "Stuck: wallet nonce is ahead of the chain"
            : (titles[state.phase] ?? state.phase)}
        </span>
      </div>
      {state.phase === "awaiting-signature" && (
        <p className="text-muted">
          Confirm it when prompted. If no popup appears, open your wallet
          extension.
        </p>
      )}
      {state.phase === "confirming" && (
        <p className="text-muted">
          Submitted to the network. Don’t submit it again while waiting.
        </p>
      )}
      {state.phase === "submitted" && (
        <p className="text-muted">Submitted to the network; not confirmed.</p>
      )}
      {state.message && <p className="text-muted">{state.message}</p>}
      {state.refreshWarning && (
        <p className="text-muted">{state.refreshWarning}</p>
      )}
      {state.hash && (
        <Disclosure plain summary="Transaction details">
          <p className="small text-muted">
            Transaction hash <Hash value={state.hash} full />
          </p>
        </Disclosure>
      )}
    </div>
  );
}
