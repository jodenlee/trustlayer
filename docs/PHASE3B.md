# Phase 3B — Wallet connection and blockchain integration

## Implemented scope

The existing Next.js app now supports real injected EIP-1193 wallets through Wagmi 3.7.11, Viem 2.58.0 and TanStack Query 5.108.0. These are new frontend dependencies only. Root Hardhat dependencies, Solidity 0.8.28 contracts, deployment modules, generated ABIs, deployment exports and protocol economics are unchanged. The test runner is tsx 4.23.15, selected after an older test-runner release introduced a low-severity development dependency finding.

No project creation/funding, milestone actions, dispute opening/voting/finalization, juror registration/staking/reward claims, treasury UI actions, backend, Supabase or public-network deployment is implemented. Existing forms remain local drafts and transaction buttons remain disabled, including after connection. Generic transaction infrastructure has no production page caller. No message-signing button or demonstration transaction is provided.

## Wallet architecture

Files created or changed in this phase:

| Area | Files |
| --- | --- |
| New wallet/read UI | `apps/web/src/components/blockchain-provider.tsx`, `wallet.tsx`, `live-wallet.tsx`, `transaction-feedback.tsx` |
| New integration modules | `apps/web/src/lib/blockchain/deployment.ts`, `errors.ts`, `transactions.ts`, `hooks/use-protocol.ts`, `hooks/use-protocol-transaction.ts` |
| New tooling/tests | `apps/web/scripts/sync-deployment.mjs`, `test-support/protocol.ts`, `unit/blockchain.test.ts`, `tests/wallet-fixture.ts`, `tests/wallet.spec.ts` |
| Updated UI | `src/components/providers.tsx`, `shell.tsx`, `settings.tsx`, `dashboard.tsx`, `transactions.tsx`; deferred-read/action wording in `project-form.tsx`, `project-detail.tsx`, `juror.tsx`, `dispute-list.tsx`, `dispute-detail.tsx`; `src/app/layout.tsx`, `(public)/page.tsx`, `globals.css` (paths within apps/web) |
| Updated frontend tooling | `apps/web/.gitignore`, `package.json`, `package-lock.json`, `next.config.ts`, generated `next-env.d.ts`, `src/lib/blockchain/config.ts`, hook README, `tests/workspace.spec.ts` |
| Documentation | New `docs/PHASE3B.md`; updated root `README.md`, `AGENTS.md`, `docs/PHASES.md`, `apps/web/README.md`, `web/README.md`, `packages/contracts/README.md` |

The existing frontend routes and shared design primitives remain in place.

`BlockchainProvider` creates a per-app Wagmi configuration and QueryClient using React state. `ssr: true` keeps the initial disconnected server/client render deterministic. `reconnectOnMount: false` requires explicit user connection after a reload rather than automatically requesting access. Wagmi's injected connector supports window.ethereum and EIP-6963 wallet discovery, including MetaMask and compatible injected providers. The app does not ask for credentials, keys or recovery phrases.

The header's wallet control opens a labeled native dialog. Available connectors are detected after mounting. Missing wallets receive installation/browser guidance; rejection and provider errors are handled without creating a connected balance. Connected UI displays a shortened address and actual chain ID/network; settings show the full account. Unsupported networks pause local reads. Switching/adding Hardhat Local occurs only through a user-initiated button and wallet approval. Account, chain and provider-disconnection events flow through Wagmi.

Disconnect removes the app's active Wagmi connection and cancels/removes protocol queries. It does not promise to revoke every wallet-side permission. Manage persistent site permissions in the wallet itself.

## Chain and deployment metadata

| Setting | Value |
| --- | --- |
| Supported chain | Hardhat Local, 31337 |
| HTTP RPC | http://127.0.0.1:8545 |
| Payment token | MockUSD, mUSD, 6 decimals |
| Authoritative deployment source | `packages/contracts/generated/deployments/31337.json` |
| Browser-readable mirror | `apps/web/public/deployments/31337.json` (generated and ignored) |

