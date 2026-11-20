import {
  assertDeploymentOnChain,
  getContracts,
  parseLocalDeployment,
  type LocalDeployment,
} from "@trustlayer/contracts";
import type { PublicClient } from "viem";
import { IntegrationError } from "./errors";

export const LOCAL_RPC_URL = "http://127.0.0.1:8545";
export const DEPLOYMENT_URL = "/deployments/31337.json";
export const SETUP_GUIDANCE =
  "Restore the matching local backup, or explicitly initialize a new deployment. Preserve historical metadata and the original export anchor; see docs/PHASE5.md. Then run npm.cmd --prefix apps/web run contracts:sync.";

export function validateManifest(value: unknown): LocalDeployment {
  let manifest: LocalDeployment;
  try {
    manifest = parseLocalDeployment(value);
  } catch {
    throw new IntegrationError(
      "deployment",
      `Deployment export is missing or invalid. ${SETUP_GUIDANCE}`,
    );
  }
  if (manifest.ephemeral)
    throw new IntegrationError(
      "deployment",
      `This is an ephemeral verification deployment, not a running local setup. ${SETUP_GUIDANCE}`,
    );
  if (!manifest.chainIdentity && !manifest.hardhatInstanceId)
    throw new IntegrationError(
      "deployment",
      `This legacy export lacks a unique local-chain binding. Archive and upgrade it explicitly using the original anchor; do not reset the chain. ${SETUP_GUIDANCE}`,
    );
  const url = new URL(manifest.rpcUrl);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.port !== "8545"
  )
    throw new IntegrationError(
      "deployment",
      `Export the persistent deployment for port 8545. ${SETUP_GUIDANCE}`,
    );
  return manifest;
}
export async function loadManifest(signal?: AbortSignal) {
  const response = await fetch(DEPLOYMENT_URL, { cache: "no-store", signal });
  if (!response.ok)
    throw new IntegrationError(
      "deployment",
      `Deployment manifest is unavailable. ${SETUP_GUIDANCE}`,
    );
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new IntegrationError(
      "deployment",
      `Deployment JSON is unreadable. ${SETUP_GUIDANCE}`,
    );
  }
  return validateManifest(value);
}
export type VerificationClient = Pick<
  PublicClient,
  "getChainId" | "getBlock" | "getCode"
> &
  Partial<Pick<PublicClient, "request">>;
export async function verifyManifest(
  client: VerificationClient,
  manifest: LocalDeployment,
) {
  try {
    await assertDeploymentOnChain(client, manifest);
  } catch (error) {
    if (
      error instanceof Error &&
      /changed|missing|match|ABI|schema|hash|block.*not.*found/i.test(
        error.message,
      ) &&
      !/HTTP|fetch|request|connect/i.test(error.message)
    )
      throw new IntegrationError(
        "deployment",
        `Deployment validation failed; the chain may have reset. ${SETUP_GUIDANCE}`,
      );
    throw error;
  }
  return getContracts(manifest, manifest.chainId);
}
/** Injected providers have no HTTP timeout; bound read-only verification explicitly. */
export async function verifyWalletManifest(
  client: VerificationClient,
  manifest: LocalDeployment,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      verifyManifest(client, manifest),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new IntegrationError(
                "rpc",
                "The wallet did not answer deployment verification. Reconnect and retry.",
              ),
            ),
          7000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
