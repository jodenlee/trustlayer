import { abis, type LocalDeployment } from "@trustlayer/contracts";
import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeEventTopics,
  encodeAbiParameters,
  getAbiItem,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import {
  accountA,
  accountB,
  blockFixture,
  code,
  fixtureManifest,
} from "./protocol";
import type { Page } from "@playwright/test";

const hex = (value: bigint | number) => `0x${value.toString(16)}`;
const hash = (value: bigint | number) =>
  `0x${value.toString(16).padStart(64, "0")}` as Hex;
interface FakeMilestone {
  amount: bigint;
  dueAt: bigint;
  submittedAt: bigint;
  reviewEnd: bigint;
  evidence: Hex;
  state: number;
}
interface FakeProject {
  client: Address;
  freelancer: Address;
  hash: Hex;
  total: bigint;
  remaining: bigint;
  acceptBy: bigint;
  current: number;
  state: number;
  milestones: FakeMilestone[];
}
/** Stateful browser fixture only; financial correctness is additionally checked on a real EVM. */
export function escrowRpc(
  options: {
    empty?: boolean;
    state?: number;
    balance?: bigint;
    allowance?: bigint;
    milestoneState?: number;
    ethBalance?: bigint;
  } = {},
) {
  const manifest: LocalDeployment = fixtureManifest();
  let now = 1_700_000_000n;
  let block = 20n;
  let nonce = 100n;
  const balances = new Map<string, bigint>([
    [accountA, options.balance ?? 1_000_000_000n],
    [accountB, 0n],
  ]);
  let allowance = options.allowance ?? 0n;
  let treasury = 0n;
  const receipts = new Map<Hex, unknown>();
  const transactions = new Map<Hex, Record<string, unknown>>();
  const logs: Record<string, unknown>[] = [];
  const writes: string[] = [];
  const projects: FakeProject[] = options.empty
    ? []
    : [
        {
          client: accountA,
          freelancer: accountB,
          hash: hash(11),
          total: 100_000_000n,
          remaining: (options.state ?? 0) > 0 ? 100_000_000n : 0n,
          acceptBy: now + 604800n,
          current: 0,
          state: options.state ?? 0,
          milestones: [
            {
              amount: 100_000_000n,
              dueAt: now + 1209600n,
              submittedAt: options.milestoneState === 1 ? now : 0n,
              reviewEnd: now + 259200n,
              evidence: hash(0),
              state: options.milestoneState ?? 0,
            },
          ],
        },
      ];
  let deferReceipts = false;
  let rejectNext = false;
  let revertNext = false;
  let rpcFailure: string | undefined;
  function emit(
    abi: Abi,
    name: string,
    args: Record<string, unknown>,
    address: Address,
    tx: Hex,
    txLogs: Record<string, unknown>[],
  ) {
    const event = getAbiItem({ abi, name });
    if (!event || event.type !== "event") throw new Error("Not an event");
    const parameters = event.inputs.filter((p) => !p.indexed);
    const log = {
      address,
      topics: encodeEventTopics({ abi, eventName: name, args }),
      data: encodeAbiParameters(
        parameters,
        parameters.map((p) => args[p.name!]),
      ),
      transactionHash: tx,
      blockHash: hash(block),
      blockNumber: hex(block),
      transactionIndex: "0x0",
      logIndex: hex(txLogs.length),
      removed: false,
    };
    txLogs.push(log);
    logs.push(log);
  }
  function call(
    to: string,
    data: Hex,
    send = false,
    actor: Address = accountA,
    tx = hash(nonce),
    txLogs: Record<string, unknown>[] = [],
  ): Hex {
    const entry = Object.entries(manifest.contracts).find(
      ([, c]) => c.address.toLowerCase() === to.toLowerCase(),
    );
    if (!entry) throw new Error("Unknown fixture address");
    const name = entry[0] as keyof typeof abis;
    const abi: Abi = abis[name];
    const decoded = decodeFunctionData({ abi, data });
    const args = decoded.args ?? [];
    const fn = decoded.functionName;
    let value: unknown = 0n;
    const p = projects[Number(args[0] ?? 0)];
    if (fn === "nextProjectId") value = BigInt(projects.length);
    else if (fn === "balanceOf")
      value = balances.get(String(args[0]).toLowerCase()) ?? 0n;
    else if (fn === "allowance") value = allowance;
    else if (fn === "decimals") value = 6;
    else if (fn === "symbol") value = "mUSD";
    else if (fn === "owner") value = accountA;
    else if (fn === "isConfigured") value = true;
    else if (fn === "availableRevenue" || fn === "totalServiceFeesReceived")
      value = treasury;
    else if (fn === "totalEscrowLiability")
      value = projects.reduce((n, project) => n + project.remaining, 0n);
    else if (fn === "projects")
      value = [
        p.client,
        p.freelancer,
        p.hash,
        p.total,
        p.remaining,
        p.acceptBy,
        100,
        p.current,
        p.milestones.length,
        p.state,
      ];
    else if (fn === "milestones") {
      const m = p.milestones[Number(args[1])];
      value = [
        m.amount,
        m.dueAt,
        m.submittedAt,
        m.reviewEnd,
        m.evidence,
        m.state,
      ];
    } else if (fn === "createProject") {
      value = BigInt(projects.length);
      if (send) {
        const amounts = args[1] as bigint[];
        const deadlines = args[2] as bigint[];
        projects.push({
          client: actor,
          freelancer: args[0] as Address,
          hash: args[3] as Hex,
          total: amounts.reduce((a, b) => a + b, 0n),
          remaining: 0n,
          acceptBy: now + 604800n,
          current: 0,
          state: 0,
          milestones: amounts.map((amount, i) => ({
            amount,
            dueAt: deadlines[i],
            submittedAt: 0n,
            reviewEnd: 0n,
            evidence: hash(0),
            state: 0,
          })),
        });
        emit(
          abi,
          "ProjectCreated",
          {
            projectId: value,
            client: actor,
            freelancer: args[0],
            metadataHash: args[3],
          },
          manifest.contracts.TrustEscrow.address,
          tx,
          txLogs,
        );
      }
    } else if (fn === "approve") {
      value = true;
      if (send) {
        allowance = args[1] as bigint;
        emit(
          abi,
          "Approval",
          { owner: actor, spender: args[0], value: allowance },
          manifest.contracts.MockUSD.address,
          tx,
          txLogs,
        );
      }
    } else if (send && fn === "fundProject") {
      p.state = 1;
      p.remaining = p.total;
      balances.set(
        actor.toLowerCase(),
        balances.get(actor.toLowerCase())! - p.total,
      );
      allowance -= p.total;
      emit(
        abi,
        "ProjectFunded",
        { projectId: args[0], amount: p.total },
        manifest.contracts.TrustEscrow.address,
        tx,
        txLogs,
      );
    } else if (send && fn === "acceptProject") {
      p.state = 2;
      emit(
        abi,
        "ProjectAccepted",
        { projectId: args[0], freelancer: actor },
        manifest.contracts.TrustEscrow.address,
        tx,
        txLogs,
      );
    } else if (send && fn === "submitMilestone") {
      const m = p.milestones[p.current];
      m.state = 1;
      m.submittedAt = now;
      m.reviewEnd = now + 259200n;
      m.evidence = args[2] as Hex;
      emit(
        abi,
        "MilestoneSubmitted",
        {
          projectId: args[0],
          index: args[1],
          evidenceHash: args[2],
          reviewEnd: m.reviewEnd,
        },
        manifest.contracts.TrustEscrow.address,
        tx,
        txLogs,
      );
    } else if (
      send &&
      (fn === "approveMilestone" || fn === "releaseAfterReviewTimeout")
    ) {
      const m = p.milestones[p.current];
      const fee = m.amount / 100n;
      const net = m.amount - fee;
      balances.set(
        p.freelancer.toLowerCase(),
        (balances.get(p.freelancer.toLowerCase()) ?? 0n) + net,
      );
      treasury += fee;
      p.remaining -= m.amount;
      m.state = 3;
      p.current++;
      if (p.current === p.milestones.length) p.state = 3;
      emit(
        abi,
        "MilestoneSettled",
        {
          projectId: args[0],
          index: args[1],
          grossAmount: m.amount,
          freelancerGross: m.amount,
          freelancerNet: net,
          clientRefund: 0n,
          serviceFee: fee,
        },
        manifest.contracts.TrustEscrow.address,
        tx,
        txLogs,
      );
    }
    const item = getAbiItem({ abi, name: fn });
    return item?.type === "function" && item.outputs.length
      ? encodeFunctionResult({ abi, functionName: fn, result: value })
      : "0x";
  }
  function rpc(method: string, params: unknown[]): unknown {
    if (method === rpcFailure) throw new Error("Test RPC unavailable");
    if (method === "eth_chainId") return "0x7a69";
    if (method === "eth_blockNumber") return hex(block);
    if (method === "eth_getBlockByNumber")
      return {
        ...blockFixture(manifest),
        hash:
          params[0] === hex(BigInt(manifest.verifiedBlock.number))
            ? manifest.verifiedBlock.hash
            : hash(block),
        number: params[0] === "latest" ? hex(block) : params[0],
        timestamp: hex(now),
        baseFeePerGas: "0x3b9aca00",
      };
    if (method === "eth_getCode")
      return params[1] !== "latest" && BigInt(params[1] as string) < 4n
        ? "0x"
        : code;
    if (method === "eth_getBalance")
      return hex(options.ethBalance ?? 10n ** 19n);
    if (method === "eth_estimateGas") return "0x186a0";
    if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas")
      return "0x3b9aca00";
    if (method === "eth_call") {
      const request = params[0] as { to: string; data: Hex; from?: Address };
      return call(request.to, request.data, false, request.from);
    }
    if (method === "eth_sendTransaction") {
      if (rejectNext) {
        rejectNext = false;
        throw { code: 4001, message: "User rejected transaction" };
      }
      const request = params[0] as { to: string; data: Hex; from: Address };
      const tx = hash(++nonce);
      block++;
      now++;
      const txLogs: Record<string, unknown>[] = [];
      const fn = decodeFunctionData({
        abi:
          request.to.toLowerCase() ===
          manifest.contracts.MockUSD.address.toLowerCase()
            ? abis.MockUSD
            : abis.TrustEscrow,
        data: request.data,
      }).functionName;
      writes.push(fn);
      const reverted = revertNext;
      revertNext = false;
      if (!reverted)
        call(request.to, request.data, true, request.from, tx, txLogs);
      receipts.set(tx, {
        transactionHash: tx,
        blockNumber: hex(block),
        blockHash: hash(block),
        transactionIndex: "0x0",
        from: request.from,
        to: request.to,
        cumulativeGasUsed: "0x186a0",
        gasUsed: "0x186a0",
        effectiveGasPrice: "0x3b9aca00",
        status: reverted ? "0x0" : "0x1",
        type: "0x2",
        contractAddress: null,
        logs: txLogs,
        logsBloom: `0x${"0".repeat(512)}`,
      });
      transactions.set(tx, {
        hash: tx,
        from: request.from,
        to: request.to,
        input: request.data,
        value: "0x0",
        nonce: hex(nonce),
        gas: "0x186a0",
        gasPrice: "0x3b9aca00",
        maxFeePerGas: "0x77359400",
        maxPriorityFeePerGas: "0x3b9aca00",
        chainId: "0x7a69",
        type: "0x2",
        blockNumber: hex(block),
        blockHash: hash(block),
        transactionIndex: "0x0",
        accessList: [],
      });
      return tx;
    }
    if (method === "eth_getTransactionByHash")
      return transactions.get(params[0] as Hex) ?? null;
    if (method === "eth_getTransactionReceipt")
      return deferReceipts ? null : (receipts.get(params[0] as Hex) ?? null);
    if (method === "eth_getLogs") {
      const filter = params[0] as {
        address: string;
        fromBlock: string;
        toBlock: string;
        topics?: (string | string[] | null)[];
      };
      return logs.filter(
        (log) =>
          String(log.address).toLowerCase() === filter.address.toLowerCase() &&
          BigInt(log.blockNumber as string) >= BigInt(filter.fromBlock) &&
          BigInt(log.blockNumber as string) <= BigInt(filter.toBlock) &&
          (!filter.topics ||
            filter.topics.every(
              (topic, i) =>
                topic === null ||
                (Array.isArray(topic)
                  ? topic
                      .map((x) => x.toLowerCase())
                      .includes(
                        String((log.topics as string[])[i]).toLowerCase(),
                      )
                  : topic.toLowerCase() ===
                    String((log.topics as string[])[i]).toLowerCase()),
            )),
      );
    }
    throw new Error(`Unsupported fixture RPC ${method}`);
  }
  return {
    manifest,
    projects,
    writes,
    advance: (timestamp: bigint) => {
      now = timestamp;
      block++;
    },
    defer: (value: boolean) => {
      deferReceipts = value;
      if (!value) {
        block++;
        now++;
      }
    },
    reject: () => {
      rejectNext = true;
    },
    revert: () => {
      revertNext = true;
    },
    failRpc: (method: string) => {
      rpcFailure = method;
    },
    async install(page: Page) {
      await page.route("**/deployments/31337.json", (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(manifest),
        }),
      );
      await page.route("http://127.0.0.1:8545/**", async (route) => {
        const payload = route.request().postDataJSON();
        const answer = (request: {
          id: number;
          method: string;
          params?: unknown[];
        }) => {
          try {
            return {
              jsonrpc: "2.0",
              id: request.id,
              result: rpc(request.method, request.params ?? []),
            };
          } catch (error) {
            return {
              jsonrpc: "2.0",
              id: request.id,
              error: {
                code: (error as { code?: number }).code ?? -32000,
                message:
                  error instanceof Error
                    ? error.message
                    : (error as { message: string }).message,
              },
            };
          }
        };
        await route.fulfill({
          contentType: "application/json",
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "content-type",
          },
          body: JSON.stringify(
            Array.isArray(payload) ? payload.map(answer) : answer(payload),
          ),
        });
      });
    },
  };
}
