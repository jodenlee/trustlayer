# Phase 5 — integration and reliable local recovery

## 1. Architecture and integration

The unchanged Solidity 0.8.28 / Hardhat 3 protocol remains authoritative. Next.js/Wagmi/Viem handles wallet transactions; SIWE database sessions authenticate Node APIs; PostgreSQL stores deployment-scoped metadata; server-mediated private Supabase Storage holds exact-byte SHA-256 attachments. File contents and personal data remain off-chain. This phase adds local-node operations and integration hardening, without changing production Solidity, generated ABIs, economics, applied SQL migrations or hosted records.

Confirmed causes: a plain Hardhat process has volatile state; chain ID and deterministic contract addresses alone cannot identify a restored chain; repeated exports used the latest block and could change metadata scope; background deployment verification temporarily removed detail views; cached backend block numbers could reject a newly confirmed project during immediate metadata synchronization. MetaMask can also retain a nonce from a previous chain. These are separate from SIWE cookie persistence, which retains the Phase 4A restoration/security rules.

## 2. Persistence implementation

The installed Hardhat version is **3.22.0**. A disposable-node capability probe found `hardhat_metadata`, but rejected `hardhat_dumpState`, `hardhat_loadState`, `anvil_dumpState` and `anvil_loadState`. `evm_snapshot` IDs are not disk backups. Hardhat remains the compiler, test runner and Ignition deployment tooling.

The user approved an **optional Anvil backend on local chain 31337**. Windows x64 uses the pinned official `@foundry-rs/anvil-win32-amd64@1.7.1` binary; the generic npm wrapper's Unix-style postinstall failed on Windows. No existing dependency major version was upgraded. Other platforms must supply `ANVIL_BINARY` pointing to an explicitly installed compatible binary. `npm ci` installs the optional binary on Windows x64; omitting optional packages requires supplying `ANVIL_BINARY` yourself.

`scripts/local-chain.ts` starts only its own loopback node, refuses an occupied port or reused run name, and identifies every new chain with a random on-chain marker from development account 19. Node secrets are not printed. A backup contains Anvil's state including historical states, the chain marker, head, full binary version, a SHA-256 checksum of the envelope, and the verified deployment manifest when explicitly backed up/shut down. Backups use exclusive file creation and flush to disk. Pending **and nonce-gapped queued** transactions block export before and after the dump: the mempool is not part of a state snapshot. Loading checks integrity/version before starting and verifies the restored head/marker. Restoration never falls back to a fresh chain.

Anvil's [dump/load API](https://foundry-rs.github.io/foundry/anvil/eth/backend/mem/struct.Backend.html) and [historical-state support](https://foundry-rs.github.io/foundry/anvil/cmd/struct.NodeArgs.html) are verified here by an actual process restart, rather than assumed from snapshot IDs. Do not send cheat RPCs, impersonate users or alter storage/balances out of band on a managed development chain.

## 3. Windows startup commands

Run from the repository root. Do **not** stop a valuable existing Hardhat chain just to try these commands: its live state cannot be fully exported by the installed version. The running developer node was not migrated during implementation. Finish/export any needed historical records first; existing PostgreSQL/Storage records are retained.

For a clean checkout, install both package trees before verification (preserve your existing populated `.env.local`):

```powershell
npm.cmd ci
npm.cmd --prefix apps/web ci
npm.cmd run compile
```

For an intentional new chain, first archive any existing `packages/contracts/generated/deployments/31337.json` under a unique `.local-chain/archive/` filename. Use `Move-Item -LiteralPath ... -Destination ...` only after checking the destination does not exist. Preserve the matching Ignition journal as well. This is an explicit operator decision, not an automated reset.

```powershell
npm.cmd ci
npm.cmd run compile
npm.cmd run chain -- fresh --name dev1
```

The foreground terminal prints **NEW**, its random identity and session-file path. In another root terminal:

