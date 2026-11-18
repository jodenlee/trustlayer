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
import { assertDeploymentOnChain, getContracts } from "@trustlayer/contracts";
import { localChain } from "../src/lib/blockchain/config.js";
import {
  createEscrowProject,
  executeEscrowAction,
} from "../src/lib/blockchain/escrow-actions.js";
import { createdProjectFromReceipt } from "../src/lib/blockchain/projects.js";
import {
  executeJurorAction,
  openMilestoneDispute,
  executeCaseAction,
} from "../src/lib/blockchain/arbitration-actions.js";
import {
  openedDisputeFromReceipt,
  readCase,
  readCasePage,
} from "../src/lib/blockchain/arbitration.js";
import {
  findDeploymentBlock,
  readHistoryPage,
} from "../src/lib/blockchain/history.js";
import { createTransactionController } from "../src/lib/blockchain/transactions.js";
import type { ProtocolWriteContext } from "../src/lib/blockchain/hooks/use-protocol-transaction.js";

// This owned in-process EVM never resets or modifies the user's localhost chain/export.
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
      deploymentId: "phase3d-integration",
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
  const [holder, customer, freelancer, ...rest] = accounts;
  const jury = rest.slice(0, 3);
  const observer = rest[3];
  const unit = 1_000_000n;
  const evidence = `0x${"a".repeat(64)}` as const;
  let confirmed = 0;
  let refreshes = 0;
  function contextFor(actor: Address): ProtocolWriteContext {
    const wallet = createWalletClient({
      chain: localChain,
      account: actor,
      transport: custom(connection.provider as EIP1193Provider),
    });
    return {
      wallet: wallet as unknown as ProtocolWriteContext["wallet"],
      account: actor,
      contracts,
      manifest,
      assertCurrent: async () => {
        assert.equal(await wallet.getChainId(), 31337);
      },
    };
  }
  async function transact(
    actor: Address,
    submit: (context: ProtocolWriteContext) => Promise<Hash>,
  ) {
    const controller = createTransactionController({
      validate: async () => {
        await assertDeploymentOnChain(client, manifest);
        return contextFor(actor);
      },
      isCurrent: () => true,
      publish: () => {},
      wait: async (hash) => client.waitForTransactionReceipt({ hash }),
      refresh: async () => {
        refreshes++;
      },
    });
    const result = await controller.execute(submit);
    assert.ok(result, "Frontend transaction did not confirm");
    confirmed++;
    return client.getTransactionReceipt({ hash: result.transactionHash });
  }
  async function advance(timestamp: bigint) {
    assert.ok(timestamp > (await client.getBlock()).timestamp);
    await connection.provider.request({
      method: "evm_setNextBlockTimestamp",
      params: [Number(timestamp)],
    });
    await connection.provider.request({ method: "evm_mine" });
  }
  for (const [recipient, amount] of [
    [customer, 3000n],
    [freelancer, 100n],
    ...jury.map((a) => [a, 500n] as const),
  ] as const) {
    const hash = await deployed.token.write.transfer([
      recipient,
      amount * unit,
    ]);
    assert.equal(
      (await client.waitForTransactionReceipt({ hash })).status,
      "success",
    );
  }
  for (const juror of jury) {
    await transact(juror, (c) => executeJurorAction(c, "register", 0n, client));
    await transact(juror, (c) =>
      executeJurorAction(c, "approveStake", 300n * unit, client),
    );
    assert.equal(
      (await deployed.registry.read.getJurorInfo([juror])).depositedStake,
      0n,
    );
    await transact(juror, (c) =>
      executeJurorAction(c, "deposit", 300n * unit, client),
    );
  }
  const caseIds: bigint[] = [];
  const projectIds: bigint[] = [];
  const scenarios = [
    {
      label: "Freelancer wins",
      votes: [1, 1, 2],
      ruling: 1,
      bps: 10000,
      fallback: false,
    },
    {
      label: "Client wins",
      votes: [2, 2, 1],
      ruling: 2,
      bps: 0,
      fallback: false,
    },
    {
      label: "Split majority",
      votes: [3, 3, 2],
      ruling: 3,
      bps: 5000,
      fallback: false,
    },
    {
      label: "Zero-vote fallback",
      votes: [],
      ruling: 3,
      bps: 5000,
      fallback: true,
    },
  ];
  for (const [i, scenario] of scenarios.entries()) {
    const now = (await client.getBlock()).timestamp;
    const draft = {
      title: scenario.label,
      description: "Public integration scope",
      freelancer,
      milestones: [
        {
          title: "Milestone",
          amount: "400",
          due: new Date(Number(now + 15n * 86400n) * 1000)
            .toISOString()
            .slice(0, 10),
        },
      ],
    };
    const created = await transact(customer, (c) =>
      createEscrowProject(c, draft, client),
    );
    const projectId = await createdProjectFromReceipt(
      created.logs,
      addresses.TrustEscrow,
      customer,
    );
    projectIds.push(projectId);
    await transact(customer, (c) =>
      executeEscrowAction(c, "approveToken", projectId, undefined, client),
    );
    await transact(customer, (c) =>
      executeEscrowAction(c, "fund", projectId, undefined, client),
    );
    await transact(freelancer, (c) =>
      executeEscrowAction(c, "accept", projectId, undefined, client),
    );
    await transact(freelancer, (c) =>
      executeEscrowAction(c, "submit", projectId, evidence, client, 0),
    );
    const opener = i % 2 === 0 ? customer : freelancer;
    const responder = opener === customer ? freelancer : customer;
    const beforeFee = await deployed.token.read.balanceOf([opener]);
    await transact(opener, (c) =>
      openMilestoneDispute(c, projectId, 0, evidence, true, client),
    );
    assert.equal(
      (await deployed.arbitration.read.getMilestoneDispute([projectId, 0n]))[0],
      false,
    );
    const opened = await transact(opener, (c) =>
      openMilestoneDispute(c, projectId, 0, evidence, false, client),
    );
    const id = openedDisputeFromReceipt(
      opened.logs,
      addresses.DisputeArbitration,
      projectId,
      0,
      opener,
    );
    caseIds.push(id);
    assert.equal(
      await deployed.token.read.balanceOf([opener]),
      beforeFee - 15n * unit,
    );
    const initial = await readCase(client, contracts, id, jury[0]);
    assert.equal(initial.milestoneState, 2);
    assert.equal(initial.assignment.state, 1);
    assert.equal(
      new Set(initial.dispute.jurors.map((a) => a.toLowerCase())).size,
      3,
    );
    assert.ok(
      initial.dispute.jurors.every(
        (a) =>
          a.toLowerCase() !== customer.toLowerCase() &&
          a.toLowerCase() !== freelancer.toLowerCase(),
      ),
    );
    await assert.rejects(
      openMilestoneDispute(
        contextFor(opener),
        projectId,
        0,
        evidence,
        false,
        client,
      ),
      /does not permit opening/,
    );
    await assert.rejects(
      executeEscrowAction(
        contextFor(customer),
        "approve",
        projectId,
        undefined,
        client,
      ),
      /does not permit/,
    );
    await transact(responder, (c) =>
      executeCaseAction(c, "respond", id, evidence, client),
    );
    await assert.rejects(
      executeCaseAction(contextFor(responder), "respond", id, evidence, client),
      /does not permit/,
    );
    if (i === 0) {
      await assert.rejects(
        executeJurorAction(
          contextFor(jury[0]),
          "withdraw",
          201n * unit,
          client,
        ),
        /unlocked stake/,
      );
      await transact(jury[0], (c) =>
        executeJurorAction(c, "withdraw", 200n * unit, client),
      );
      assert.equal(
        (await deployed.registry.read.getJurorInfo([jury[0]])).lockedStake,
        100n * unit,
      );
    }
    await advance(initial.dispute.responseDeadline - 1n);
    await assert.rejects(
      executeCaseAction(contextFor(jury[0]), "vote", id, 1, client),
      /does not permit/,
    );
    await advance(initial.dispute.responseDeadline);
    await assert.rejects(
      executeCaseAction(contextFor(observer), "vote", id, 1, client),
      /does not permit/,
    );
    for (const [j, vote] of scenario.votes.entries()) {
      await transact(jury[j], (c) =>
        executeCaseAction(c, "vote", id, vote, client),
      );
      await assert.rejects(
        executeCaseAction(contextFor(jury[j]), "vote", id, vote, client),
        /does not permit/,
      );
    }
    await advance(initial.dispute.votingDeadline);
    await assert.rejects(
      executeCaseAction(
        contextFor(observer),
        "finalize",
        id,
        undefined,
        client,
      ),
      /does not permit/,
    );
    await advance(initial.dispute.votingDeadline + 1n);
    await transact(observer, (c) =>
      executeCaseAction(c, "finalize", id, undefined, client),
    );
    const settled = await readCase(client, contracts, id, jury[0]);
    assert.equal(settled.dispute.ruling, scenario.ruling);
    assert.equal(settled.dispute.freelancerBps, scenario.bps);
    assert.equal(settled.dispute.fallbackApplied, scenario.fallback);
    assert.equal(settled.milestoneState, 3);
    assert.equal(settled.assignment.state, 2);
    assert.equal(settled.claimable, 4n * unit);
    assert.equal(
      (await deployed.registry.read.getJurorInfo([jury[0]])).lockedStake,
      0n,
    );
    await assert.rejects(
      executeCaseAction(
        contextFor(observer),
        "finalize",
        id,
        undefined,
        client,
      ),
      /does not permit/,
    );
  }
  const discovery = await readCasePage(client, contracts, jury[0], null);
  assert.equal(discovery.cases.length, 4);
  assert.equal(
    discovery.cases.reduce((n, c) => n + c.claimable, 0n),
    16n * unit,
  );
  assert.equal(
    await deployed.arbitration.read.reservedJurorRewards(),
    48n * unit,
  );
  for (const id of caseIds)
    for (const juror of jury) {
      const before = await deployed.token.read.balanceOf([juror]);
      await transact(juror, (c) =>
        executeCaseAction(c, "claim", id, undefined, client),
      );
      assert.equal(
        await deployed.token.read.balanceOf([juror]),
        before + 4n * unit,
      );
      await assert.rejects(
        executeCaseAction(contextFor(juror), "claim", id, undefined, client),
        /does not permit/,
      );
    }
  const due = new Date(
    Number((await client.getBlock()).timestamp + 15n * 86400n) * 1000,
  )
    .toISOString()
    .slice(0, 10);
  const untouched = await transact(customer, (c) =>
    createEscrowProject(
      c,
      {
        title: "Independent escrow",
        description: "Must remain untouched by arbitration",
        freelancer,
        milestones: [{ title: "Pending", amount: "500", due }],
      },
      client,
    ),
  );
  const untouchedId = await createdProjectFromReceipt(
    untouched.logs,
    addresses.TrustEscrow,
    customer,
  );
  await transact(customer, (c) =>
    executeEscrowAction(c, "approveToken", untouchedId, undefined, client),
  );
  await transact(customer, (c) =>
    executeEscrowAction(c, "fund", untouchedId, undefined, client),
  );
  assert.equal(await deployed.escrow.read.totalEscrowLiability(), 500n * unit);
  assert.equal(
    await deployed.token.read.balanceOf([addresses.TrustEscrow]),
    500n * unit,
  );
  assert.equal(await deployed.registry.read.totalStaked(), 700n * unit);
  assert.equal(await deployed.registry.read.totalLockedStake(), 0n);
  assert.equal(await deployed.arbitration.read.reservedJurorRewards(), 0n);
  assert.equal(
    await deployed.arbitration.read.totalJurorRewardsClaimed(),
    48n * unit,
  );
  assert.equal(
    await deployed.treasury.read.totalServiceFeesReceived(),
    8n * unit,
  );
  assert.equal(
    await deployed.treasury.read.totalDisputeFeesReceived(),
    12n * unit,
  );
  assert.equal(await deployed.token.read.balanceOf([freelancer]), 862n * unit);
  const custody = [
    ...new Set([
      holder,
      customer,
      freelancer,
      ...jury,
      observer,
      ...Object.values(addresses),
    ]),
  ];
  const sum = (
    await Promise.all(custody.map((a) => deployed.token.read.balanceOf([a])))
  ).reduce((a, b) => a + b, 0n);
  assert.equal(sum, await deployed.token.read.totalSupply());
  const start = await findDeploymentBlock(
    client,
    addresses.MockUSD,
    BigInt(manifest.verifiedBlock.number),
  );
  const history = await readHistoryPage(
    client,
    contracts,
    jury[0],
    projectIds,
    start,
    undefined,
    caseIds,
  );
  assert.equal(
    history.entries.filter(
      (e) =>
        e.kind === "Juror reward claimed" && e.activity === "Wallet activity",
    ).length,
    4,
  );
  assert.equal(
    history.entries.filter((e) => e.kind === "Milestone settled").length,
    4,
  );
  assert.equal(refreshes, confirmed);
  console.log(
    `PASS: Phase 3D real local-EVM integration; ${confirmed} confirmed frontend actions, four verdicts including fallback, opener fees, frozen escrow, public votes, strict deadlines, 12 claims / 48 mUSD rewards, 8 mUSD service + 12 mUSD dispute treasury fees, 700 mUSD collateral and 500 mUSD independent escrow. Full supply conservation and bounded history verified.`,
  );
} finally {
  await connection.close();
}
