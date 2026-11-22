import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import "../../../hardhat.config.js";
import type {} from "../../../artifacts/contracts/MockUSD.sol/artifacts.js";
import type {} from "../../../artifacts/contracts/TrustEscrow.sol/artifacts.js";
import type {} from "../../../artifacts/contracts/JurorRegistry.sol/artifacts.js";
import type {} from "../../../artifacts/contracts/DisputeArbitration.sol/artifacts.js";
import type {} from "../../../artifacts/contracts/ProtocolTreasury.sol/artifacts.js";
import {
  createPublicClient,
  createWalletClient,
  custom,
  type Address,
  type EIP1193Provider,
  type Hash,
} from "viem";
import phase2D from "../../../ignition/modules/Phase2D.js";
import { readCompiledContracts } from "../../../scripts/lib/artifacts.js";
import {
  verifyDeployment,
  type ProtocolAddresses,
} from "../../../scripts/lib/deployment.js";
import { getContracts, assertDeploymentOnChain } from "@trustlayer/contracts";
import { localChain } from "../src/lib/blockchain/config.js";
import {
  createEscrowProject,
  executeEscrowAction,
} from "../src/lib/blockchain/escrow-actions.js";
import {
  createdProjectFromReceipt,
  normalAllocation,
  projectRole,
  readProject,
  readProjectPage,
  validateProjectDraft,
} from "../src/lib/blockchain/projects.js";
import {
  findDeploymentBlock,
  readHistoryPage,
} from "../src/lib/blockchain/history.js";
import { createTransactionController } from "../src/lib/blockchain/transactions.js";
import type { ProtocolWriteContext } from "../src/lib/blockchain/hooks/use-protocol-transaction.js";