```powershell
$env:LOCAL_RPC_URL = 'http://127.0.0.1:8545'
$env:TRUSTLAYER_DEPLOYMENT_ID = 'phase5-dev1'
$env:TRUSTLAYER_CHAIN_SESSION = '.local-chain/runs/dev1/session.json'
npx.cmd hardhat ignition deploy ignition/modules/Phase2D.ts --network localhost --deployment-id phase5-dev1
npm.cmd run export:contracts
npm.cmd --prefix apps/web run contracts:sync
npm.cmd run chain -- status --name dev1
npm.cmd run web:dev
```

Choose new names for each genuinely new chain. A restore does not require redeployment. Default RPC remains exactly `http://127.0.0.1:8545`, chain ID 31337, regardless of the wallet network's display name.

## 4. Backup, shutdown and restore

Pause wallet activity, confirm pending receipts, then create an explicit uniquely named checkpoint:

```powershell
npm.cmd run chain -- backup --name dev1 --output .local-chain/backups/dev1-before-shutdown.json
```

Press **Ctrl+C once in the managed node terminal**. The controller writes another unique backup before stopping its owned child. Windows starts the child in a separate hidden process group so Ctrl+C reaches the controller first. A backup failure leaves the node running and prints a diagnostic; resolve it and retry. Do not forcibly close the terminal before the backup message. Every minute, an immutable state checkpoint also reduces crash exposure; periodic checkpoints contain chain state but do not replace the separate deployment export. Failed checkpoints are reported. The last successful checkpoint determines recoverable progress.

After port 8545 is free, select the latest known-good checkpoint that includes the actions recorded by PostgreSQL/Storage. A chain backup does not roll those services back. **Do not resume writes from an older checkpoint while off-chain records refer to later projects, disputes or receipts**: restored numeric IDs/nonces can be reused. First reconcile against the later records or recover a newer checkpoint. If that cannot be established safely, keep the historical records and explicitly initialize a new deployment scope instead. Automatic reconciliation of an arbitrary old chain snapshot with a newer hosted database is not implemented.

```powershell
npm.cmd run chain -- restore --name dev1-restored --backup .local-chain/backups/dev1-before-shutdown.json
```

The terminal must print **RESTORED** with the original identity. In another terminal:

```powershell
$env:TRUSTLAYER_CHAIN_SESSION = '.local-chain/runs/dev1-restored/session.json'
npm.cmd run chain -- status --name dev1-restored
npm.cmd --prefix apps/web run contracts:sync
```

Keep the existing verified manifest. Explicit backups include a manifest copy for manual recovery if the original was lost; restoration never overwrites the current file. A checksum/version/head/marker error stops recovery. Select a different known-good backup; never edit a checksum or manufacture an anchor to bypass it. Backups and run files stay ignored in `.local-chain/`; copy them and the Ignition journal to your own safe local storage. They are development artifacts, not production secrets or a Supabase backup.

If the controller crashes while its hidden child survives, the recorded session `nodePid` assists operator inspection. Use `status` and `backup` against that session, verify the process identity, then stop that specific process manually. The controller never kills a process merely because it occupies a port.

## 5. Fresh-chain and legacy recovery

A genuinely new chain invalidates old anchors, transactions and MetaMask pending activity. Historical PostgreSQL rows and Storage objects stay in their original deployment scope; they are never deleted or rebound to a reused project ID. Restore the correct backup to resume those projects. A new chain needs a unique Ignition deployment ID, fresh verified export and explicit public metadata synchronization.

There is no lossless migration path from the already-running Hardhat process in this installed version. The optional Anvil workflow protects **future managed-chain state**; it does not reconstruct past storage, transactions or nonces from event logs or metadata.

To keep using the **same running Hardhat node** and upgrade a legacy unbound export without changing the PostgreSQL scope:

1. Move its existing export to a checked, unique archive filename. Do not redeploy or reset.
2. Set `TRUSTLAYER_ANCHOR_MANIFEST` to that archived file and `TRUSTLAYER_DEPLOYMENT_ID` to its existing Ignition ID. Remove `TRUSTLAYER_CHAIN_SESSION` from the shell for Hardhat.
3. Run `npm.cmd run export:contracts`. It verifies the archived anchor and exact contracts, preserves `verifiedBlock`, and adds the current `hardhat_metadata.instanceId` binding. If validation fails, stop and investigate; do not substitute another anchor.
4. Remove `TRUSTLAYER_ANCHOR_MANIFEST` and synchronize frontend metadata. Hardhat instance bindings intentionally expire on restart; they do not provide persistence.

