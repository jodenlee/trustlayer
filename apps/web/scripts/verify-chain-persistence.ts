import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { network } from "hardhat";
import { createPublicClient, http, toHex } from "viem";
import type { Hex } from "viem";
import "../../../hardhat.config.js";
import phase2D from "../../../ignition/modules/Phase2D.js";
import {
  backupChain,
  checkSession,
  readBackup,
  startChain,
  stopNode,
} from "../../../scripts/lib/local-chain.js";
import { readCompiledContracts } from "../../../scripts/lib/artifacts.js";
import {
  verifyDeployment,
  getProtocolContracts,
} from "../../../scripts/lib/deployment.js";
import { assertDeploymentOnChain } from "../../../packages/contracts/src/index.js";
import { testDatabase } from "../test-support/database.js";
import { testStorage } from "../test-support/storage.js";
import { BackendService } from "../src/lib/server/service.js";
import { FileService } from "../src/lib/server/file-service.js";
import { chainAuthority } from "../src/lib/server/chain.js";
import { sha256 } from "../src/lib/server/storage.js";

// Disposable processes/port only; never reads hosted credentials or writes the active export.
const id = `verify-${randomUUID()}`;
const port = 18546;
const directory = resolve(".local-chain", "verification", id);
await mkdir(directory, { recursive: true });
const path = resolve(directory, "backup.json");
const guardDirectory = resolve(directory, "cli-guards");
await mkdir(guardDirectory, { recursive: true });
const cliPath = resolve("scripts/local-chain.ts");
for (const [args, expected] of [
  [["fresh", "--name", "guard", "--backup", "missing.json"], /Invalid option/],
  [["fresh", "--name", "guard", "--output", "unused.json"], /Invalid option/],
  [["restore", "--name", "guard"], /Restore requires/],
  [
    ["restore", "--name", "guard", "--backup", "missing.json"],
    /Missing or unreadable/,
  ],
  [["fresh", "--name", "../escape"], /unique alphanumeric/],
] as const) {
  // Even a broken guard cannot start a node: no binary is available in this
  // subprocess's isolated workspace. Positive restart tests use actual Anvil.
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", cliPath, ...args],
    {
      cwd: guardDirectory,
      env: {
        ...process.env,
        ANVIL_BINARY: resolve(guardDirectory, "not-an-anvil-binary.exe"),
      },
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, expected);
}
let run = await startChain(`${id}-fresh`, port);
let connection: Awaited<ReturnType<typeof network.create>> | undefined;
let database: Awaited<ReturnType<typeof testDatabase>> | undefined;
try {
  connection = await network.create({
    network: "localhost",
    override: { url: run.session.rpcUrl },
  });
  const d = await connection.ignition.deploy(phase2D, { deploymentId: id });
  const client = await connection.viem.getPublicClient();
  const [owner, customer, worker] = await connection.viem.getWalletClients();
  const manifest = await verifyDeployment(
    connection.viem,
    {
      MockUSD: d.token.address,
      TrustEscrow: d.escrow.address,
      JurorRegistry: d.registry.address,
      DisputeArbitration: d.arbitration.address,
      ProtocolTreasury: d.treasury.address,
    },
    await readCompiledContracts(process.cwd()),
    {
      deploymentId: id,
      rpcUrl: run.session.rpcUrl,
      ephemeral: true,
      fresh: true,
    },
  );
  manifest.chainIdentity = run.session.identity;
  database = await testDatabase();
  const service = new BackendService(
    database.db,
    "http://127.0.0.1:3000",
    chainAuthority(async () => {
      const client = createPublicClient({
        transport: http(run.session.rpcUrl, { retryCount: 0 }),
      });
      await assertDeploymentOnChain(client, manifest);
      return { manifest, client };
    }),
  );
  const files = new FileService(service, testStorage().storage);
  const address = customer.account.address.toLowerCase();
  const challenge = await service.nonce(address);
  const login = await service.verify(
    challenge.message,
    await customer.signMessage({ message: challenge.message }),
    challenge.challenge,
  );
  await service.updateProfile(address, {
    displayName: "Restart client",
    biography: "Isolated test",
  });
  const scope = {
    chainId: "31337" as const,
    escrowAddress: d.escrow.address.toLowerCase(),
    deploymentHash: manifest.verifiedBlock.hash.toLowerCase(),
  };
  await assert.rejects(startChain(`${id}-occupied`, port), /EADDRINUSE/);
  const hash = await d.token.write.transfer([
    customer.account.address,
    100_000_000n,
  ]);
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  const projectHash = await d.escrow.write.createProject(
    [
      worker.account.address,
      [50_000_000n],
      [(await client.getBlock()).timestamp + 10n * 86400n],
      toHex("persistent project", { size: 32 }),
    ],
    { account: customer.account },
  );
  await client.waitForTransactionReceipt({ hash: projectHash });
  await d.token.write.approve([d.escrow.address, 50_000_000n], {
    account: customer.account,
  });
  const funded = await d.escrow.write.fundProject([0n], {
    account: customer.account,
  });
  await client.waitForTransactionReceipt({ hash: funded });
  await client.waitForTransactionReceipt({
    hash: await d.escrow.write.acceptProject([0n], { account: worker.account }),
  });
  await service.saveProject(address, scope, "0", {
    title: "Survives restart",
    description: "Private scope",
    milestones: [{ index: 0, name: "Delivery", description: "Exact bytes" }],
  });
  const bytes = new TextEncoder().encode("Private persisted attachment");
  const file = await files.upload(
    worker.account.address.toLowerCase(),
    { ...scope, projectId: "0", milestoneIndex: 0 },
    "deliverable",
    randomUUID(),
    "restart.txt",
    "text/plain",
    bytes,
    sha256(bytes),
  );
  const submitted = await d.escrow.write.submitMilestone(
    [0n, 0n, sha256(bytes) as Hex],
    { account: worker.account },
  );
  await client.waitForTransactionReceipt({ hash: submitted });
  await files.associate(
    worker.account.address.toLowerCase(),
    scope,
    file.id,
    submitted,
  );
  // Preserve nonempty arbitration/staking storage as well as escrow storage.
  const jurors = (await connection.viem.getWalletClients()).slice(3, 6);
  async function confirmed(hash: Hex) {
    assert.equal(
      (await client.waitForTransactionReceipt({ hash })).status,
      "success",
    );
  }
  for (const juror of jurors) {
    await confirmed(
      await d.token.write.transfer([juror.account.address, 100_000_000n]),
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
  await confirmed(
    await d.escrow.write.createProject(
      [
        worker.account.address,
        [10_000_000n],
        [(await client.getBlock()).timestamp + 10n * 86400n],
        toHex("Persistent dispute", { size: 32 }),
      ],
      { account: customer.account },
    ),
  );
  await confirmed(
    await d.token.write.approve([d.escrow.address, 10_000_000n], {
      account: customer.account,
    }),
  );
  await confirmed(
    await d.escrow.write.fundProject([1n], { account: customer.account }),
  );
  await confirmed(
    await d.escrow.write.acceptProject([1n], { account: worker.account }),
  );
  await confirmed(
    await d.escrow.write.submitMilestone([1n, 0n, sha256(bytes) as Hex], {
      account: worker.account,
    }),
  );
  await confirmed(
    await d.token.write.approve([d.arbitration.address, 15_000_000n], {
      account: customer.account,
    }),
  );
  await confirmed(
    await d.arbitration.write.openDispute([1n, 0n, sha256(bytes) as Hex], {
      account: customer.account,
    }),
  );
  const before = {
    native: await client.getBalance({ address: owner.account.address }),
    nonce: await client.getTransactionCount({
      address: customer.account.address,
    }),
    token: await d.token.read.balanceOf([customer.account.address]),
    liability: await d.escrow.read.totalEscrowLiability(),
    project: await d.escrow.read.projects([0n]),
    milestone: await d.escrow.read.milestones([0n, 0n]),
    dispute: await d.arbitration.read.getDispute([0n]),
    stake: await d.registry.read.totalStaked(),
    locked: await d.registry.read.totalLockedStake(),
    feesHeld: await d.arbitration.read.totalDisputeFeesHeld(),
    tokenAtAnchor: await client.getCode({
      address: d.token.address,
      blockNumber: BigInt(manifest.verifiedBlock.number),
    }),
    tokenAtGenesis: await client.getCode({
      address: d.token.address,
      blockNumber: 0n,
    }),
    historicalBalance: await d.token.read.balanceOf(
      [customer.account.address],
      { blockNumber: receipt.blockNumber },
    ),
    block: await client.getBlock({ blockTag: "latest" }),
    logs: await client.getContractEvents({
      address: d.escrow.address,
      abi: d.escrow.abi,
      fromBlock: 0n,
    }),
  };
  const ownerNonce = await client.getTransactionCount({
    address: owner.account.address,
  });
  const queued = await owner.sendTransaction({
    to: owner.account.address,
    value: 0n,
    nonce: ownerNonce + 1,
  });
  try {
    const pool = (await client.request({
      method: "txpool_status",
    } as never)) as { queued: Hex };
    assert.ok(
      BigInt(pool.queued) > 0n,
      "Actual nonce-gapped transaction must be queued",
    );
    await assert.rejects(
      backupChain(
        run.session,
        resolve(directory, "must-not-back-up-mempool.json"),
      ),
      /Pending or queued/,
    );
  } finally {
    // Confirm the owned zero-value transactions explicitly; never drop or
    // replace an uncertain development user's transaction automatically.
    await confirmed(
      await owner.sendTransaction({
        to: owner.account.address,
        value: 0n,
        nonce: ownerNonce,
      }),
    );
    await confirmed(queued);
  }
  before.native = await client.getBalance({ address: owner.account.address });
  before.block = await client.getBlock({ blockTag: "latest" });
  await backupChain(run.session, path, manifest);
  await assert.rejects(backupChain(run.session, path), /EEXIST/);
  await assert.rejects(
    readBackup(resolve(directory, "missing.json")),
    /Missing/,
  );
  const broken = JSON.parse(await readFile(path, "utf8"));
  broken.state += "00";
  await writeFile(resolve(directory, "corrupt.json"), JSON.stringify(broken));
  await assert.rejects(
    readBackup(resolve(directory, "corrupt.json")),
    /Corrupted/,
  );
  const alteredHead = JSON.parse(await readFile(path, "utf8"));
  alteredHead.head.hash = `0x${"f".repeat(64)}`;
  await writeFile(resolve(directory, "head.json"), JSON.stringify(alteredHead));
  await assert.rejects(
    readBackup(resolve(directory, "head.json")),
    /Corrupted/,
  );
  const wrong = JSON.parse(await readFile(path, "utf8"));
  wrong.session.version = "incompatible";
  await writeFile(resolve(directory, "version.json"), JSON.stringify(wrong));
  await assert.rejects(
    readBackup(resolve(directory, "version.json")),
    /Incompatible/,
  );
  await stopNode(run.child);
  await connection.close();
  connection = undefined;
  run = await startChain(`${id}-restored`, port, await readBackup(path));
  connection = await network.create({
    network: "localhost",
    override: { url: run.session.rpcUrl },
  });
  const restored = await connection.viem.getPublicClient();
  const r = await getProtocolContracts(connection.viem, {
    MockUSD: d.token.address,
    TrustEscrow: d.escrow.address,
    JurorRegistry: d.registry.address,
    DisputeArbitration: d.arbitration.address,
    ProtocolTreasury: d.treasury.address,
  });
  await assertDeploymentOnChain(restored, manifest);
  await checkSession(run.session);
  assert.equal(
    await restored.getBalance({ address: owner.account.address }),
    before.native,
  );
  assert.equal(
    await restored.getTransactionCount({ address: customer.account.address }),
    before.nonce,
  );
  assert.equal(
    await r.token.read.balanceOf([customer.account.address]),
    before.token,
  );
  assert.equal(await r.escrow.read.totalEscrowLiability(), before.liability);
  assert.deepEqual(await r.escrow.read.projects([0n]), before.project);
  assert.equal(
    (await restored.getBlock({ blockTag: "latest" })).hash,
    before.block.hash,
  );
  assert.equal(
    (await restored.getTransactionReceipt({ hash })).blockHash,
    receipt.blockHash,
  );
  assert.equal(
    (await restored.getTransaction({ hash: projectHash })).hash,
    projectHash,
  );
  assert.equal(
    (await restored.getTransactionReceipt({ hash: queued })).status,
    "success",
  );
  assert.deepEqual(
    await restored.getContractEvents({
      address: d.escrow.address,
      abi: d.escrow.abi,
      fromBlock: 0n,
    }),
    before.logs,
  );
  assert.deepEqual(await r.escrow.read.milestones([0n, 0n]), before.milestone);
  assert.deepEqual(await r.arbitration.read.getDispute([0n]), before.dispute);
  assert.equal(await r.registry.read.totalStaked(), before.stake);
  assert.equal(await r.registry.read.totalLockedStake(), before.locked);
  assert.equal(
    await r.arbitration.read.totalDisputeFeesHeld(),
    before.feesHeld,
  );
  assert.equal(before.stake, 300_000_000n);
  assert.equal(
    await restored.getCode({
      address: d.token.address,
      blockNumber: BigInt(manifest.verifiedBlock.number),
    }),
    before.tokenAtAnchor,
  );
  assert.equal(
    await restored.getCode({ address: d.token.address, blockNumber: 0n }),
    before.tokenAtGenesis,
  );
  assert.equal(
    await r.token.read.balanceOf([customer.account.address], {
      blockNumber: receipt.blockNumber,
    }),
    before.historicalBalance,
  );
  assert.equal(before.locked, 300_000_000n);
  assert.equal(before.feesHeld, 15_000_000n);
  assert.equal((await service.session(login.token))?.address, address);
  assert.equal((await service.profile(address)).display_name, "Restart client");
  assert.equal(
    (await service.project(address, scope, "0")).title,
    "Survives restart",
  );
  assert.deepEqual(
    (await files.download(address, scope, file.id)).bytes,
    bytes,
  );
  const accepted = await r.escrow.write.approveMilestone([0n, 0n], {
    account: customer.account,
  });
  assert.equal(
    (await restored.waitForTransactionReceipt({ hash: accepted })).status,
    "success",
  );
  assert.equal((await r.escrow.read.projects([0n]))[9], 3);
  assert.equal(
    await r.token.read.balanceOf([worker.account.address]),
    49_500_000n,
  );
  assert.equal(await r.treasury.read.availableRevenue(), 500_000n);
  // A second real fresh process has the same chain ID, but cannot pass either identity anchor.
  const oldSession = run.session;
  await stopNode(run.child);
  await connection.close();
  connection = undefined;
  run = await startChain(`${id}-different`, port);
  assert.notEqual(run.session.identity.hash, oldSession.identity.hash);
  await assert.rejects(
    checkSession({ ...oldSession, rpcUrl: run.session.rpcUrl }),
    /identity anchor mismatch/,
  );
  await assert.rejects(assertDeploymentOnChain(run.client, manifest));
  await assert.rejects(service.project(address, scope, "0"));
  await assert.rejects(files.download(address, scope, file.id));
  assert.equal(
    (
      await database.db.query(
        "SELECT count(*)::integer AS n FROM trustlayer.projects",
      )
    ).rows[0].n,
    1,
  );
  console.log(
    "Persistence PASS: actual Anvil process restart; bytecode, project/milestone storage, ETH/mUSD, nonces, blocks, transactions, receipts and event history restored. SIWE/profile/SQL metadata and private attachment remain accessible, then a real post-restart approval pays the exact 1% fee. Missing/corrupt/version-mismatched backups, occupied ports and overwrite rejected; a fresh chain fails identity/metadata/file access without deleting historical SQL.",
  );
  await writeFile(
    resolve(directory, "result.json"),
    JSON.stringify(
      {
        passed: true,
        version: run.session.version,
        checks: [
          "code/storage/balances/nonces",
          "blocks/transactions/receipts/events",
          "SIWE/profile/metadata/private-file",
          "post-restore settlement/fee",
          "corrupt/missing/incompatible/overwrite/occupied-port",
          "fresh-chain denial with retained SQL",
        ],
        oldIdentity: oldSession.identity,
        freshIdentity: run.session.identity,
        artifacts: directory,
      },
      null,
      2,
    ),
  );
} finally {
  if (connection) await connection.close();
  if (database) await database.pg.close();
  await stopNode(run.child);
}
