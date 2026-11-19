import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import "../../../hardhat.config.js";
import { createPublicClient, custom, type EIP1193Provider } from "viem";
import phase2D from "../../../ignition/modules/Phase2D.js";
import { readCompiledContracts } from "../../../scripts/lib/artifacts.js";
import { verifyDeployment } from "../../../scripts/lib/deployment.js";
import { assertDeploymentOnChain } from "@trustlayer/contracts";
import { localChain } from "../src/lib/blockchain/config.js";
import { chainAuthority } from "../src/lib/server/chain.js";
import { BackendService } from "../src/lib/server/service.js";
import { testDatabase } from "../test-support/database.js";

// Owned in-process EVM + embedded PostgreSQL only. No running node/export/reset.
const connection = await network.create();
const database = await testDatabase();
try {
  const deployed = await connection.ignition.deploy(phase2D);
  const manifest = await verifyDeployment(
    connection.viem,
    {
      MockUSD: deployed.token.address,
      TrustEscrow: deployed.escrow.address,
      JurorRegistry: deployed.registry.address,
      DisputeArbitration: deployed.arbitration.address,
      ProtocolTreasury: deployed.treasury.address,
    },
    await readCompiledContracts(
      fileURLToPath(new URL("../../../", import.meta.url)),
    ),
    {
      deploymentId: "phase4a-backend-verification",
      rpcUrl: "http://127.0.0.1:8545",
      ephemeral: false,
      fresh: true,
    },
  );
  const client = createPublicClient({
    chain: localChain,
    transport: custom(connection.provider as EIP1193Provider),
  });
  const [, customer, worker, outsider] =
    await connection.viem.getWalletClients();
  const due = (await client.getBlock()).timestamp + 9n * 86400n;
  const hash = await deployed.escrow.write.createProject(
    [worker.account.address, [10_000_000n], [due], `0x${"1".repeat(64)}`],
    { account: customer.account },
  );
  assert.equal(
    (await client.waitForTransactionReceipt({ hash })).status,
    "success",
  );
  const authority = chainAuthority(async () => {
    await assertDeploymentOnChain(client, manifest);
    return { manifest, client };
  });
  const service = new BackendService(
    database.db,
    "http://127.0.0.1:3000",
    authority,
  );
  const wallet = customer.account.address.toLowerCase();
  const challenge = await service.nonce(wallet);
  const signature = await customer.signMessage({ message: challenge.message });
  const login = await service.verify(
    challenge.message,
    signature,
    challenge.challenge,
  );
  assert.equal((await service.session(login.token))?.address, wallet);
  const scope = {
    chainId: "31337" as const,
    escrowAddress: deployed.escrow.address.toLowerCase(),
    deploymentHash: manifest.verifiedBlock.hash.toLowerCase(),
  };
  const metadata = {
    title: "Persistent local metadata",
    description: "Non-sensitive scope",
    milestones: [{ index: 0, description: "First deliverable" }],
  };
  const stored = await service.saveProject(wallet, scope, "0", metadata);
  assert.equal(stored.title, metadata.title);
  assert.equal(
    (await service.project(worker.account.address.toLowerCase(), scope, "0"))
      .id,
    stored.id,
  );
  await assert.rejects(
    service.saveProject(
      outsider.account.address.toLowerCase(),
      scope,
      "0",
      metadata,
    ),
    /Only project participants/,
  );
  await assert.rejects(
    service.project(
      wallet,
      { ...scope, deploymentHash: `0x${"f".repeat(64)}` },
      "0",
    ),
    /verified active deployment/,
  );
  assert.equal(await deployed.escrow.read.totalEscrowLiability(), 0n);
  assert.equal(
    await deployed.token.read.balanceOf([customer.account.address]),
    0n,
  );
  await service.logout(login.token);
  assert.equal(await service.session(login.token), null);
  console.log(
    "Phase 4A backend integration passed: actual wallet signature, production-contract participants, persisted PostgreSQL metadata, outsider/stale deployment rejection, unchanged zero escrow liability and logout.",
  );
} finally {
  await database.pg.close();
  await connection.close();
}
