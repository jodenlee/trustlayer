import { type Address, type Hex } from "viem";
import { escrowRpc } from "./escrow-rpc";
import { accountA, accountB } from "./protocol";
import type { DisputeRecord } from "../src/lib/blockchain/arbitration";

export const jurorA = `0x${"3".repeat(40)}` as Address;
export const jurorB = `0x${"4".repeat(40)}` as Address;
export const jurorC = `0x${"5".repeat(40)}` as Address;
export const outsider = `0x${"6".repeat(40)}` as Address;
const zero = `0x${"0".repeat(64)}` as Hex;
const evidence = `0x${"a".repeat(64)}` as Hex;
const unit = 1_000_000n;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MockDispute = Mutable<DisputeRecord>;
export function arbitrationRpc(
  options: {
    opened?: boolean;
    finalized?: boolean;
    jurorsReady?: boolean;
    balance?: bigint;
  } = {},
) {
  const base = escrowRpc({
    state: 2,
    milestoneState: 1,
    balance: options.balance,
  });
  const cases: MockDispute[] = [];
  const votes = new Map<string, number>();
  const claimed = new Set<string>();
  const stake = new Map<
    string,
    { registered: boolean; depositedStake: bigint; lockedStake: bigint }
  >();
  const jury = [jurorA, jurorB, jurorC] as const;
  let treasuryService = 0n;
  let treasuryDispute = 0n;
  for (const address of [...jury, accountB, outsider])
    base.balances.set(address.toLowerCase(), 1000n * unit);
  for (const address of jury)
    stake.set(address.toLowerCase(), {
      registered: options.jurorsReady !== false,
      depositedStake: options.jurorsReady === false ? 0n : 100n * unit,
      lockedStake: 0n,
    });
  const key = (id: bigint, actor: string) => `${id}:${actor.toLowerCase()}`;
  function makeCase() {
    const now = base.time();
    const d: MockDispute = {
      projectId: 0n,
      milestoneIndex: 0n,
      milestoneAmount: 100n * unit,
      client: accountA,
      freelancer: accountB,
      opener: accountA,
      jurors: jury,
      evidenceHash: evidence,
      responseHash: zero,
      openedAt: now,
      responseDeadline: now + 43200n,
      votingDeadline: now + 129600n,
      finalizedAt: 0n,
      freelancerVotes: 0,
      clientVotes: 0,
      splitVotes: 0,
      status: 1,
      ruling: 0,
      fallbackApplied: false,
      freelancerBps: 0,
    };
    cases.push(d);
    base.projects[0].milestones[0].state = 2;
    for (const j of jury) stake.get(j)!.lockedStake += 100n * unit;
    return d;
  }
  if (options.opened || options.finalized) makeCase();
  if (options.finalized) {
    cases[0].status = 2;
    cases[0].ruling = 3;
    cases[0].freelancerBps = 5000;
    cases[0].fallbackApplied = true;
    cases[0].finalizedAt = cases[0].votingDeadline + 1n;
    base.advance(cases[0].finalizedAt);
    base.projects[0].milestones[0].state = 3;
    for (const j of jury) stake.get(j)!.lockedStake = 0n;
    treasuryService = 500000n;
    treasuryDispute = 3n * unit;
  }
  base.onContract(({ name, fn, args, send, actor, now, emit }) => {
    if (name === "ProtocolTreasury") {
      if (fn === "totalServiceFeesReceived") return { result: treasuryService };
      if (fn === "totalDisputeFeesReceived") return { result: treasuryDispute };
      if (fn === "disputeFeeReceived")
        return { result: cases[Number(args[0])]?.status === 2 };
    }
    if (name === "JurorRegistry") {
      const address = String(args[0] ?? actor).toLowerCase();
      const current = stake.get(address) ?? {
        registered: false,
        depositedStake: 0n,
        lockedStake: 0n,
      };
      if (fn === "MIN_STAKE") return { result: 100n * unit };
      if (fn === "getJurorInfo")
        return {
          result: {
            ...current,
            availableStake: current.depositedStake - current.lockedStake,
            activeAssignments: current.lockedStake / (100n * unit),
          },
        };
      if (fn === "isEligible")
        return {
          result:
            current.registered &&
            current.depositedStake - current.lockedStake >= 100n * unit,
        };
      if (fn === "previewJurors") {
        if (
          jury.some(
            (j) =>
              !stake.get(j)!.registered ||
              stake.get(j)!.depositedStake - stake.get(j)!.lockedStake <
                100n * unit,
          )
        )
          throw new Error("InsufficientEligibleJurors");
        return { result: jury };
      }
      if (fn === "getAssignment")
        return {
          result: {
            client: accountA,
            freelancer: accountB,
            jurors: jury,
            state: cases[Number(args[0])]?.status === 2 ? 2 : 1,
          },
        };
      if (["registerJuror", "depositStake", "withdrawStake"].includes(fn)) {
        const own = stake.get(actor.toLowerCase()) ?? {
          registered: false,
          depositedStake: 0n,
          lockedStake: 0n,
        };
        if (send) {
          const amount = args[0] as bigint;
          if (fn === "registerJuror") {
            own.registered = true;
            emit("JurorRegistered", { juror: actor });
          } else if (fn === "depositStake") {
            own.depositedStake += amount;
            base.balances.set(
              actor.toLowerCase(),
              base.balances.get(actor.toLowerCase())! - amount,
            );
            const allowance = base.allowanceKey(
              actor,
              base.manifest.contracts.JurorRegistry.address,
            );
            base.allowances.set(
              allowance,
              base.allowances.get(allowance)! - amount,
            );
            emit("StakeDeposited", { juror: actor, amount });
          } else {
            own.depositedStake -= amount;
            base.balances.set(
              actor.toLowerCase(),
              (base.balances.get(actor.toLowerCase()) ?? 0n) + amount,
            );
            emit("StakeWithdrawn", { juror: actor, amount });
          }
          stake.set(actor.toLowerCase(), own);
        }
        return { result: undefined };
      }
    }
    if (name !== "DisputeArbitration") return undefined;
    if (fn === "nextDisputeId") return { result: BigInt(cases.length) };
    if (fn === "getMilestoneDispute")
      return { result: cases.length ? [true, 0n] : [false, 0n] };
    if (fn === "openDispute") {
      if (!send) return { result: BigInt(cases.length) };
      const id = BigInt(cases.length);
      const d = makeCase();
      d.opener = actor;
      d.evidenceHash = args[2] as Hex;
      base.balances.set(
        actor.toLowerCase(),
        base.balances.get(actor.toLowerCase())! - 15n * unit,
      );
      const allowance = base.allowanceKey(
        actor,
        base.manifest.contracts.DisputeArbitration.address,
      );
      base.allowances.set(
        allowance,
        base.allowances.get(allowance)! - 15n * unit,
      );
      emit("MilestoneFrozen", { projectId: 0n, index: 0n }, "TrustEscrow");
      emit("DisputeFeeCollected", {
        disputeId: id,
        payer: actor,
        amount: 15n * unit,
      });
      emit("DisputeOpened", {
        disputeId: id,
        projectId: 0n,
        milestoneIndex: 0n,
        opener: actor,
        evidenceHash: d.evidenceHash,
        responseDeadline: d.responseDeadline,
        votingDeadline: d.votingDeadline,
      });
      for (const juror of jury)
        emit(
          "StakeLocked",
          { disputeId: id, juror, amount: 100n * unit },
          "JurorRegistry",
        );
      return { result: id };
    }
    const id = args[0] as bigint;
    const d = cases[Number(id)];
    if (!d) throw new Error("Unknown case");
    if (fn === "getDispute") return { result: d };
    if (fn === "votes")
      return { result: votes.get(key(id, String(args[1]))) ?? 0 };
    if (fn === "rewardClaimed")
      return { result: claimed.has(key(id, String(args[1]))) };
    if (fn === "claimableReward")
      return {
        result:
          d.status === 2 &&
          jury.some((j) => j.toLowerCase() === String(args[1]).toLowerCase()) &&
          !claimed.has(key(id, String(args[1])))
            ? 4n * unit
            : 0n,
      };
    if (send && fn === "respondToDispute") {
      d.responseHash = args[1] as Hex;
      emit("DisputeResponded", {
        disputeId: id,
        responder: actor,
        evidenceHash: d.responseHash,
      });
    }
    if (send && fn === "castVote") {
      const vote = args[1] as number;
      votes.set(key(id, actor), vote);
      if (vote === 1) d.freelancerVotes++;
      else if (vote === 2) d.clientVotes++;
      else d.splitVotes++;
      emit("VoteCast", { disputeId: id, juror: actor, vote });
    }
    if (send && fn === "finalizeDispute") {
      d.status = 2;
      d.finalizedAt = now;
      d.ruling = d.freelancerVotes >= 2 ? 1 : d.clientVotes >= 2 ? 2 : 3;
      d.fallbackApplied =
        d.freelancerVotes < 2 && d.clientVotes < 2 && d.splitVotes < 2;
      d.freelancerBps = d.ruling === 1 ? 10000 : d.ruling === 2 ? 0 : 5000;
      const gross = (d.milestoneAmount * BigInt(d.freelancerBps)) / 10000n;
      const fee = gross / 100n;
      treasuryService += fee;
      treasuryDispute += 3n * unit;
      base.projects[0].milestones[0].state = 3;
      base.projects[0].state = 3;
      base.projects[0].remaining = 0n;
      for (const j of jury) stake.get(j)!.lockedStake -= 100n * unit;
      emit(
        "MilestoneSettled",
        {
          projectId: 0n,
          index: 0n,
          grossAmount: d.milestoneAmount,
          freelancerGross: gross,
          freelancerNet: gross - fee,
          clientRefund: d.milestoneAmount - gross,
          serviceFee: fee,
        },
        "TrustEscrow",
      );
      emit("DisputeFinalized", {
        disputeId: id,
        projectId: 0n,
        milestoneIndex: 0n,
        freelancerBps: BigInt(d.freelancerBps),
        milestoneAmount: d.milestoneAmount,
        finalizedAt: now,
      });
    }
    if (send && fn === "claimJurorReward") {
      claimed.add(key(id, actor));
      base.balances.set(
        actor.toLowerCase(),
        (base.balances.get(actor.toLowerCase()) ?? 0n) + 4n * unit,
      );
      emit("JurorRewardClaimed", {
        disputeId: id,
        juror: actor,
        amount: 4n * unit,
      });
    }
    return { result: undefined };
  });
  return { ...base, cases, votes, stake, claimed };
}
