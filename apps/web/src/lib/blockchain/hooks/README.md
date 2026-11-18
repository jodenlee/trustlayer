# Phase 3B hook boundary

No wallet/provider/hooks are initialized in Phase 3A. Add Wagmi providers and read adapters here only after authorization. Convert real contract states into `lib/models.ts` rather than passing preview fixtures to transactions.

Use `@trustlayer/contracts` ABIs and typed `getContracts`; never copy ABIs into the app. Require an explicit fresh manifest, `parseLocalDeployment`, `assertDeploymentOnChain`, matching wallet chain/account and mutable permission reads before enabling writes. Do not auto-load the checked-in ephemeral manifest. Account/chain changes must invalidate cached state. Keep private evidence off-chain.