`scripts/sync-deployment.mjs` mirrors only the existing public export. It runs automatically before frontend dev/build and can be run explicitly with `npm.cmd --prefix apps/web run contracts:sync`. It never guesses deployment addresses or exports signer material. Missing/unreadable source metadata produces a setup marker instead of failing the build. The browser fetches the mirror without caching and handles missing/invalid JSON with setup guidance. After re-exporting while a server is running, sync again and click Retry verification (or reload); production deployments should rebuild/restart to refresh static assets reliably.

The checked-in Phase 2E export is **ephemeral** and points to its stopped verification node. The frontend rejects it; this is expected until a persistent deployment is exported. Chain ID 31337 alone is not sufficient validation. The app requires:

1. Existing `parseLocalDeployment` validation: complete five-contract addresses, no zero/duplicate addresses, correct schema/module/chain, ABI hashes, token metadata, authorities and provenance.
2. A non-ephemeral loopback deployment on port 8545.
3. `assertDeploymentOnChain` against the local HTTP client: chain ID, anchored block hash and all five runtime hashes.
4. The same anchored block/runtime validation through the injected wallet's provider, rejecting another resettable 31337 instance.

Only then are typed `getContracts` configurations exposed. Addresses and ABIs come directly from `@trustlayer/contracts`; no page contains copied ABIs or deployment addresses. Current treasury ownership is read on-chain rather than inferred from exported authority snapshots. Two precise frontend Turbopack aliases resolve the SDK's NodeNext `.js` specifiers to its existing TypeScript sources; the SDK and generated artifacts stay unchanged.

## Reads and token precision

`useVerifiedDeployment` gates the reusable `useTokenBalance` and `useProtocolReads` hooks. Query identities include account, chain, connector identity for verification, and deployment block anchor for contract reads. Previous values are suppressed during verification, after disconnection/network changes and on failed reads. Verification polls every 30 seconds; token/protocol reads poll every 15 seconds while enabled. Requests have no automatic retry loop. HTTP verification has a 5-second transport timeout; injected verification is bounded to 7 seconds. Focus/manual refresh also revalidates state.

The live wallet card on dashboard/settings shows connected-account balance and on-chain symbol/decimals. Metadata must equal mUSD/6 before a token balance is shown. Loading, disconnected/unavailable, setup failure, RPC/read failure and successful states are distinct. Zero is displayed only when the read actually returns zero.

Settings also show all verified contract addresses and public state: escrow liability, total/locked juror stake, reserved juror rewards, treasury available revenue, current treasury owner and arbitration configuration status. These aggregate values are not represented as the connected user's project balances or personal claim entitlements.

All token quantities use bigint base units. Existing formatting/parsing retains exact six-decimal precision without floating-point conversion, including quantities above Number.MAX_SAFE_INTEGER. UI preferences can show all six decimals; nonzero precision is never silently rounded away. Sample projects/cases remain explicitly fictional and separate from the live wallet card. Transaction history stays empty; connecting does not create sample hashes, completed payments or dispute outcomes.

## Generic signing and transaction infrastructure

`useProtocolTransaction` obtains a fresh wallet client and revalidates current account, chain and deployment before exposing a typed context to a future submit callback. `requestWalletSignature` handles message signing independently; a signature is not a payment. No existing project or juror page calls these APIs in Phase 3B.

`createTransactionController` provides these states:

```text
idle -> validating -> awaiting-signature -> submitted -> confirming
                                                    -> confirmed
                                                    -> reverted
                                                    -> unconfirmed
                                                    -> cancelled / replaced
pre-submission failure -> rejected / failed
```

Submitted and confirming states retain an actual validated transaction hash and do not imply successful execution. The Viem receipt adapter waits for one local confirmation, with a 60-second confirmation timeout. Successful receipts must match the tracked hash. A mined revert never confirms. A post-submission RPC error/timeout yields **unconfirmed**, preserving the hash and warning against blind resubmission. Repricing follows the replacement hash; cancellation or a different replacement never confirms the original intended action. A post-confirmation refresh failure leaves the transaction confirmed and reports a separate refresh warning.

The controller blocks overlapping requests within its active run. Account/chain/connector changes reset tracking and suppress late confirmations or refreshes from the old context. Resetting tracking cannot cancel a transaction already submitted on-chain. After confirmation the hook invalidates protocol queries. `TransactionFeedback` provides accessible status/hash display for future workflows; it is not populated with fabricated transactions or mounted as a demo flow.

