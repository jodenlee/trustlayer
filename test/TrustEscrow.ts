import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";

const unit = 10n ** 6n;
const evidence = `0x${"11".repeat(32)}` as `0x${string}`;

// Executable first-pass tests. Expand this suite to match docs/PHASES.md.
describe("TrustLayer Phase 1 escrow", async () => {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();

  it("deploys a six-decimal mock token", async () => {
    const [deployer] = await viem.getWalletClients();
    const token = await viem.deployContract("MockUSD", [deployer.account.address]);
    assert.equal(await token.read.decimals(), 6);
    assert.equal(await token.read.balanceOf([deployer.account.address]), 1_000_000n * unit);
  });

  it("locks 1000 mUSD, settles the first 400 mUSD milestone and conserves escrow", async () => {
    const [client, freelancer, treasury] = await viem.getWalletClients();
    const token = await viem.deployContract("MockUSD", [client.account.address]);
    const escrow = await viem.deployContract("TrustEscrow", [token.address, treasury.account.address]);
    const now = BigInt((await publicClient.getBlock()).timestamp);
    const future = now + 14n * 24n * 3600n;
    await escrow.write.createProject([
      freelancer.account.address,
      [400n * unit, 600n * unit],
      [future, future + 7n * 24n * 3600n],
      evidence,
    ]);
    await token.write.approve([escrow.address, 1_000n * unit]);
    await escrow.write.fundProject([0n]);
    assert.equal(await token.read.balanceOf([escrow.address]), 1_000n * unit);
    assert.equal(await escrow.read.totalEscrowLiability(), 1_000n * unit);
    await escrow.write.acceptProject([0n], { account: freelancer.account });
    await escrow.write.submitMilestone([0n, 0n, evidence], { account: freelancer.account });
    await escrow.write.approveMilestone([0n, 0n]);
    assert.equal(await token.read.balanceOf([freelancer.account.address]), 396n * unit);
    assert.equal(await token.read.balanceOf([treasury.account.address]), 4n * unit);
    assert.equal(await token.read.balanceOf([escrow.address]), 600n * unit);
    assert.equal(await escrow.read.totalEscrowLiability(), 600n * unit);
  });
});
