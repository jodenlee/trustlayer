# Verified contract boundary

`useVerifiedDeployment` loads the public mirror of the generated export and validates schema, ABI hashes, persistent provenance, port 8545, chain ID, verification block and all five runtimes. Both the HTTP RPC and injected wallet must see the same deployment. Ephemeral verification exports are rejected.

`useTokenBalance` and `useProtocolReads` execute typed Viem reads only after verification, with account/chain/block-anchor query keys. Values are hidden while verifying or after errors/disconnection. No preview IDs or fixture quantities enter these hooks.

`useProtocolTransaction` adapts the imperative workflow controller to React. Phase 3C callers submit only reviewed escrow/token operations through fresh identity, state, balance, allowance, simulation and gas checks. Account/chain changes invalidate the visible context; original session records retain uncertain/submitted hashes for receipt checking. A submitted hash is never treated as a successful payment. Review dialogs bind the acting wallet and deployment snapshot. Message signing remains unused by product workflows.

`useWalletProjects`, `useChainProject` and `useProjectHistory` use scoped query keys and bounded reads. Discovery pages scan at most twenty IDs; history pages span at most two hundred blocks and identify their coverage. Metadata and client records are memory-only. See `docs/PHASE3C.md` before extending this boundary. Keep private evidence off-chain and stop before dispute/juror/backend integration without approval.