Exact commands for that same-running-node legacy upgrade (not a reset or redeployment):

```powershell
$phase5Source = (Resolve-Path 'packages/contracts/generated/deployments/31337.json').Path
$phase5Legacy = Get-Content -LiteralPath $phase5Source -Raw | ConvertFrom-Json
$phase5ArchiveDirectory = Join-Path (Get-Location).Path '.local-chain/archive'
New-Item -ItemType Directory -Path $phase5ArchiveDirectory -Force | Out-Null
$phase5Archive = Join-Path $phase5ArchiveDirectory ('31337-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + '.json')
if (Test-Path -LiteralPath $phase5Archive) { throw 'Archive already exists; nothing overwritten.' }
Move-Item -LiteralPath $phase5Source -Destination $phase5Archive
$env:LOCAL_RPC_URL = 'http://127.0.0.1:8545'
$env:TRUSTLAYER_DEPLOYMENT_ID = $phase5Legacy.deploymentId
$env:TRUSTLAYER_ANCHOR_MANIFEST = $phase5Archive
Remove-Item Env:TRUSTLAYER_CHAIN_SESSION -ErrorAction SilentlyContinue
Remove-Item Env:TRUSTLAYER_EXPORT_EPHEMERAL -ErrorAction SilentlyContinue
Remove-Item Env:TRUSTLAYER_EXPORT_PATH -ErrorAction SilentlyContinue
try {
  npm.cmd run export:contracts
  if ($LASTEXITCODE -ne 0) { throw 'Export failed. The original remains archived; investigate without resetting.' }
} finally {
  Remove-Item Env:TRUSTLAYER_ANCHOR_MANIFEST -ErrorAction SilentlyContinue
}
npm.cmd --prefix apps/web run contracts:sync
```

After a **confirmed genuine reset**, check the chain identity and pending receipts first. In MetaMask, choose the development account and local network, then use its Settings → Advanced → Clear activity and nonce data option (wording may vary by version). This changes wallet-local activity only. Never clear it to justify resending a transaction whose receipt is uncertain. No private key or seed phrase is needed. The app now gives this diagnostic for nonce-too-low/high/used errors without printing raw RPC details.

## 6. Deployment identity

All live frontend/backend validation requires a bound export: a managed random chain marker or a legacy Hardhat process instance. It additionally checks chain ID, anchored block hash, every deployed runtime hash and generated ABI identity. RPC and wallet are verified separately before writes. Exporting again on the same chain keeps the original `verifiedBlock`; it never silently changes the PostgreSQL deployment scope. Existing mismatched exports fail rather than being overwritten. `TRUSTLAYER_EXPORT_PATH` gives isolated verification an independent output path.

`verify:local` uses two disposable Hardhat nodes on port 18545, separate manifests, and checks distinct process IDs, stale-instance rejection, bytecode/configuration and idempotent Ignition resume. It no longer overwrites the active development export.

During background verification, the same wallet/deployment's last verified read-only view remains mounted. Transaction actions pause; the controller still verifies fresh chain/wallet/state at submission. Verification failure, actual disconnect or identity change hides stale views. Draft/file inputs are not remounted merely because another background check started.

## 7. Explicit wallet provisioning

The existing fixed-supply MockUSD contract has **no public mint**. The utility verifies runtime/ABI, six decimals, fixed supply and original mint event, then transfers existing supply from its unlocked local development holder. Native ETH also comes from that account through ordinary confirmed transactions; no real keys or balance setters are used.

