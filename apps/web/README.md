# TrustLayer web

Phase 3A interface foundation plus Phase 3B injected wallet connection and verified local reads. Projects/cases remain explicitly labeled preview data. Project, milestone, staking and voting transactions remain disabled; there is no backend or private evidence storage.

From the repository root, install with `npm.cmd --prefix apps/web ci`, then run `npm.cmd run web:dev`. Open http://127.0.0.1:3000. Refreshing resets draft forms, sample/empty mode and preferences; wallet connection is explicit after reload. Sample views work without a node. Live reads require a persistent Phase2D deployment on port 8545 and a fresh non-ephemeral export. Dev/build syncs public deployment metadata automatically.

See [Phase 3A](../../docs/PHASE3A.md) for design/routes and [Phase 3B](../../docs/PHASE3B.md) for local setup, metadata validation, tests, transaction utilities, manual MetaMask checks and limitations. Do not copy contract ABIs or treat the checked-in ephemeral manifest as a live deployment. Unit tests use `npm.cmd --prefix apps/web run test:unit`; browser tests use `npm.cmd run web:test` after building.
