import type { HardhatViemHelpers } from "@nomicfoundation/hardhat-viem/types";
import { formatUnits, getAddress, isAddress, zeroAddress, type Address, type Hash } from "viem";
import { assertDeploymentOnChain, MockUSDAbi, parseLocalDeployment, type LocalDeployment } from "../../packages/contracts/src/index.js";
import { abiHash, assertRuntimeMatches, type CompiledContract } from "./artifacts.js";

export const PROVISION_RPC_URL = "http://127.0.0.1:8545";
export const TOKEN_SUPPLY = 1_000_000n * 10n ** 6n;
export const PROVISION_TARGETS = [
  { role: "client", env: "TRUSTLAYER_CLIENT", target: 2000n * 10n ** 6n },
  { role: "freelancer", env: "TRUSTLAYER_FREELANCER", target: 100n * 10n ** 6n },
  { role: "juror1", env: "TRUSTLAYER_JUROR_1", target: 200n * 10n ** 6n },
  { role: "juror2", env: "TRUSTLAYER_JUROR_2", target: 200n * 10n ** 6n },
  { role: "juror3", env: "TRUSTLAYER_JUROR_3", target: 200n * 10n ** 6n },
] as const;
export type ProvisioningEnvironment = Record<string, string | undefined>;

export function assertProvisioningRpc(value: string) {
  if (new URL(value).toString() !== `${PROVISION_RPC_URL}/`)
    throw new Error(`Token provisioning requires exactly ${PROVISION_RPC_URL}, with no credentials, alternate host/port, path or query.`);
}
export function provisioningRecipients(env: ProvisioningEnvironment) {
  const recipients = PROVISION_TARGETS.map((setting) => {
    const value = env[setting.env]?.trim();
    if (!value || !isAddress(value) || getAddress(value) === zeroAddress)
      throw new Error(`${setting.env} must contain a valid nonzero Ethereum address (including a valid mixed-case checksum).`);
    return { ...setting, address: getAddress(value) };
  });
  if (new Set(recipients.map((r) => r.address.toLowerCase())).size !== 5)
    throw new Error("Client, freelancer and three jurors must use five distinct wallet addresses.");
  return recipients;
}

