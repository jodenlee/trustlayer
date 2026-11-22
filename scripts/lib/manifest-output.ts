import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  assertDeploymentOnChain,
  parseLocalDeployment,
  type LocalDeployment,
} from "../../packages/contracts/src/index.js";
import type { PublicClient } from "viem";

/** Preserve the database scope anchor after activity; never replace another chain's export. */
export async function writeDeploymentExport(
  path: string,
  manifest: LocalDeployment,
  client: PublicClient,
) {
  let existing: LocalDeployment | undefined;
  try {
    existing = parseLocalDeployment(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing) {
    await assertDeploymentOnChain(client, existing);
    assert.deepEqual(
      existing.contracts,
      manifest.contracts,
      "Existing export belongs to different contracts; archive it explicitly before a new export.",
    );
    assert.equal(
      existing.deploymentId,
      manifest.deploymentId,
      "Existing export belongs to another deployment ID.",
    );
    assert.equal(
      existing.ephemeral,
      manifest.ephemeral,
      "Existing export has different provenance.",
    );
    if (
      !existing.chainIdentity &&
      !existing.hardhatInstanceId &&
      !existing.ephemeral
    )
      throw new Error(
        "Legacy manifest: archive the existing file explicitly, then export with a managed chain session or Hardhat instance binding. Preserve its original verifiedBlock for existing metadata; see docs/PHASE5.md.",
      );
    return existing;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
  return manifest;
}