```powershell
$env:TRUSTLAYER_CLIENT = '0xd8803e8051256a79a3CfbBA97fB67D2F2858acCe'
$env:TRUSTLAYER_FREELANCER = '0x13AF32fD02048d8d2De555297FFbA31FfFdb17fF'
$env:TRUSTLAYER_JUROR_1 = '0xE3797880e51C4Ad27D439e8F682fAdD44bb172Ce'
$env:TRUSTLAYER_JUROR_2 = '0x3032Bb22FEb242Da4EB7d3aB55025B867EA07060'
$env:TRUSTLAYER_JUROR_3 = '0xdA13D5BD1A07F0864e7c9728BdFE793c88F66d16'
$env:TRUSTLAYER_ETH_TARGET = '10'
npm.cmd run provision:wallets
```

Default mUSD targets: client 2,000; freelancer 100; three jurors 200 each. For larger integration runs, set exact decimal targets such as `$env:TRUSTLAYER_CLIENT_MUSD='5000.000001'`; each of the five address-variable names accepts `_MUSD` and `_ETH` suffixes. Per-wallet `_ETH` overrides the shared ETH target. Tokens allow at most six fractional digits, ETH eighteen. Only five explicit distinct nonzero addresses are accepted; contract recipients are refused for native funding. Endpoint must be exactly uncredentialed IPv4 loopback port 8545 and manifest/runtime/chain checks must pass. Targets are top-ups, so satisfied wallets cause no transfer. Logs show submitted hashes, receipts and real balances. Insufficient token/native funds and pending source transactions stop safely; check any unresolved hash before retrying. This command has **not** been run against the user's current wallets in Phase 5.

## 8. Full workflow demonstration

Use the same exact browser origin for every account. Each account connects independently and explicitly signs SIWE; wallet reconnection never triggers an automatic signature.

1. Client creates a project, waits for the canonical receipt, and separately saves metadata. If synchronization fails, retry metadata; never recreate the confirmed project. Approve exact mUSD allowance, then fund escrow.
2. Freelancer signs in, accepts, uploads a private deliverable, checks its SHA-256 and submits that hash on-chain. Associate only the confirmed canonical submission receipt.
3. Client downloads/verifies the bytes and either approves the normal 99% net payment / 1% fee, or uploads opening evidence, approves 15 mUSD and opens a dispute.
4. Counterparty uploads/responds strictly before the 12-hour response deadline. Assigned jurors alone gain case read access alongside the participants. Supplemental evidence is append-only before the response deadline.
5. Jurors vote from the response deadline through the voting deadline, 24 hours later. Finalize strictly after that deadline. Two matching votes determine freelancer/client/split; no majority gives the documented 50/50 fallback. Finalization settles once and unlocks stakes.
6. Each assigned juror, including an abstainer, claims 4 mUSD once. The remaining 3 mUSD opening fee goes to treasury. Escrow principal and minimum 100 mUSD per-assignment juror collateral remain separately accounted for.

The extended file integration script executes normal approval, freelancer victory, client victory, split majority and fallback using actual production contracts, SIWE signatures, isolated migrated SQL and a private in-memory Storage adapter. It verifies exact payouts/rewards, outsider rejection, deadline enforcement, retained attachments and idempotent associations. Injected SQL unavailability after a confirmed creation exercises recovery without a second chain action. The other three integration scripts retain transaction-controller and complete accounting coverage.

## 9. Database and Storage configuration

Existing `.env.local` and hosted records were not changed. Keep `trustlayer` unexposed to browser roles. Custom SIWE cookies do not authenticate Supabase RLS. Keep the bucket private and service-role credentials server-only; preserve TLS certificate verification. Migrations remain checksummed and additive. Do not edit applied migrations or reset the database.

The safe runtime-role transition is **manual** because creating credentials and changing the working hosted URI is an operator action. With a database-owner connection, inspect for existing roles first. For a new runtime login, use an interactive `psql` session:

```sql
CREATE ROLE trustlayer_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT trustlayer_server TO trustlayer_app;
```

Use `\password trustlayer_app` interactively; never put an actual password in source, a command argument or SQL history. Copy the Session Pooler URI for the new login (hosted username shape `trustlayer_app.PROJECT_REF`), database `postgres`, port 5432. URL-encode the password. Retain the owner URI separately as `DATABASE_MIGRATION_URL` for explicit migrations only.

