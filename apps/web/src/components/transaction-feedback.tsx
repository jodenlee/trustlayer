"use client";
import type { TransactionLifecycle } from "@/lib/blockchain/transactions";
/** Reusable feedback for future flows. Not a demo transaction button. */
export function TransactionFeedback({
  state,
}: {
  state: TransactionLifecycle;
}) {
  if (state.phase === "idle") return null;
  return (
    <div role="status" aria-live="polite" className="transaction-feedback">
      <strong>{state.phase.replaceAll("-", " ")}</strong>
      {state.hash && (
        <p className="wallet-address">
          <span className="small text-muted">Transaction hash </span>
          <code>{state.hash}</code>
        </p>
      )}
      {state.phase === "submitted" && (
        <p className="small">Submitted to the network; not confirmed.</p>
      )}
      {state.message && <p className="small mt-2">{state.message}</p>}
      {state.refreshWarning && (
        <p className="small mt-2">{state.refreshWarning}</p>
      )}
    </div>
  );
}
