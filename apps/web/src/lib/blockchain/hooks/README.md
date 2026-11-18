# Phase 3B contract boundary

`useVerifiedDeployment` loads the public mirror of the generated export and validates schema, ABI hashes, persistent provenance, port 8545, chain ID, verification block and all five runtimes. Both the HTTP RPC and injected wallet must see the same deployment. Ephemeral verification exports are rejected.

`useTokenBalance` and `useProtocolReads` execute typed Viem reads only after verification, with account/chain/block-anchor query keys. Values are hidden while verifying or after errors/disconnection. No preview IDs or fixture quantities enter these hooks.

`useProtocolTransaction` supplies guarded generic wallet callbacks, message signing and receipt tracking for future reviewed workflows. There are no callers that submit transactions or sign messages in Phase 3B. Account/chain changes invalidate the tracking context; a submitted hash is never treated as a successful payment. See `docs/PHASE3B.md` before extending this boundary. Keep private evidence off-chain.