Test the candidate runtime URI in a separate PowerShell process by supplying its `DATABASE_URL` through a secure local configuration mechanism, then run:

```powershell
npm.cmd --prefix apps/web run db:runtime:check
```

This uses **BEGIN READ ONLY**, `SELECT 1` and catalog/privilege checks. It checks both the actual session login and effective role: restricted memberships, no superuser/bypass/role/database creation, no schema/table ownership through any reachable role, schema usage and required table permissions. An owner connection hidden behind `SET ROLE` must fail. It prints no connection strings or role identifiers, and safe error guidance never recommends replacing the runtime URI with owner credentials. Only after this and an authenticated application smoke test succeed should the operator replace the working runtime `DATABASE_URL` and restart Next.js. Owner credentials must remain outside runtime deployment configuration in production. The existing hosted connection passed `SELECT 1` but failed restricted-runtime readiness; credentials/roles remain unchanged.

## 10. Security review

Preserved controls include durable single-use SIWE nonces, database-backed expiring opaque sessions, exact Origin on writes, HttpOnly/SameSite cookies, production HTTPS/Secure cookies, wallet-switch invalidation, deployment/receipt/participant/juror validation, bounded scans, SQL parameters, metadata revisions, idempotency keys, upload limits/rate budgets, exact-byte server/client hashing, private downloads, safe error categories and retained evidence. Authorization project/dispute reads now disable the block-number cache, preventing stale post-receipt authority checks. Background cached views never authorize a write.

No governance, reputation, penalties, financial authority in metadata or automatic node/network migration was added. The current broad owner runtime login remains a documented deployment blocker until the manual role transition passes. This is not a contract audit.

## 11. Automated verification

Final results are recorded below after execution. All SQL/API/browser fixtures are isolated from hosted Supabase; the separate hosted checks were read-only. Run Hardhat operations sequentially. Browser tests use production Next.js on port 3001, preserving port 3000. Actual MetaMask manual testing is separate.

<!-- PHASE5_RESULTS -->

Verification environment: Windows PowerShell, Node.js 25.6.1, Hardhat 3.22.0, Anvil 1.7.1 and installed Chrome. Node 22.13+ remains the repository recommendation; compiler/dependency major versions were not changed.

