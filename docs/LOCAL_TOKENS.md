# Local MockUSD provisioning

This is development setup for the existing Phase 3D stack, not a new protocol phase or a faucet service. `MockUSD.sol` mints exactly 1,000,000 mUSD (six decimals) to its constructor's initial holder. `Phase2D.ts` passes the deployment account as that holder. There is no public mint function. The provisioning script transfers existing tokens; it never increases supply or changes escrow, stakes, fees or deployment bindings.

## Run from PowerShell

Keep the existing persistent Hardhat node and Phase2D deployment running on **http://127.0.0.1:8545, chain 31337**. Do not reset or redeploy a working stack just to fund wallets. Use the five public MetaMask addresses; no private key, seed phrase or populated .env file is needed. Replace all placeholders:

```powershell
$env:LOCAL_RPC_URL='http://127.0.0.1:8545'
$env:TRUSTLAYER_CLIENT='0xYOUR_PUBLIC_CLIENT_ADDRESS'
$env:TRUSTLAYER_FREELANCER='0xYOUR_PUBLIC_FREELANCER_ADDRESS'
$env:TRUSTLAYER_JUROR_1='0xYOUR_PUBLIC_JUROR_1_ADDRESS'
$env:TRUSTLAYER_JUROR_2='0xYOUR_PUBLIC_JUROR_2_ADDRESS'
$env:TRUSTLAYER_JUROR_3='0xYOUR_PUBLIC_JUROR_3_ADDRESS'
npx.cmd hardhat run scripts/provision-local-tokens.ts --network localhost
```

Install dependencies/compile first on a clean checkout (`npm.cmd ci`, `npm.cmd run compile`). The script uses the existing generated manifest at `packages/contracts/generated/deployments/31337.json`. If the chain was reset or the export is stale, follow [Phase 3C setup](PHASE3C.md) to export the actual persistent deployment. A normal token transfer does not require a new manifest or ABI export. The script itself never edits addresses, exports, deployment journals or contracts.

| Role | Minimum liquid wallet balance after provisioning |
| --- | --- |
| Client | 2,000 mUSD |
| Freelancer | 100 mUSD |
| Juror 1 | 200 mUSD |
| Juror 2 | 200 mUSD |
| Juror 3 | 200 mUSD |

For five empty wallets, exactly 2,700 mUSD is transferred. Existing balances count toward the target: a client with 500 mUSD receives 1,500; a freelancer with 150 receives nothing. Rerunning with unchanged balances submits no token transactions. If you later spend tokens in escrow, fees or staking, rerunning restores the **liquid wallet targets** and can transfer additional tokens. It does not count escrow/staked tokens as a wallet balance or move tokens back out of protocol custody.

## Validation and confirmation

Before transferring, the script:

- Requires all five addresses, validates Ethereum/checksum syntax, rejects zero/duplicate addresses and rejects protocol contract addresses as recipients.
- Rejects alternate hosts/ports, public RPC URLs, credentials, paths and queries. The selected Hardhat network must be `localhost` HTTP and its resolved URL must be exactly the allowed IPv4 endpoint. The live RPC and wallet must report chain 31337.
- Rejects ephemeral manifests and validates the exported anchor block and all five runtime hashes using the existing SDK. It additionally matches MockUSD's runtime/ABI to the current compiled artifact, checks mUSD/6 decimals and verifies fixed total supply.
- Locates token creation with at most 64 historical code lookups, then reads mint Transfer logs from that single block. It identifies the actual initial holder rather than assuming the first returned RPC account owns the tokens.
- Requires that original holder to be an existing unlocked local JSON-RPC account, with sufficient existing mUSD for the planned top-ups and local ETH for gas. No private-key signer or alternate mint path exists.

For each shortfall it rereads the current balance, revalidates the chain/export, simulates the exact transfer, prints the submitted hash, waits for a successful receipt and reads the confirmed balance. Final output lists all five real balances and confirms total supply is unchanged. Above-target wallets are skipped, never reduced.

Run one provisioning process at a time and pause other activity in these wallets until it completes. Transfers are sequential, not an atomic batch. If interrupted, already-confirmed transfers remain. Check any printed pending/unconfirmed receipt before rerunning. The script refuses to submit while the holder has pending transactions; after confirmation, the balance-based top-up skips completed recipients. It never automatically retries an uncertain transfer or fabricates a confirmation.

Local ETH provisioning is separate and is not repeated by this script. After successful provisioning, refresh/reconnect the frontend on the same deployment. You may register/stake as jurors, fund a project and pay dispute fees through the existing UI; the script grants no token allowances and performs none of those protocol actions.

## Verification

Implementation files are `scripts/provision-local-tokens.ts`, `scripts/lib/provisioning.ts` and `test/LocalTokenProvisioning.ts`. Existing Phase 3C/3D docs link here. Production Solidity, deployment modules, generated contract exports and dependencies remain unchanged.

```powershell
npm.cmd run compile
npm.cmd run typecheck
npm.cmd test
git diff --check
```

The new tests run against unchanged production contracts on an isolated in-process EVM, including exact targets, supply/custody conservation, no-op reruns, partial top-ups, reordered/unavailable holders, malformed/duplicate/protocol addresses, nonlocal endpoints, stale manifests, runtime mismatch, insufficient tokens/gas, wrong chain, pending nonces and recovery after a mined transfer's receipt lookup fails. Their test adapter does not connect to or reset the running user's node.

Verification completed for this setup task:

| Check | Result |
| --- | --- |
| `npm.cmd run compile` | Exit 0; no contracts to compile |
| `npm.cmd run typecheck` | Exit 0 |
| `npm.cmd test` | Exit 0; **182 passing Node.js tests** (156 existing protocol regressions + 26 provisioning tests) |
| `git diff --check` / new-file whitespace | Passed |
| First persistent-chain execution | Exit 0; five confirmed transfers at blocks 18–22, exactly 2,700 mUSD transferred |
| Immediate persistent-chain rerun | Exit 0; all five recipients skipped, **zero additional transactions** |

The actual local MockUSD address was `0x5FbDB2315678afecb367f032d93F642f64180aa3`; the creation mint identified the unlocked holder `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`. Final real recipient reads were client 2,000 mUSD, freelancer 100 and three jurors 200 each; the holder retained 997,300 mUSD and total supply remained exactly 1,000,000 mUSD. Both executions printed submitted/confirmed hashes or skip messages and all confirmed balances. The five recipient public addresses were supplied explicitly for execution, not stored in a populated .env file or hard-coded into the script.

Production contracts, economics, deployment modules, exported addresses/ABIs, dependencies and application logic were not modified. No public network, credentials, mint authority, token approvals, staking or escrow actions were used. Refresh the frontend's wallet reads to continue Phase 3D manual verification; later-phase development remains out of scope.
