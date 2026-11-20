import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import "../../../hardhat.config.js";
import {
  createPublicClient,
  custom,
  type EIP1193Provider,
  type Hash,
} from "viem";
import phase2D from "../../../ignition/modules/Phase2D.js";
import { readCompiledContracts } from "../../../scripts/lib/artifacts.js";
import { verifyDeployment } from "../../../scripts/lib/deployment.js";
import { assertDeploymentOnChain } from "@trustlayer/contracts";
import { localChain } from "../src/lib/blockchain/config.js";
import { chainAuthority } from "../src/lib/server/chain.js";
import { BackendService } from "../src/lib/server/service.js";
import { FileService } from "../src/lib/server/file-service.js";
import { sha256 } from "../src/lib/server/storage.js";
import { testDatabase } from "../test-support/database.js";
import { testStorage } from "../test-support/storage.js";

// Actual production contracts and isolated SQL/storage only. No hosted data or exports.
const connection = await network.create();
const database = await testDatabase();
try {
  const d = await connection.ignition.deploy(phase2D);
  const manifest = await verifyDeployment(
    connection.viem,
    {
      MockUSD: d.token.address,
      TrustEscrow: d.escrow.address,
      JurorRegistry: d.registry.address,
      DisputeArbitration: d.arbitration.address,
      ProtocolTreasury: d.treasury.address,
    },
    await readCompiledContracts(
      fileURLToPath(new URL("../../../", import.meta.url)),
    ),
    {
      deploymentId: "phase4b-files-verification",
      rpcUrl: "http://127.0.0.1:8545",
      ephemeral: false,
      fresh: true,
    },
  );
  const client = createPublicClient({
    chain: localChain,
    transport: custom(connection.provider as EIP1193Provider),
  });
  const [owner, customer, worker, j1, j2, j3, outsider] =
    await connection.viem.getWalletClients();
  async function confirmed(hash: Hash) {
    assert.equal(
      (await client.waitForTransactionReceipt({ hash })).status,
      "success",
    );
    return hash;
  }
  const a = customer.account.address.toLowerCase(),
    b = worker.account.address.toLowerCase();
  const scope = {
    chainId: "31337" as const,
    escrowAddress: d.escrow.address.toLowerCase(),
    deploymentHash: manifest.verifiedBlock.hash.toLowerCase(),
  };
  const target = { ...scope, projectId: "0", milestoneIndex: 0 };
  const service = new BackendService(
    database.db,
    "http://127.0.0.1:3000",
    chainAuthority(async () => {
      await assertDeploymentOnChain(client, manifest);
      return { manifest, client };
    }),
  );
  const storage = testStorage(),
    files = new FileService(service, storage.storage);
  await confirmed(
    await d.escrow.write.createProject(
      [
        worker.account.address,
        [10_000_000n],
        [(await client.getBlock()).timestamp + 9n * 86400n],
        `0x${"1".repeat(64)}`,
      ],
      { account: customer.account },
    ),
  );
  await service.saveProject(a, scope, "0", {
    title: "Private delivery",
    description: "Persistent scope",
    milestones: [{ index: 0, name: "Delivery", description: "Exact bytes" }],
  });
  await confirmed(
    await d.token.write.transfer([customer.account.address, 50_000_000n], {
      account: owner.account,
    }),
  );
  await confirmed(
    await d.token.write.approve([d.escrow.address, 10_000_000n], {
      account: customer.account,
    }),
  );
  await confirmed(
    await d.escrow.write.fundProject([0n], { account: customer.account }),
  );
  await confirmed(
    await d.escrow.write.acceptProject([0n], { account: worker.account }),
  );
  const bytes = new TextEncoder().encode(
      "Confidential exact-byte deliverable\n",
    ),
    hash = sha256(bytes) as Hash;
  const deliverable = await files.upload(
    b,
    target,
    "deliverable",
    randomUUID(),
    "delivery.txt",
    "text/plain",
    bytes,
    hash,
  );
  await assert.rejects(
    files.download(a, scope, deliverable.id),
    /cannot retrieve/,
  );
  const submitted = await confirmed(
    await d.escrow.write.submitMilestone([0n, 0n, hash], {
      account: worker.account,
    }),
  );
  await assert.rejects(
    files.associate(b, scope, deliverable.id, `0x${"f".repeat(64)}`),
  );
  await files.associate(b, scope, deliverable.id, submitted);
  assert.deepEqual(
    (await files.download(a, scope, deliverable.id)).bytes,
    bytes,
  );
  for (const juror of [j1, j2, j3]) {
    await confirmed(
      await d.token.write.transfer([juror.account.address, 100_000_000n], {
        account: owner.account,
      }),
    );
    await confirmed(
      await d.token.write.approve([d.registry.address, 100_000_000n], {
        account: juror.account,
      }),
    );
    await confirmed(
      await d.registry.write.registerJuror({ account: juror.account }),
    );
    await confirmed(
      await d.registry.write.depositStake([100_000_000n], {
        account: juror.account,
      }),
    );
  }
  const opening = await files.upload(
    a,
    target,
    "opening",
    randomUUID(),
    "opening.txt",
    "text/plain",
    bytes,
    hash,
  );
  await confirmed(
    await d.token.write.approve([d.arbitration.address, 15_000_000n], {
      account: customer.account,
    }),
  );
  const opened = await confirmed(
    await d.arbitration.write.openDispute([0n, 0n, hash], {
      account: customer.account,
    }),
  );
  await files.associate(a, scope, opening.id, opened, "0");
  // Idempotent recovery with the original pre-opening request target.
  const row = (
    await database.db.query<{ idempotency_key: string }>(
      "SELECT idempotency_key FROM trustlayer.files WHERE id=$1",
      [opening.id],
    )
  ).rows[0];
  assert.equal(
    (
      await files.upload(
        a,
        target,
        "opening",
        row.idempotency_key,
        "opening.txt",
        "text/plain",
        bytes,
        hash,
      )
    ).id,
    opening.id,
  );
  const caseTarget = { ...target, disputeId: "0" };
  const response = await files.upload(
    b,
    caseTarget,
    "response",
    randomUUID(),
    "response.txt",
    "text/plain",
    bytes,
    hash,
  );
  const responded = await confirmed(
    await d.arbitration.write.respondToDispute([0n, hash], {
      account: worker.account,
    }),
  );
  await files.associate(b, scope, response.id, responded, "0");
  const extra = await files.upload(
    a,
    caseTarget,
    "evidence",
    randomUUID(),
    "extra.txt",
    "text/plain",
    bytes,
    hash,
  );
  assert.equal(
    (await files.list(j1.account.address.toLowerCase(), caseTarget)).length,
    4,
  );
  await files.download(j1.account.address.toLowerCase(), scope, deliverable.id);
  await files.download(j1.account.address.toLowerCase(), scope, extra.id);
  await assert.rejects(
    files.download(outsider.account.address.toLowerCase(), scope, extra.id),
    /cannot retrieve/,
  );
  const dispute = await d.arbitration.read.getDispute([0n]);
  await connection.provider.request({
    method: "evm_setNextBlockTimestamp",
    params: [Number(dispute.responseDeadline)],
  });
  await connection.provider.request({ method: "evm_mine", params: [] });
  await assert.rejects(
    files.upload(
      a,
      caseTarget,
      "evidence",
      randomUUID(),
      "late.txt",
      "text/plain",
      bytes,
      hash,
    ),
    /response deadline/,
  );
  await connection.provider.request({
    method: "evm_setNextBlockTimestamp",
    params: [Number(dispute.votingDeadline + 1n)],
  });
  await confirmed(
    await d.arbitration.write.finalizeDispute([0n], {
      account: outsider.account,
    }),
  );
  await files.download(j1.account.address.toLowerCase(), scope, opening.id);
  await assert.rejects(files.remove(a, scope, extra.id), /cannot be deleted/);
  assert.equal(await d.escrow.read.totalEscrowLiability(), 0n);
  // Phase 5 combines durable SIWE/profile/SQL, private exact-byte attachments,
  // actual receipts and every settlement branch in one isolated system run.
  for (const wallet of [customer, worker, j1, j2, j3]) {
    const address = wallet.account.address.toLowerCase();
    const challenge = await service.nonce(address);
    const login = await service.verify(
      challenge.message,
      await wallet.signMessage({ message: challenge.message }),
      challenge.challenge,
    );
    assert.equal((await service.session(login.token))?.address, address);
    await service.updateProfile(address, {
      displayName: "Integration wallet",
      biography: "Isolated verification",
    });
    assert.equal(
      (await service.profile(address)).display_name,
      "Integration wallet",
    );
  }
  for (const juror of [j1, j2, j3])
    await confirmed(
      await d.arbitration.write.claimJurorReward([0n], {
        account: juror.account,
      }),
    );
  await confirmed(
    await d.token.write.transfer([customer.account.address, 200_000_000n]),
  );
  for (const [index, outcome] of [0, 1, 2, 3].entries()) {
    const id = BigInt(index + 1),
      idString = String(id),
      amount = 10_000_000n;
    const target = { ...scope, projectId: idString, milestoneIndex: 0 };
    await confirmed(
      await d.escrow.write.createProject(
        [
          worker.account.address,
          [amount],
          [(await client.getBlock()).timestamp + 9n * 86400n],
          hash,
        ],
        { account: customer.account },
      ),
    );
    const metadata = {
      title: `System outcome ${outcome}`,
      description: "Verified scope",
      milestones: [
        { index: 0, name: "Delivery", description: "Private bytes" },
      ],
    };
    // SQL outage after the confirmed chain action: retry metadata, never create again.
    const save = service.saveProject.bind(service);
    const unavailable = new BackendService(
      {
        ...database.db,
        transaction: async () => {
          throw new Error("simulated backend outage after chain confirmation");
        },
      },
      service.origin,
      service.chain,
    );
    await assert.rejects(
      unavailable.saveProject(a, scope, idString, metadata),
      /simulated backend outage/,
    );
    await save(a, scope, idString, metadata);
    await save(a, scope, idString, metadata);
    assert.equal(
      (await service.project(b, scope, idString)).title,
      metadata.title,
    );
    assert.equal(await d.escrow.read.nextProjectId(), id + 1n);
    await confirmed(
      await d.token.write.approve([d.escrow.address, amount], {
        account: customer.account,
      }),
    );
    await confirmed(
      await d.escrow.write.fundProject([id], { account: customer.account }),
    );
    await confirmed(
      await d.escrow.write.acceptProject([id], { account: worker.account }),
    );
    const file = await files.upload(
      b,
      target,
      "deliverable",
      randomUUID(),
      "delivery.txt",
      "text/plain",
      bytes,
      hash,
    );
    const submitted = await confirmed(
      await d.escrow.write.submitMilestone([id, 0n, hash], {
        account: worker.account,
      }),
    );
    await files.associate(b, scope, file.id, submitted);
    await files.associate(b, scope, file.id, submitted);
    assert.deepEqual((await files.download(a, scope, file.id)).bytes, bytes);
    const freelancerBefore = await d.token.read.balanceOf([
      worker.account.address,
    ]);
    const clientBefore = await d.token.read.balanceOf([
      customer.account.address,
    ]);
    const treasuryBefore = await d.treasury.read.availableRevenue();
    if (outcome === 0) {
      await confirmed(
        await d.escrow.write.approveMilestone([id, 0n], {
          account: customer.account,
        }),
      );
      assert.equal(
        await d.token.read.balanceOf([worker.account.address]),
        freelancerBefore + 9_900_000n,
      );
      assert.equal(
        await d.treasury.read.availableRevenue(),
        treasuryBefore + 100_000n,
      );
    } else {
      const caseId = await d.arbitration.read.nextDisputeId();
      const open = await files.upload(
        a,
        target,
        "opening",
        randomUUID(),
        "opening.txt",
        "text/plain",
        bytes,
        hash,
      );
      await confirmed(
        await d.token.write.approve([d.arbitration.address, 15_000_000n], {
          account: customer.account,
        }),
      );
      const opened = await confirmed(
        await d.arbitration.write.openDispute([id, 0n, hash], {
          account: customer.account,
        }),
      );
      await files.associate(a, scope, open.id, opened, String(caseId));
      const response = await files.upload(
        b,
        { ...target, disputeId: String(caseId) },
        "response",
        randomUUID(),
        "response.txt",
        "text/plain",
        bytes,
        hash,
      );
      const responded = await confirmed(
        await d.arbitration.write.respondToDispute([caseId, hash], {
          account: worker.account,
        }),
      );
      await files.associate(b, scope, response.id, responded, String(caseId));
      await files.download(
        j1.account.address.toLowerCase(),
        scope,
        response.id,
      );
      await assert.rejects(
        files.download(
          outsider.account.address.toLowerCase(),
          scope,
          response.id,
        ),
      );
      const dispute = await d.arbitration.read.getDispute([caseId]);
      await connection.provider.request({
        method: "evm_setNextBlockTimestamp",
        params: [Number(dispute.responseDeadline)],
      });
      for (const juror of [j1, j2])
        await confirmed(
          await d.arbitration.write.castVote([caseId, outcome], {
            account: juror.account,
          }),
        );
      await connection.provider.request({
        method: "evm_setNextBlockTimestamp",
        params: [Number(dispute.votingDeadline + 1n)],
      });
      await confirmed(
        await d.arbitration.write.finalizeDispute([caseId], {
          account: outsider.account,
        }),
      );
      const bps = outcome === 1 ? 10000n : outcome === 2 ? 0n : 5000n;
      const gross = (amount * bps) / 10000n,
        fee = gross / 100n;
      const settled = await d.arbitration.read.getDispute([caseId]);
      assert.equal(BigInt(settled.freelancerBps), bps);
      assert.equal(settled.fallbackApplied, false);
      assert.equal(
        await d.token.read.balanceOf([worker.account.address]),
        freelancerBefore + gross - fee,
      );
      assert.equal(
        await d.token.read.balanceOf([customer.account.address]),
        clientBefore - 15_000_000n + amount - gross,
      );
      assert.equal(
        await d.treasury.read.availableRevenue(),
        treasuryBefore + 3_000_000n + fee,
      );
      for (const juror of [j1, j2, j3]) {
        const before = await d.token.read.balanceOf([juror.account.address]);
        await confirmed(
          await d.arbitration.write.claimJurorReward([caseId], {
            account: juror.account,
          }),
        );
        assert.equal(
          await d.token.read.balanceOf([juror.account.address]),
          before + 4_000_000n,
        );
      }
      await files.download(j1.account.address.toLowerCase(), scope, open.id);
    }
    assert.equal(await d.escrow.read.totalEscrowLiability(), 0n);
  }
  assert.equal(await d.registry.read.totalStaked(), 300_000_000n);
  assert.equal(await d.registry.read.totalLockedStake(), 0n);
  assert.equal(await d.arbitration.read.reservedJurorRewards(), 0n);
  assert.equal(await d.token.read.balanceOf([d.escrow.address]), 0n);
  assert.equal(await d.treasury.read.availableRevenue(), 12_300_000n);
  const balances = await Promise.all(
    [
      owner.account.address,
      customer.account.address,
      worker.account.address,
      j1.account.address,
      j2.account.address,
      j3.account.address,
      d.escrow.address,
      d.registry.address,
      d.arbitration.address,
      d.treasury.address,
    ].map((address) => d.token.read.balanceOf([address])),
  );
  assert.equal(
    balances.reduce((sum, balance) => sum + balance, 0n),
    await d.token.read.totalSupply(),
  );
  console.log(
    "Phase 5 full-system outcomes passed: normal approval, freelancer/client/split majorities and earlier fallback, actual SIWE/profile persistence, idempotent metadata/file recovery, private party/juror access, exact payouts/fees and 12 reward claims; staking collateral intact.",
  );
  console.log(
    "Phase 4B file integration passed: actual escrow submission/opening/response receipts, SHA-256 attachments, SQL metadata, private party/juror access, deadline rejection and retained evidence after finalization; zero escrow liability.",
  );
} finally {
  await database.pg.close();
  await connection.close();
}
