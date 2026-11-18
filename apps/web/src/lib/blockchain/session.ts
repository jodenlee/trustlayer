import type { Address, Hash } from "viem";
import type { LocalDeployment } from "@trustlayer/contracts";
import type { SessionMetadata } from "./projects";
import type { TransactionLifecycle } from "./transactions";
import { IntegrationError } from "./errors";

export function deploymentScope(manifest: LocalDeployment) {
  return `${manifest.chainId}:${manifest.verifiedBlock.hash}:${manifest.contracts.TrustEscrow.address.toLowerCase()}`;
}
export interface AttemptDetails {
  kind: string;
  projectId?: bigint;
  milestoneIndex?: number;
  amount?: bigint;
  expectedScope?: string;
}
export function assertReviewScope(
  expected: string | undefined,
  manifest: LocalDeployment,
) {
  if (expected !== undefined && expected !== deploymentScope(manifest))
    throw new IntegrationError(
      "deployment",
      "The deployment changed since this action was reviewed. Refresh and review it again before signing.",
    );
}
export interface SessionAttempt extends AttemptDetails {
  id: number;
  scope: string;
  actor: Address;
  manifest: LocalDeployment;
  state: TransactionLifecycle;
  timestamp?: bigint;
}
const unresolved = (state: TransactionLifecycle) =>
  [
    "validating",
    "awaiting-signature",
    "submitted",
    "confirming",
    "unconfirmed",
  ].includes(state.phase);
/** Memory only. No localStorage, wallet secrets, backend or invented historical entries. */
export function createSessionStore() {
  const listeners = new Set<() => void>();
  let version = 0;
  let nextId = 0;
  const attempts: SessionAttempt[] = [];
  const metadata = new Map<string, SessionMetadata>();
  const notify = () => {
    version++;
    listeners.forEach((fn) => fn());
  };
  return {
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    snapshot: () => version,
    attempts: () => attempts,
    busy: (scope: string, actor: Address) =>
      attempts.some(
        (a) =>
          a.scope === scope &&
          a.actor.toLowerCase() === actor.toLowerCase() &&
          unresolved(a.state),
      ),
    busyActor: (chainId: number, actor: Address) =>
      attempts.some(
        (a) =>
          a.manifest.chainId === chainId &&
          a.actor.toLowerCase() === actor.toLowerCase() &&
          unresolved(a.state),
      ),
    begin(manifest: LocalDeployment, actor: Address, details: AttemptDetails) {
      const scope = deploymentScope(manifest);
      if (this.busyActor(manifest.chainId, actor))
        throw new IntegrationError(
          "unknown",
          "Another transaction is pending or unconfirmed for this wallet. Check its receipt in Transactions before retrying.",
        );
      const attempt: SessionAttempt = {
        ...details,
        id: ++nextId,
        scope,
        actor,
        manifest,
        state: { phase: "validating" },
      };
      attempts.push(attempt);
      notify();
      return attempt.id;
    },
    update(id: number, state: TransactionLifecycle) {
      const a = attempts.find((a) => a.id === id);
      if (a) {
        a.state = state;
        notify();
      }
    },
    timestamp(id: number, timestamp: bigint) {
      const a = attempts.find((a) => a.id === id);
      if (a) {
        a.timestamp = timestamp;
        notify();
      }
    },
    saveMetadata(scope: string, id: bigint, value: SessionMetadata) {
      metadata.set(`${scope}:${id}:${value.metadataHash}`, value);
      notify();
    },
    metadata(scope: string, id: bigint, hash: Hash) {
      return metadata.get(`${scope}:${id}:${hash}`);
    },
  };
}
