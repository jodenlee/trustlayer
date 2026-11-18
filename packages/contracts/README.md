# TrustLayer contract integration artifacts

This private source package supplies typed Viem/Wagmi contract configurations. It contains no frontend, backend, signer, key or wallet seed.

- `generated/abi/<ContractName>.json`: the five full production ABIs, including errors and inherited functions.
- `generated/abis.ts`: the same ABIs as TypeScript `as const` exports.
- `generated/inventory.json`: all compiled constructors, read functions, state-changing functions, events and custom errors with signatures and ABI fields.
- `generated/deployments/31337.json`: addresses verified against a particular local chain, ABI/runtime hashes, block anchor and public configuration authorities.
- `src/index.ts`: `parseLocalDeployment`, `getContracts`, `assertDeploymentOnChain`, ABI exports, chain ID and token decimals.

Generate ABIs from the root with `npm.cmd run export:abis`. Deploy the actual `ignition/modules/Phase2D.ts` module, then run `npm.cmd run export:contracts` against the same local node and Ignition deployment ID. See [Phase 2E](../../docs/PHASE2E.md) for exact commands, wallet roles, allowances and workflows.

The checked-in local address file is marked `ephemeral: true` when produced by verification; its temporary node is stopped afterward. It is deployment evidence, not a running endpoint. Re-export from the persistent local node you intend to use. Never treat chain ID 31337 alone as proof that addresses are current.

Before enabling future wallet interactions:

1. Parse the JSON using `parseLocalDeployment`.
2. Call `assertDeploymentOnChain` with the active public client to check chain ID, the verification block and every contract's runtime hash.
3. Call `getContracts(manifest, connectedWalletChainId)` for strongly typed `{ address, abi }` configurations.
4. Read mutable permissions such as treasury ownership from the chain; manifest authority fields are snapshots.

Use `parseUnits(text, TOKEN_DECIMALS)` and `formatUnits(amount, TOKEN_DECIMALS)` from Viem. Token amounts and Solidity IDs must use `bigint`; six-decimal mUSD is not 18-decimal ETH. Never convert token amounts through JavaScript floating-point arithmetic.

The Phase 3A Next.js application at `apps/web` references this package through a local file dependency and `transpilePackages`. The additive `@trustlayer/contracts/metadata` export exposes only chain ID, decimals and names; loading it does not load ABIs, a deployment manifest or Viem clients. The app's client/deployment references are currently type-only. There is no default deployment auto-connection: future integration must supply an explicit validated manifest and active chain.
