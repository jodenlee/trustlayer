export type IntegrationErrorKind =
  | "rejected"
  | "network"
  | "disconnected"
  | "deployment"
  | "rpc"
  | "reverted"
  | "unknown";
export class IntegrationError extends Error {
  constructor(
    public readonly kind: IntegrationErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}
export function describeError(error: unknown): {
  kind: IntegrationErrorKind;
  message: string;
} {
  if (error instanceof IntegrationError)
    return { kind: error.kind, message: error.message };
  const visited = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const item = current as { code?: number; name?: string; cause?: unknown };
    if (item.name?.includes("InsufficientFunds"))
      return {
        kind: "rpc",
        message:
          "Insufficient local ETH for gas. Provision local development ETH outside this app, then retry.",
      };
    if (item.code === 4001 || item.name === "UserRejectedRequestError")
      return {
        kind: "rejected",
        message: "Request rejected in your wallet. Nothing was confirmed.",
      };
    if (item.name?.includes("Reverted"))
      return {
        kind: "reverted",
        message:
          "The transaction reverted. No successful execution was confirmed.",
      };
    if (item.name?.includes("ChainMismatch") || item.code === 4902)
      return {
        kind: "network",
        message: "Switch your wallet to Hardhat Local (31337).",
      };
    if (item.code === 4900 || item.code === 4901)
      return {
        kind: "disconnected",
        message: "The wallet provider disconnected. Reconnect and try again.",
      };
    current = item.cause;
  }
  return {
    kind: "rpc",
    message:
      "The local RPC or wallet request failed. Check the node at http://127.0.0.1:8545 and retry.",
  };
}
export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