This is foundation infrastructure, not a security-complete transaction workflow. Phase 3C must add action-specific role/state checks, simulation, allowance handling, receipt/event reconciliation and reorg handling. One local confirmation is not a public-network finality policy. A compromised RPC/provider or manipulated local chain is outside this validation's trust model; matching a block anchor and runtime hashes is not a chain consensus proof.

## Required local setup

From the repository root, use separate PowerShell terminals. `npm.cmd` avoids PowerShell npm.ps1 execution-policy issues.

Install dependencies:

```powershell
npm.cmd ci
npm.cmd --prefix apps/web ci
npm.cmd run compile
```

Terminal 1 — persistent local node:

```powershell
npm.cmd run node -- --hostname 127.0.0.1
```

Terminal 2 — fresh complete deployment/export:

```powershell
$env:LOCAL_RPC_URL = 'http://127.0.0.1:8545'
$env:TRUSTLAYER_DEPLOYMENT_ID = 'trustlayer-local'
$env:TRUSTLAYER_VERIFY_FRESH = 'true'
$env:TRUSTLAYER_EXPORT_EPHEMERAL = 'false'
npx.cmd hardhat ignition deploy ignition/modules/Phase2D.ts --network localhost --deployment-id trustlayer-local
npm.cmd run export:contracts
npm.cmd run web:dev
```

Open http://127.0.0.1:3000. `web:dev` syncs the manifest automatically. After legitimate chain activity, set TRUSTLAYER_VERIFY_FRESH to false for re-export; configuration/code checks remain required. Do not reuse a mismatched Ignition journal after resetting a chain; use a new deployment ID or the documented recovery/resume procedure. Wrong one-time bindings require a fresh stack, not replacement setters. See [Phase 2E](PHASE2E.md).

If exporting while the app already runs:

```powershell
npm.cmd --prefix apps/web run contracts:sync
```

For production-style local serving, use `npm.cmd run web:build`, then `npm.cmd run web:start`. No populated environment file, secret or NEXT_PUBLIC private key is needed. Local ETH is needed only for future transactions; an account may legitimately have zero mUSD because MockUSD's initial supply belongs to the deployment's initial holder.

## Automated verification

```powershell
npm.cmd --prefix apps/web run test:unit
npm.cmd run web:lint
npm.cmd run web:typecheck
npm.cmd run web:build
# Stop any other server using port 3000; tests own their production server.
$env:PLAYWRIGHT_CHANNEL='chrome'
npm.cmd run web:test
# Alternatively install Playwright Chromium, omit PLAYWRIGHT_CHANNEL, and run tests.
npm.cmd --prefix apps/web run format:check
npm.cmd run compile
npm.cmd test
npm.cmd run typecheck
git diff --check
```

Verification executed on 2026-11-18 with Node 25.6.1/npm 11.9.0:

| Command | Actual result |
| --- | --- |
| `npm.cmd --prefix apps/web run test:unit` | Exit 0; **36 passed**, 0 failed/skipped |
| `$env:PLAYWRIGHT_CHANNEL='chrome'; npm.cmd run web:test` | Exit 0; **105 passed (51.6s)** across desktop/tablet/mobile: 60 retained foundation checks plus 45 wallet checks |
| `npm.cmd run web:lint` | Exit 0; zero errors/warnings with `--max-warnings 0` |
| `npm.cmd run web:typecheck` | Exit 0; generated route types and `tsc --noEmit` pass |
| `npm.cmd run web:build` | Exit 0; Next.js 16.4.6 optimized production build, 18 static pages generated |
| `npm.cmd --prefix apps/web run format:check` | Exit 0; all matched sources use Prettier formatting |
| `npm.cmd run compile` | Exit 0; no contracts to compile |
| `npm.cmd test` | Exit 0; **156 passing (156 nodejs)** |
| `npm.cmd run typecheck` | Exit 0; unchanged root contracts/tooling/tests type check |
| `git diff --check` | Exit 0; only Windows LF/CRLF informational notices |
| `npm.cmd --prefix apps/web audit --omit=dev --json` | Exit 0; zero production vulnerabilities |

