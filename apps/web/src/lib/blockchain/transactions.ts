import type { Hash } from "viem";
import {
  describeError,
  IntegrationError,
  type IntegrationErrorKind,
} from "./errors";

export type TransactionPhase =
  | "idle"
  | "validating"
  | "awaiting-signature"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "rejected"
  | "reverted"
  | "failed"
  | "unconfirmed"
  | "cancelled"
  | "replaced";
export interface TransactionLifecycle {
  phase: TransactionPhase;
  hash?: Hash;
  submittedHash?: Hash;
  blockNumber?: bigint;
  message?: string;
  errorKind?: IntegrationErrorKind;
  refreshWarning?: string;
}
export interface ReceiptSummary {
  status: "success" | "reverted";
  transactionHash: Hash;
  blockNumber: bigint;
}
export interface Replacement {
  reason: "repriced" | "replaced" | "cancelled";
  hash: Hash;
}
export interface TransactionDependencies<Context> {
  validate: () => Promise<Context>;
  isCurrent: () => boolean;
  wait: (
    hash: Hash,
    onReplaced: (replacement: Replacement) => void,
  ) => Promise<ReceiptSummary>;
  refresh: () => Promise<unknown>;
  publish: (state: TransactionLifecycle) => void;
}
/** Generic infrastructure only. No production page invokes this controller in Phase 3B. */
export function createTransactionController<Context>(
  dependencies: TransactionDependencies<Context>,
) {
  let generation = 0;
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    reset() {
      generation++;
      dependencies.publish({ phase: "idle" });
    },
    async execute(submit: (context: Context) => Promise<Hash>) {
      if (busy)
        throw new IntegrationError(
          "unknown",
          "A wallet request is already being tracked. Wait before starting another.",
        );
      busy = true;
      const run = ++generation;
      const current = () => generation === run && dependencies.isCurrent();
      const publish = (state: TransactionLifecycle) => {
        if (current()) dependencies.publish(state);
      };
      let hash: Hash | undefined;
      let submittedHash: Hash | undefined;
      let replacementReason: Replacement["reason"] | undefined;
      try {
        publish({ phase: "validating" });
        const context = await dependencies.validate();
        if (!current()) return;
        publish({ phase: "awaiting-signature" });
        const candidate = await submit(context);
        if (!/^0x[\da-fA-F]{64}$/.test(candidate))
          throw new IntegrationError(
            "rpc",
            "The wallet returned an invalid transaction hash.",
          );
        hash = candidate;
        submittedHash = hash;
        if (!current()) return;
        publish({ phase: "submitted", hash, submittedHash });
        publish({ phase: "confirming", hash, submittedHash });
        const receipt = await dependencies.wait(hash, (replacement) => {
          replacementReason = replacement.reason;
          hash = replacement.hash;
          publish({ phase: "confirming", hash, submittedHash });
        });
        if (!current()) return;
        if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase())
          throw new IntegrationError(
            "rpc",
            "The receipt does not match the tracked transaction.",
          );
        hash = receipt.transactionHash;
        if (
          replacementReason === "cancelled" ||
          replacementReason === "replaced"
        ) {
          publish({
            phase: replacementReason,
            hash,
            submittedHash,
            message:
              replacementReason === "cancelled"
                ? "The wallet cancelled the original transaction with a replacement."
                : "A different transaction replaced the original request; its intended action is not confirmed.",
          });
          return;
        }
        if (receipt.status !== "success") {
          publish({
            phase: "reverted",
            hash,
            submittedHash,
            errorKind: "reverted",
            message:
              "The mined transaction reverted. It did not execute successfully; gas may still have been spent.",
          });
          return;
        }
        publish({
          phase: "confirmed",
          hash,
          submittedHash,
          blockNumber: receipt.blockNumber,
        });
        try {
          await dependencies.refresh();
        } catch {
          publish({
            phase: "confirmed",
            hash,
            submittedHash,
            blockNumber: receipt.blockNumber,
            refreshWarning:
              "Transaction confirmed, but refreshing reads failed. Retry the reads separately.",
          });
        }
      } catch (error) {
        const failure = describeError(error);
        publish({
          phase: hash
            ? "unconfirmed"
            : failure.kind === "rejected"
              ? "rejected"
              : failure.kind === "reverted"
                ? "reverted"
                : "failed",
          hash,
          submittedHash,
          errorKind: failure.kind,
          message: hash
            ? "Transaction was submitted, but confirmation could not be established. Check its receipt before retrying; do not assume failure."
            : failure.message,
        });
      } finally {
        busy = false;
      }
    },
  };
}

/** Signing a message is separate from transaction execution and never indicates a payment. */
export async function requestWalletSignature<Context>(
  validate: () => Promise<Context>,
  sign: (context: Context) => Promise<Hash>,
  isCurrent: () => boolean = () => true,
): Promise<Hash> {
  const context = await validate();
  if (!isCurrent())
    throw new IntegrationError(
      "disconnected",
      "The account or network changed before signing.",
    );
  const result = await sign(context);
  if (!isCurrent())
    throw new IntegrationError(
      "disconnected",
      "The account or network changed during signing. Do not use this signature for the new account.",
    );
  return result;
}