/** Existing fixed supply only. CLI binds viem to the checked localhost HTTP network. */
export async function provisionLocalTokens(
  viem: HardhatViemHelpers,
  manifestValue: LocalDeployment,
  compiledToken: CompiledContract,
  env: ProvisioningEnvironment,
  rpcUrl: string,
  log: (message: string) => void = console.log,
) {
  assertProvisioningRpc(rpcUrl);
  const recipients = provisioningRecipients(env);
  const manifest = parseLocalDeployment(manifestValue);
  if (manifest.ephemeral) throw new Error("Use the persistent local deployment export; ephemeral verification manifests cannot provision wallets.");
  assertProvisioningRpc(manifest.rpcUrl);
  const protectedAddresses = new Set(Object.values(manifest.contracts).map((c) => c.address.toLowerCase()));
  if (recipients.some((r) => protectedAddresses.has(r.address.toLowerCase())))
    throw new Error("A recipient is a protocol contract, not a development wallet. Correct the five wallet addresses.");
  const client = await viem.getPublicClient();
  await assertDeploymentOnChain(client, manifest);
  const token = { address: manifest.contracts.MockUSD.address, abi: MockUSDAbi } as const;
  const runtime = await client.getCode({ address: token.address });
  if (!runtime) throw new Error("Missing deployed MockUSD bytecode.");
  if (compiledToken.contractName !== "MockUSD" || abiHash(compiledToken.abi) !== manifest.contracts.MockUSD.abiHash)
    throw new Error("MockUSD artifact/ABI differs from the deployment export. Compile and verify the correct local stack.");
  assertRuntimeMatches(runtime, compiledToken);
  const [symbol, decimals, supply] = await Promise.all([
    client.readContract({ ...token, functionName: "symbol" }),
    client.readContract({ ...token, functionName: "decimals" }),
    client.readContract({ ...token, functionName: "totalSupply" }),
  ]);
  if (symbol !== "mUSD" || decimals !== 6 || supply !== TOKEN_SUPPLY)
    throw new Error("Deployed token does not match fixed-supply, six-decimal MockUSD.");

  // Locate token creation with bounded historical code reads, then read exactly that block.
  // The export's verification block can be later than deployment and must not be used as a mint block.
  let low = 0n;
  let high = BigInt(manifest.verifiedBlock.number);
  for (let step = 0; low < high; step++) {
    if (step >= 64) throw new Error("Token creation search exceeded its bounded budget.");
    const mid = (low + high) / 2n;
    const code = await client.getCode({ address: token.address, blockNumber: mid });
    if (code && code !== "0x") high = mid; else low = mid + 1n;
  }
  const minted = await client.getContractEvents({ ...token, eventName: "Transfer", args: { from: zeroAddress }, fromBlock: low, toBlock: low, strict: true });
  if (minted.length !== 1 || minted[0].args.value !== TOKEN_SUPPLY || minted[0].args.to === zeroAddress)
    throw new Error("Cannot verify MockUSD's original fixed-supply mint and initial holder.");
  const holder = getAddress(minted[0].args.to);
  const wallets = await viem.getWalletClients();
  const wallet = wallets.find((w) => w.account.address.toLowerCase() === holder.toLowerCase());
  if (!wallet || wallet.account.type !== "json-rpc")
    throw new Error(`Initial token holder ${holder} is not an unlocked local RPC account. No private key is accepted; use the intended local deployment.`);
  if (await wallet.getChainId() !== 31337) throw new Error("Initial holder's wallet is not on chain 31337.");
  const initialBalances = await Promise.all(recipients.map((r) => client.readContract({ ...token, functionName: "balanceOf", args: [r.address] })));
  const needed = recipients.reduce((sum, r, i) => sum + (initialBalances[i] < r.target ? r.target - initialBalances[i] : 0n), 0n);
  const holderBalance = await client.readContract({ ...token, functionName: "balanceOf", args: [holder] });
  const holderTarget = recipients.find((r) => r.address === holder)?.target ?? 0n;
  if (holderBalance < needed + holderTarget)
    throw new Error(`Initial holder has insufficient mUSD: ${formatUnits(holderBalance, 6)} available, ${formatUnits(needed + holderTarget, 6)} required. No transfers sent.`);
  if (needed > 0n && await client.getBalance({ address: holder }) === 0n)
    throw new Error("The unlocked initial holder needs local ETH for gas. No token transfers sent.");
  log(`Verified Hardhat Local 31337 at ${PROVISION_RPC_URL}; MockUSD ${token.address}; supply ${formatUnits(supply, 6)} mUSD.`);
  log(`Original mint holder ${holder}; existing balance ${formatUnits(holderBalance, 6)} mUSD. Top-ups needed: ${formatUnits(needed, 6)} mUSD.`);
  const transfers: { role: string; address: Address; amount: bigint; hash: Hash }[] = [];
  for (const recipient of recipients) {
    await assertDeploymentOnChain(client, manifest);
    const balance = await client.readContract({ ...token, functionName: "balanceOf", args: [recipient.address] });
    if (balance >= recipient.target) {
      log(`${recipient.role}: SKIP ${recipient.address}; confirmed balance ${formatUnits(balance, 6)} mUSD already meets target ${formatUnits(recipient.target, 6)}.`);
      continue;
    }
    const [latestNonce, pendingNonce] = await Promise.all([
      client.getTransactionCount({ address: holder, blockTag: "latest" }),
      client.getTransactionCount({ address: holder, blockTag: "pending" }),
    ]);
    if (pendingNonce !== latestNonce) throw new Error("The initial holder has pending transactions. Confirm/check those receipts before rerunning; no duplicate top-up is submitted.");
    if (await wallet.getChainId() !== 31337) throw new Error("Local wallet chain changed before transfer.");
    const amount = recipient.target - balance;
    await client.simulateContract({ ...token, functionName: "transfer", args: [recipient.address, amount], account: holder });
    const hash = await wallet.writeContract({ ...token, functionName: "transfer", args: [recipient.address, amount] });
    log(`${recipient.role}: submitted ${hash}; transferring ${formatUnits(amount, 6)} mUSD to ${recipient.address}.`);
    let receipt;
    try { receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 60_000, pollingInterval: 1000 }); }
    catch (error) { throw new Error(`Confirmation unresolved for ${hash}. Check its receipt before rerunning; do not assume failure.`, { cause: error }); }
    if (receipt.status !== "success") throw new Error(`Token transfer reverted: ${hash}.`);
    const confirmedBalance = await client.readContract({ ...token, functionName: "balanceOf", args: [recipient.address] });
    if (confirmedBalance < recipient.target) throw new Error(`Confirmed transfer ${hash}, but ${recipient.role}'s balance is below target. Stop other wallet activity and inspect the receipt.`);
    log(`${recipient.role}: confirmed ${hash} at block ${receipt.blockNumber}; balance ${formatUnits(confirmedBalance, 6)} mUSD.`);
    transfers.push({ role: recipient.role, address: recipient.address, amount, hash });
  }
  await assertDeploymentOnChain(client, manifest);
  const balances = await Promise.all(recipients.map((r) => client.readContract({ ...token, functionName: "balanceOf", args: [r.address] })));
  if (await client.readContract({ ...token, functionName: "totalSupply" }) !== supply)
    throw new Error("Unexpected token supply change during provisioning.");
  const results = recipients.map((r, i) => ({ ...r, balance: balances[i] }));
  if (results.some((r) => r.balance < r.target)) throw new Error("A recipient no longer meets its target. Stop concurrent wallet activity and inspect balances.");
  log("Verified final balances from MockUSD:");
  for (const r of results) log(`${r.role}: ${r.address} = ${formatUnits(r.balance, 6)} mUSD (target ${formatUnits(r.target, 6)}).`);
  log(`Complete: ${transfers.length} confirmed transfer(s); total supply unchanged at ${formatUnits(supply, 6)} mUSD.`);
  return { holder, token: token.address, transfers, recipients: results, supply };
}