// Real local EVM + production Ignition module. No HTTP node, external wallet,
// private key export, tracked deployment rewrite or public network is involved.
const connection = await network.create();
try {
  const deployed = await connection.ignition.deploy(phase2D);
  const addresses: ProtocolAddresses = {
    MockUSD: deployed.token.address,
    TrustEscrow: deployed.escrow.address,
    JurorRegistry: deployed.registry.address,
    DisputeArbitration: deployed.arbitration.address,
    ProtocolTreasury: deployed.treasury.address,
  };
  const manifest = await verifyDeployment(
    connection.viem,
    addresses,
    await readCompiledContracts(
      fileURLToPath(new URL("../../../", import.meta.url)),
    ),
    {
      deploymentId: "phase3c-integration",
      rpcUrl: "http://127.0.0.1:8545",
      ephemeral: false,
      fresh: true,
    },
  );
  const client = createPublicClient({
    chain: localChain,
    transport: custom(connection.provider as EIP1193Provider),
  });
  const contracts = getContracts(manifest, await client.getChainId());
  const accounts = (await connection.provider.request({
    method: "eth_accounts",
  })) as Address[];
  const [holder, customer, worker, otherWorker] = accounts;
  const unit = 1_000_000n;
  assert.equal(await deployed.token.read.balanceOf([customer]), 0n);
  let confirmations = 0;
  let refreshed = 0;
  async function transact(
    actor: Address,
    submit: (context: ProtocolWriteContext) => Promise<Hash>,
  ) {
    const wallet = createWalletClient({
      chain: localChain,
      account: actor,
      transport: custom(connection.provider as EIP1193Provider),
    });
    const context: ProtocolWriteContext = {
      wallet: wallet as unknown as ProtocolWriteContext["wallet"],
      contracts,
      manifest,
      account: actor,
      assertCurrent: async () => {
        assert.equal(await wallet.getChainId(), 31337);
      },
    };
    const controller = createTransactionController({
      validate: async () => {
        await assertDeploymentOnChain(client, manifest);
        return context;
      },
      isCurrent: () => true,
      publish: () => {},
      wait: async (hash) => {
        const receipt = await client.waitForTransactionReceipt({ hash });
        assert.equal(receipt.status, "success");
        return receipt;
      },
      refresh: async () => {
        refreshed++;
      },
    });
    const result = await controller.execute(submit);
    assert.ok(result, "The shared transaction controller did not confirm");
    confirmations++;
    return client.getTransactionReceipt({ hash: result.transactionHash });
  }
  const now = (await client.getBlock()).timestamp;
  const due = (days: number) =>
    new Date(Number(now + BigInt(days) * 86400n) * 1000)
      .toISOString()
      .slice(0, 10);
  const draft = {
    title: "Local integration agreement",
    description: "Public test scope; session-only metadata",
    freelancer: worker,
    milestones: [
      { title: "First delivery", amount: "400", due: due(15) },
      { title: "Second delivery", amount: "600", due: due(22) },
    ],
  };
  const created = await transact(customer, (context) =>
    createEscrowProject(context, draft, client),
  );
  const id = await createdProjectFromReceipt(
    created.logs,
    addresses.TrustEscrow,
    customer,
  );
  assert.equal(id, 0n);
  assert.equal(
    await deployed.token.read.balanceOf([customer]),
    0n,
    "Creation must not require or transfer mUSD",
  );
  assert.equal((await readProject(client, contracts, id)).escrowRemaining, 0n);
  const provision = await deployed.token.write.transfer([
    customer,
    2000n * unit,
  ]);
  assert.equal(
    (await client.waitForTransactionReceipt({ hash: provision })).status,
    "success",
  );
  assert.equal(
    (await readProject(client, contracts, id)).metadataHash,
    validateProjectDraft(draft, now, customer).metadataHash,
  );
  const customerProjects = await readProjectPage(
    client,
    contracts,
    customer,
    null,
  );
  const workerProjects = await readProjectPage(client, contracts, worker, null);
  assert.deepEqual(
    customerProjects.projects.map((p) => p.id),
    [0n],
  );
  assert.deepEqual(
    workerProjects.projects.map((p) => p.id),
    [0n],
  );
  assert.equal(projectRole(customerProjects.projects[0], customer), "Client");
  assert.equal(projectRole(workerProjects.projects[0], worker), "Freelancer");
  const customerContext = {
    contracts,
    account: customer,
  } as ProtocolWriteContext;
  await assert.rejects(
    executeEscrowAction(customerContext, "fund", id, undefined, client),
    /Approve the required/,
  );
  await transact(customer, (context) =>
    executeEscrowAction(context, "approveToken", id, undefined, client),
  );
  assert.equal(
    await client.readContract({
      ...contracts.MockUSD,
      functionName: "allowance",
      args: [customer, addresses.TrustEscrow],
    }),
    1000n * unit,
  );
  assert.equal(
    (await readProject(client, contracts, id)).state,
    0,
    "Approval must not fund escrow",
  );
  await transact(customer, (context) =>
    executeEscrowAction(context, "fund", id, undefined, client),
  );
  assert.equal(
    (await readProject(client, contracts, id)).escrowRemaining,
    1000n * unit,
  );
  const another = {
    ...draft,
    freelancer: otherWorker,
    milestones: [{ title: "Independent funds", amount: "500", due: due(25) }],
  };
  const secondReceipt = await transact(customer, (context) =>
    createEscrowProject(context, another, client),
  );
  const second = await createdProjectFromReceipt(
    secondReceipt.logs,
    addresses.TrustEscrow,
    customer,
  );
  assert.equal(second, 1n);
  await transact(customer, (context) =>
    executeEscrowAction(context, "approveToken", second, undefined, client),
  );
  await transact(customer, (context) =>
    executeEscrowAction(context, "fund", second, undefined, client),
  );
  await transact(worker, (context) =>
    executeEscrowAction(context, "accept", id, undefined, client),
  );
  const evidence = `0x${"11".repeat(32)}`;
  await transact(worker, (context) =>
    executeEscrowAction(context, "submit", id, evidence, client),
  );
  const submitted = await readProject(client, contracts, id);
  assert.equal(
    submitted.milestones[0].reviewEnd - submitted.milestones[0].submittedAt,
    72n * 3600n,
  );
  await transact(customer, (context) =>
    executeEscrowAction(context, "approve", id, undefined, client),
  );
  assert.equal(
    await client.readContract({
      ...contracts.MockUSD,
      functionName: "balanceOf",
      args: [worker],
    }),
    396n * unit,
  );
  assert.equal(
    await client.readContract({
      ...contracts.ProtocolTreasury,
      functionName: "totalServiceFeesReceived",
    }),
    4n * unit,
  );
  assert.equal(
    (await readProject(client, contracts, id)).escrowRemaining,
    600n * unit,
  );
  await transact(worker, (context) =>
    executeEscrowAction(context, "submit", id, evidence, client),
  );
  const reviewEnd = (await readProject(client, contracts, id)).milestones[1]
    .reviewEnd;
  await connection.provider.request({
    method: "evm_setNextBlockTimestamp",
    params: [Number(reviewEnd)],
  });
  await connection.provider.request({ method: "evm_mine" });
  await assert.rejects(
    executeEscrowAction(
      { contracts, account: worker } as ProtocolWriteContext,
      "release",
      id,
      undefined,
      client,
    ),
    /does not permit/,
  );
  await connection.provider.request({
    method: "evm_setNextBlockTimestamp",
    params: [Number(reviewEnd + 1n)],
  });
  await connection.provider.request({ method: "evm_mine" });
  await transact(worker, (context) =>
    executeEscrowAction(context, "release", id, undefined, client),
  );
  assert.equal((await readProject(client, contracts, id)).state, 3);
  assert.equal(
    (await readProject(client, contracts, second)).escrowRemaining,
    500n * unit,
  );
  const balance = (address: Address) =>
    client.readContract({
      ...contracts.MockUSD,
      functionName: "balanceOf",
      args: [address],
    });
  assert.equal(await balance(worker), 990n * unit);
  assert.equal(await balance(addresses.ProtocolTreasury), 10n * unit);
  assert.equal(await balance(addresses.TrustEscrow), 500n * unit);
  assert.equal(
    await client.readContract({
      ...contracts.TrustEscrow,
      functionName: "totalEscrowLiability",
    }),
    500n * unit,
  );
  assert.equal(await balance(customer), 500n * unit);
  assert.equal(
    (await balance(holder)) +
      (await balance(customer)) +
      (await balance(worker)) +
      (await balance(addresses.TrustEscrow)) +
      (await balance(addresses.ProtocolTreasury)),
    1_000_000n * unit,
  );
  const start = await findDeploymentBlock(
    client,
    addresses.TrustEscrow,
    BigInt(manifest.verifiedBlock.number),
  );
  const history = await readHistoryPage(
    client,
    contracts,
    customer,
    [id, second],
    start,
  );
  const paid = history.entries.filter((e) => e.kind === "Milestone settled");
  assert.equal(paid.length, 2);
  assert.equal(
    paid.reduce((n, e) => n + e.serviceFee!, 0n),
    10n * unit,
  );
  assert.equal(
    paid.reduce((n, e) => n + e.freelancerNet!, 0n),
    990n * unit,
  );
  assert.deepEqual(
    normalAllocation(400n * unit, 100).freelancerNet,
    396n * unit,
  );
  assert.equal(confirmations, refreshed);
  console.log(
    `PASS: Phase 3C real local-EVM integration; ${confirmations} confirmed frontend actions, 2 independent projects, client/freelancer roles, exact approval, funding, acceptance, submission, approval payout and strict timeout release. Freelancer 990 mUSD; treasury fees 10 mUSD; second-project escrow 500 mUSD. Full token conservation and bounded event history verified.`,
  );
} finally {
  await connection.close();
}