| Command/check                                                                  | Verified result                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm.cmd run compile`                                                          | Exit 0; **16 Solidity files compiled with solc 0.8.28**, EVM target Cancun                                                                                                                                                                                                                                         |
| `npm.cmd test`                                                                 | 187 passing Node.js blockchain tests                                                                                                                                                                                                                                                                               |
| `npm.cmd --prefix apps/web run test:unit`                                      | 247 passed, 0 failed/skipped                                                                                                                                                                                                                                                                                       |
| `npm.cmd run typecheck`                                                        | Exit 0                                                                                                                                                                                                                                                                                                             |
| `npm.cmd --prefix apps/web run typecheck`                                      | Exit 0; route generation and TypeScript                                                                                                                                                                                                                                                                            |
| `npm.cmd --prefix apps/web run lint`                                           | Exit 0; zero warnings                                                                                                                                                                                                                                                                                              |
| `npm.cmd --prefix apps/web run build`                                          | Exit 0; production build/routes generated                                                                                                                                                                                                                                                                          |
| `npm.cmd run verify:local`                                                     | Two owned CLI nodes/deployments, idempotent resumes, distinct Hardhat identities and rejected stale instance; active export untouched                                                                                                                                                                              |
| `npm.cmd run verify:persistence`                                               | Exit 0: actual restart, historical code/balance reads, project/milestone storage, open dispute, 300 mUSD locked collateral, 15 mUSD fee, balances/nonces, blocks/receipts/events, SIWE/profile/SQL/private bytes and post-restart payment. Five CLI misuse guards and actual nonce-gapped mempool rejection passed |
| Four `npx.cmd hardhat run apps/web/scripts/verify-*.ts` integrations           | Escrow, arbitration, backend and files all passed; exact scripts below                                                                                                                                                                                                                                             |
| Targeted tablet browser regression                                             | 3 passed: mounted drafts, metadata refresh and private upload                                                                                                                                                                                                                                                      |
| Account-switch/upload teardown regression                                      | 15 passed: five repetitions on each viewport                                                                                                                                                                                                                                                                       |
| Full browser suite                                                             | **342 passed in 7.0 minutes**, desktop/tablet/mobile, npm exit 0                                                                                                                                                                                                                                                   |
| Hosted `db:runtime:check`                                                      | `SELECT 1` passed; restricted-runtime readiness failed (expected unresolved operator configuration), exit 1                                                                                                                                                                                                        |
| Hosted migration history, read-only                                            | Both repository migrations applied; checksums match; no SQL changes                                                                                                                                                                                                                                                |
| `npm.cmd --prefix apps/web run format:check`, four new root local-tool modules | Passed; all matched files use Prettier style                                                                                                                                                                                                                                                                       |
| `git diff --check`                                                             | Passed; no whitespace errors                                                                                                                                                                                                                                                                                       |

Full browser command:

```powershell
$env:PLAYWRIGHT_PORT='3001'
$env:PLAYWRIGHT_CHANNEL='chrome'
npm.cmd --prefix apps/web test
```

The four sequential actual-contract integration commands are:

```powershell
npx.cmd hardhat run apps/web/scripts/verify-escrow-workflow.ts
npx.cmd hardhat run apps/web/scripts/verify-arbitration-workflow.ts
npx.cmd hardhat run apps/web/scripts/verify-backend-workflow.ts
npx.cmd hardhat run apps/web/scripts/verify-files-workflow.ts
```

Initial verification caught the cached authorization head, reused test log arrays, and isolated HTTP transport/teardown races. The API fixture now closes individual HTTP connections; tests stop app polling on `about:blank` and drain route handlers before closing their isolated server. Fixes retain all existing assertions, timeouts and production authentication behavior. Early browser attempts were stopped after failures; the final complete rerun passed. Runtime-role regressions use independent SQL sessions for simulated logins, including owner `SET ROLE` and privileged-membership rejection. The persistence integration lives in the existing frontend TypeScript project so its backend imports use that project's module resolution; compiler settings were not relaxed. PowerShell log redirection labeled ordinary Node color warnings as `NativeCommandError` and the outer wrapper reported 1; the final full run separately captured **npm exit 0** in `.local-chain/browser-full.exit` and **342 passed** in its complete log. Logs/snapshots stay in ignored `.local-chain/`; the CLI deployment report is `reports/phase2e/verification.json`. No production Solidity, compiler configuration, generated ABIs, active deployment export or applied SQL migration changed. No commit, push or public deployment was performed.

<!-- /PHASE5_RESULTS -->

<!-- PHASE5_FILES -->

Changed files (42); generated production ABIs, the active deployment export, Solidity and SQL migrations remain unchanged.

| Status   | File                                                   |
| -------- | ------------------------------------------------------ |
| Modified | `.gitignore`                                           |
| Modified | `AGENTS.md`                                            |
| Modified | `apps/web/.env.example`                                |
| Modified | `apps/web/package.json`                                |
| Created  | `apps/web/scripts/db-runtime-check.ts`                 |
| Created  | `apps/web/scripts/lib/runtime-permissions.ts`          |
| Created  | `apps/web/scripts/verify-chain-persistence.ts`         |
| Modified | `apps/web/scripts/verify-files-workflow.ts`            |
| Modified | `apps/web/src/components/chain-dispute-detail.tsx`     |
| Modified | `apps/web/src/components/chain-disputes.tsx`           |
| Modified | `apps/web/src/components/chain-history.tsx`            |
| Modified | `apps/web/src/components/chain-project-detail.tsx`     |
| Modified | `apps/web/src/components/chain-projects.tsx`           |
| Modified | `apps/web/src/components/project-arbitration.tsx`      |
| Modified | `apps/web/src/lib/blockchain/deployment.ts`            |
| Modified | `apps/web/src/lib/blockchain/errors.ts`                |
| Modified | `apps/web/src/lib/blockchain/hooks/use-arbitration.ts` |
| Modified | `apps/web/src/lib/blockchain/hooks/use-projects.ts`    |
| Modified | `apps/web/src/lib/blockchain/hooks/use-protocol.ts`    |
| Modified | `apps/web/src/lib/server/chain.ts`                     |
| Modified | `apps/web/test-support/auth-backend.ts`                |
| Modified | `apps/web/test-support/protocol.ts`                    |
| Modified | `apps/web/tests/auth-persistence.spec.ts`              |
| Modified | `apps/web/tests/files.spec.ts`                         |
| Modified | `apps/web/unit/blockchain.test.ts`                     |
| Created  | `apps/web/unit/runtime-permissions.test.ts`            |
| Created  | `docs/PHASE5.md`                                       |
| Modified | `docs/PHASES.md`                                       |
| Modified | `package-lock.json`                                    |
| Modified | `package.json`                                         |
| Modified | `packages/contracts/src/index.ts`                      |
| Modified | `README.md`                                            |
| Modified | `reports/phase2e/verification.json`                    |
| Modified | `scripts/export-contracts.ts`                          |
| Created  | `scripts/lib/local-chain.ts`                           |
| Created  | `scripts/lib/manifest-output.ts`                       |
| Modified | `scripts/lib/provisioning.ts`                          |
| Created  | `scripts/local-chain.ts`                               |
| Modified | `scripts/provision-local-tokens.ts`                    |
| Created  | `scripts/provision-local-wallets.ts`                   |
| Modified | `scripts/verify-local-deployment.ts`                   |
| Modified | `test/LocalTokenProvisioning.ts`                       |

<!-- /PHASE5_FILES -->

## 12. Manual verification checklist

- Keep the running Hardhat chain if it contains needed work. Decide explicitly when to start a new managed chain.
- Verify the bound export, sync it, and check matching RPC/wallet identities; stale exports must block access/writes.
- Provision the five public addresses and inspect actual hashes/balances. Repeat: no top-up transaction should be sent when targets are satisfied.
- Perform the workflow in section 8 in MetaMask, including account switches and page refresh with valid SIWE/profile state.
- Select a file and edit metadata while background checks run. Inputs must stay mounted; a genuine mismatch must hide the stale view.
- Pause activity, back up, shut down, restore, and confirm projects, balances, metadata, attachments, nonce continuity and receipt history before sending another action.
- Check expired sessions, rejected signatures, failed uploads and SQL synchronization recovery without duplicate transactions.
- Complete and verify the manual runtime-role transition before any deployment-readiness claim.

## 13. Limitations

Checkpoint persistence is explicit recovery, not a replicated transactional database or zero-loss crash guarantee. An abrupt machine crash can lose activity after the last successful backup. Hardhat's existing volatile chain cannot be migrated losslessly by these installed APIs. Anvil snapshots require the recorded compatible binary; cross-version/OS restoration is not claimed. Immutable historical-state backups grow with use; retention/deletion is an explicit operator choice. Do not run wallet writes during backup.

The optional backend switch and actual MetaMask workflow remain manual; automated browser tests use test-only injected wallets, and EVM scripts use isolated private byte storage rather than hosted Storage. Hardhat process-binding verification also requires a wallet provider that forwards `hardhat_metadata`; unsupported providers fail closed, and actual MetaMask forwarding has not been manually verified here. Managed Anvil anchors use standard block reads. Stored deadlines remain unchanged after restoration; check the latest chain time and elapsed response/review windows before acting. No hosted credential/role migration, public deployment or existing data rewrite was performed. Malware scanning, end-to-end encryption, external audit, production monitoring and operational backup policy are not implemented.

## 14. Remaining deployment-readiness tasks

Review Phase 5, perform the manual checklist, verify the restricted hosted runtime login, and decide an operational backup/restore retention policy. Run an independent security audit and production-specific rate limiting/monitoring review before handling real assets. Sepolia or any subsequent work needs explicit approval. Stop after Phase 5.