Protected-file diff checks confirm no changes to production/test Solidity, deployment modules, generated contract exports or the root dependency lockfile. Next.js regenerated next-env.d.ts references from dev route types to production route types during the build. Production-headless screenshots include the connected wallet at desktop/tablet/mobile widths; desktop/mobile captures were visually inspected. No actual MetaMask, wallet signing or transaction submission was performed.

Unit tests cover metadata/schema/address/ABI/provenance failures, chain/block/runtime mismatches, unavailable RPC, missing/invalid JSON, exact token precision and transaction lifecycle/rejection/revert/replacement/race handling. Browser integration uses a deterministic **test-only** EIP-1193 provider and intercepted RPC responses; it is not actual MetaMask or a real funded wallet. It covers connection/disconnection, missing providers, rejection, account/chain events, explicit network addition/switching, RPC/setup failures, wrong token decimals, failed reads, a wallet on another 31337 chain instance and separation of preview/live data. Existing route, responsive, dialog, draft and navigation checks remain in the suite.

The initial browser run had 99 passes and six fixture/selector failures (the mock failed to switch after network addition and an account selector also matched a closed dialog). Both were corrected without weakening behavior checks. Initial Turbopack builds exposed the NodeNext source-import mismatch, corrected with frontend aliases. A restricted-sandbox unit invocation failed at Node os.userInfo; rerunning outside that sandbox executed the tests. No Solidity change or dependency downgrade was used to pass checks.

## Manual MetaMask verification checklist

Actual MetaMask interaction has not been claimed as tested. With the persistent setup above:

1. Open the workspace in a browser with MetaMask or another injected wallet. Confirm the initial state is disconnected and there is no balance fabricated as zero.
2. Click Connect wallet, select the injected connector, reject once, and verify the rejection is shown without a connected balance. Retry and approve account access.
3. With a different wallet network active, confirm the network warning and unavailable balance. Click Switch to Hardhat Local; approve addition/switching in the wallet. Verify chain ID 31337 and RPC http://127.0.0.1:8545 in the wallet.
4. Confirm settings shows verified addresses, mUSD/6 and the actual account balance. A fresh account's zero balance is valid. Use the deployment's initial holder to inspect initial token supply without adding a faucet or transfer UI.
5. Change accounts in the wallet. Confirm the shortened/full addresses and balances update. Switch to an unsupported network; balances must disappear until switching back and revalidation.
6. Disconnect in TrustLayer, then reconnect. Also remove site access in the wallet and confirm provider disconnection clears data.
7. Stop the node while connected, click Refresh balance or wait for verification polling, and confirm failed/unavailable reads. Reset/redeploy/re-export/sync with the correct journal rules and verify old deployment metadata is rejected.
8. Confirm project creation/funding, approvals, juror staking and voting remain disabled. No signing or transaction request should occur from navigation or wallet connection.

## Known limitations and next dependencies

No real MetaMask manual walkthrough, hardware wallet, WalletConnect, mobile wallet deep link or public chain verification is included. Browser viewport tests run headless Chrome, not device hardware. Generic signing/transaction lifecycle is dependency-injected unit-tested; no real wallet signature or app transaction was submitted. Project/case data and recent activity are still preview-only; transaction indexing/history, private evidence and authenticated backend sessions remain deferred.

The frontend deliberately cannot use the checked-in ephemeral manifest until a fresh persistent deployment is exported. Generated public metadata must be resynced after re-export. Reads poll rather than subscribe to all contract events, so chain reset detection is periodic; future submit paths revalidate immediately. Full-array juror/history reads are not polled.

Production dependency audit reports zero vulnerabilities. Full audit retains the 14 high development-tool findings inherited from Phase 3A's unpatched picomatch advisory and the ESLint 9 support notice. See [Phase 3A limitations](PHASE3A.md); no forced framework downgrade or unsupported lint-peer override was applied.

After Phase 3B approval, Phase 3C can add real project/role adapters and separately reviewed transaction workflows using these hooks, with allowance/simulation/state/receipt handling. Backend/evidence authorization and event indexing remain separately scoped. Stop after Phase 3B review.

References: [Wagmi SSR](https://wagmi.sh/react/guides/ssr), [injected connector](https://wagmi.sh/react/api/connectors/injected), [Viem receipt tracking](https://viem.sh/docs/actions/public/waitForTransactionReceipt), [Turbopack aliases](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack).
