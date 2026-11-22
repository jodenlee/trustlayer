# Phase 4A - Backend foundation and wallet authentication

## Scope and architecture

Next.js Node.js route handlers in `apps/web/src/app/api` call shared services in `apps/web/src/lib/server`. There is no separate backend deployment, Supabase Auth JWT, service-role API key or browser-to-database client. The server uses `pg` to connect to Supabase PostgreSQL (direct or session-pooler connection). All SQL values are parameterized. `server-only` prevents the credential-bearing runtime from entering client bundles. Zod validates API input and rejects unknown properties.

Blockchain contracts remain authoritative for participants, ownership, funds, deadlines, milestones, dispute outcomes, collateral and fees. The database stores descriptions and identity metadata only; there are no editable balance, payout, vote or settlement fields. Production Solidity, economics, deployment modules and generated ABIs are unchanged.

The existing memory-only project creation descriptions, inputs, review dialogs and uncertain transaction records remain in place. This phase exposes persistence APIs; it does **not** silently save or replace project drafts. Backend profile editing is integrated separately in Settings. Private evidence uploads, backend indexing, reputation, governance, refund/treasury UI and Phase 4B are not implemented.

## Schema and relationships

Migration: `supabase/migrations/202611190001_phase4a.sql`.

| Table in private `trustlayer` schema | Purpose / identifiers |
| --- | --- |
| `profiles` | Lowercase unique wallet primary key, display name, optional biography, created/updated timestamps. A profile is created after successful SIWE. |
| `deployments` | Chain ID, escrow/arbitration addresses, verification block number/hash; unique chain + escrow + anchor hash. |
| `projects` | Deployment FK + exact numeric uint256 project ID, title/description, on-chain-verified client/freelancer wallets, timestamps; unique deployment + project ID. |
| `milestones` | Project FK + zero-based index 0-4, description, bounded optional non-sensitive JSON object, timestamps; unique project + index. |
| `submissions` | Milestone FK, bounded submission reference/hash and optional non-sensitive notes, creation timestamp. Foundation only; no submission API/upload. |
| `disputes` | Deployment + chain + arbitration, uint256 dispute ID, project/milestone FKs, non-sensitive description and timestamp. Composite FKs prevent crossing projects or deployments. Foundation only; no dispute metadata API. |
| `auth_nonces` | SHA-256 challenge/nonce hashes, exact SIWE message, wallet, issue/expiration/consumption timestamps. The SIWE message itself contains its public nonce. |
| `auth_sessions` | SHA-256 bearer-token hash, wallet profile FK, chain, creation/expiration. Raw session tokens are never stored in PostgreSQL. |
| `auth_rate_limits` | Hashed bucket, window start and request count for cross-instance limits. |

Wallet addresses are validated with Viem checksum rules at the API boundary and normalized to lowercase. SQL constraints reject non-normalized/zero addresses. On-chain identifiers use exact bounded numeric values; JSON/API IDs remain canonical decimal strings, never JavaScript floating-point numbers. UUIDs identify off-chain rows. Foreign-key lookup indexes, participant indexes and expiration indexes are included. Update triggers maintain timestamps. No private file contents, keys, seed phrases or token balances are stored.

## Authentication sequence

1. Wallet connection remains the existing explicit Wagmi/MetaMask flow. Connecting does not sign in or sign a message.
2. `POST /api/auth/nonce` accepts a valid address and chain 31337. The server creates separate 32-byte cryptographic nonce and browser challenge tokens. A five-minute SIWE message is built with Viem from the configured origin, domain, checksum wallet, chain, issue time and expiration. The challenge is an HttpOnly cookie; the durable challenge row is in PostgreSQL.
3. The user explicitly selects **Sign in with Ethereum** and approves `personal_sign`. No transaction or token allowance is requested.
4. `POST /api/auth/verify` requires the challenge cookie and exact original message. The server checks every bound SIWE field and verifies the EOA signature using Viem. A conditional single-use nonce update and session insertion occur in one transaction; concurrent verifications cannot both succeed. Reauthentication rotates the browser's existing session.
5. A random 32-byte opaque session token is sent only as an HttpOnly, `SameSite=Strict`, path `/` cookie. Production uses `Secure` and the `__Host-` prefix. Sessions expire after eight hours; there is no refresh-token extension. `GET /api/auth/session` rechecks the durable row and expiration. Logout deletes the session and pending challenge and expires both cookies.
6. The frontend immediately hides auth/profile data when wallet or chain changes. It requests server logout for the old scope and checks sessions on focus/every 30 seconds. The signing path checks the current wallet before signing and before/after verification; a late old-account session is revoked. Logout errors remain visible and must be retried.

This phase supports externally owned wallets, including local MetaMask. EIP-1271 contract wallets and alternative chains are intentionally unsupported; the server does not simulate arbitrary contract signatures. Domain and URI are never derived from untrusted Host/forwarded headers.

### Wallet and SIWE refresh persistence fix (2026-11-20)

The refresh bug had two frontend causes: `BlockchainProvider` explicitly set Wagmi `reconnectOnMount={false}`, and `AuthProvider` returned before fetching `/api/auth/session` whenever its wallet scope was disconnected. Thus refresh discarded the visible wallet connection and made an existing durable backend session inaccessible in the UI. This did not demonstrate that the database session or cookie had expired. The original provider also compared sessions without distinguishing the temporary connecting/reconnecting state, which could revoke a valid session during restoration if reconnection alone were enabled.

The approved fix enables Wagmi's existing reconnect-on-mount path while retaining `ssr:true` and the per-app stable configuration. Wagmi's normal storage persists non-secret connector/account hints and disconnect markers; MetaMask still owns wallet authorization. Reconnection checks existing authorization/accounts and does not call `personal_sign`, request a transaction or prompt for a signature. No SIWE token is put in localStorage/sessionStorage. See [Wagmi SSR](https://wagmi.sh/react/guides/ssr) and [WagmiProvider reconnection](https://wagmi.sh/react/api/WagmiProvider).

Backend session discovery now runs on initialization, even before a wallet restores. Connecting/reconnecting is an explicit restoration scope, shown as **Restoring wallet** / **Checking backend session**. Identity comparison waits for a settled connection. A valid matching wallet/session restores the authenticated UI and fetches its saved profile; it does not renew the eight-hour session or sign again. Initially disconnected or unavailable wallets hide the private profile while preserving a potentially valid HttpOnly cookie. A confirmed change from an established account, chain change or explicit wallet disconnect revokes the previous session. Deferred revocation survives signing/busy transitions; stale fetches cannot display an older identity. Explicit backend logout remains independent of wallet connection and survives refresh. Failed session API reads hide private data, retain the cookie and display an error; successful focus/poll recovery clears that read error.

Cookie and API security are unchanged:

| Setting | Local HTTP development | Production HTTPS |
| --- | --- | --- |
| Name | `tl_session` | `__Host-tl_session` |
| HttpOnly / Path | Enabled / `/` | Enabled / `/` |
| SameSite | Strict | Strict |
| Secure | Disabled for `next dev` on the configured loopback HTTP origin | Enabled; production configuration requires HTTPS |
| Domain | Omitted (host-only) | Omitted (required by `__Host-`) |
| Expiration | Cookie Max-Age 28,800 seconds; database expiration always checked | Same eight-hour policy |

All auth fetches already use `credentials:"same-origin"` and `cache:"no-store"`. `/api/auth/session` validates the opaque token hash and expiration against PostgreSQL on each request; expired sessions clear the cookie. A slightly later browser cookie expiry due to response transit cannot extend database authorization. Server Origin checks, nonce replay protection, TLS verification, authorization and production Secure cookie settings were not loosened. The configured development origin was verified as `http://127.0.0.1:3000`; `localhost`, a different port or HTTPS is a different origin and may require separate connection/sign-in. Keep `AUTH_ORIGIN` aligned with the browser address.

Files changed by this fix: `apps/web/src/components/blockchain-provider.tsx`, `auth-provider.tsx`, `wallet.tsx`; `apps/web/tests/wallet-fixture.ts`, `wallet.spec.ts`, `escrow.spec.ts`, `workspace.spec.ts`; `apps/web/playwright.config.ts`; `apps/web/unit/backend.test.ts`; this document. Created: `apps/web/test-support/auth-backend.ts` and `apps/web/tests/auth-persistence.spec.ts`. The test wallet persists only test authorization/account flags when explicitly enabled. The new HTTP bridge uses the actual production SIWE handlers, HttpOnly cookies, signatures and SQL in isolated PGlite databases. It is test-only; production code has no authentication bypass. The Playwright-owned server has empty database URLs so it never accesses the developer's hosted database. Assertions in three existing tests were scoped to the visible main region to avoid matching Next.js' hidden streamed content; their exact balance/metadata/ruling expectations remain intact.

Manual verification on the existing deployed/migrated setup:

1. Keep the existing Supabase data, local blockchain and deployment export. No migration/reset is needed for this fix. Run `npm.cmd run web:dev`, open exactly `http://127.0.0.1:3000/settings`, and check that AUTH_ORIGIN matches.
2. Connect MetaMask explicitly once and select **Sign in with Ethereum**. Approve the message, save a non-sensitive backend display name, and verify **Backend authenticated**.
3. Refresh the page. Allow the restoration indicators to finish. The same wallet, authenticated state and saved profile should return without a signature prompt. In browser developer tools, check HttpOnly, Strict, Path `/`, the expected eight-hour cookie lifetime and absence of Secure only in local HTTP development; do not copy the token into shared logs.
4. Change the account in MetaMask. The old profile must disappear, the old backend identity must be revoked and the new wallet must sign in explicitly. Repeat a refresh after changing accounts while the page was closed to verify mismatch handling.
5. Sign out of the backend and refresh: MetaMask may reconnect, but backend authentication stays signed out. Sign in again, then explicitly disconnect the wallet: profile access disappears and refresh must respect Wagmi's disconnect marker.
6. With the wallet temporarily locked/unavailable, refresh: private profile content must stay hidden and restoration must not automatically request a signature. Reconnect/unlock the same authorized wallet to recover a still-valid server session. If the session expired, sign in again.
7. Use test environments to simulate session expiry, wrong origin or API outage; do not delete/edit hosted session rows merely for this test. Verify an unavailable API shows an error and hides profile data, then restores a valid session after recovery/focus.

Verification for this fix (2026-11-20):

| Command / check | Result |
| --- | --- |
| `npm.cmd run compile` | Exit 0; no contracts to compile. |
| `npm.cmd test` | Exit 0; **182 passing** blockchain/provisioning tests. |
| `npm.cmd run typecheck` | Exit 0. |
| `npm.cmd --prefix apps/web run test:unit` | Exit 0; **193 passed, 0 failed** (191 prior tests plus two explicit HTTP/HTTPS database-session cookie restoration/expiry checks). |
| Existing escrow/arbitration/backend `verify-*-workflow.ts` scripts via `npx.cmd hardhat run` | All three exit 0 on owned isolated EVM/database instances. |
| `npm.cmd run web:typecheck` / `npm.cmd run web:lint` | Exit 0; no TypeScript errors or lint warnings. |
| `npm.cmd --prefix apps/web run build` | Exit 0; optimized production build and generated route/type checks passed. |
| `npm.cmd --prefix apps/web run format:check` / `git diff --check` | Passed. |
| Focused desktop auth/persistence browser suite | **17 passed (23.3 seconds)** after fixing isolated test-server teardown ordering. |
| `$env:PLAYWRIGHT_PORT='3001'; $env:PLAYWRIGHT_CHANNEL='chrome'; npm.cmd run web:test` | Exit 0; **303 passed (6.0 minutes)** across desktop/tablet/mobile, including all 273 prior checks plus 30 new refresh-persistence checks. |

The first focused run had 16 passes and one teardown failure caused by closing the isolated HTTP bridge before a profile read finished. Waiting for pending test routes before closing the bridge resolved it; no production behavior or existing assertion was removed. The first full run had 300 passes and three existing text-selector failures that matched both visible and hidden Next.js streamed content. Those assertions now target the visible main region with their expectations unchanged; the full suite was rerun. Expected injected backend failures emit sanitized test logs. Browser tests use test-only injected providers, not actual MetaMask or hosted Supabase sessions.

The developer reports the hosted Phase 4A migration is now applied. This task does not reapply migrations or mutate hosted data. Remaining limits: restoration depends on the injected wallet, existing authorization, unlocked-account availability and browser storage; cleared permissions/storage, a different origin/browser, expired database sessions or an unavailable backend can require explicit connection/sign-in. No actual new manual MetaMask run is claimed by automated injected-provider tests. Existing transaction drafts/uncertain receipts remain memory-only and are not restored by this wallet/session fix. No Phase 4B work is included.

Reference: [EIP-4361](https://eips.ethereum.org/EIPS/eip-4361), [Viem SIWE message creation](https://viem.sh/docs/siwe/utilities/createSiweMessage).

## Authorization and deployment identity

- Only an authenticated session's wallet may read/update its own profile. A submitted wallet/user ID cannot select another profile.
- Both project participants may read/update project and milestone descriptions. The request supplies chain ID, escrow address and deployment block hash; these must match the active server manifest. On **every** metadata read/write the server loads the public export, verifies live RPC chain/block/runtime identity and reads actual participants/milestone count at a pinned current block. Browser-supplied participant fields are rejected.
- The server uses the existing generated ABIs from `@trustlayer/contracts`, not duplicate ABIs. RPC is fixed to `http://127.0.0.1:8545`; there is no client-supplied arbitrary RPC or contract target. The server must run beside that local node for this phase.
- Reusable milestone authorization checks the actual project and index. Reusable dispute authorization checks the actual arbitration dispute and permits client, freelancer and its assigned jurors. These are foundations for later endpoints, not evidence file access grants. Phase 4B must define and test file/object-specific rules before enabling storage.
- Current project API reads return milestone descriptions too; outsiders and unrelated jurors cannot access these project descriptions. Dispute-specific access does not grant access to unrelated projects.

All private tables enable RLS with policies only for the unprivileged `trustlayer_server` role. PUBLIC has no private-schema/table access. Use a dedicated application login granted membership in that role, with no owner, superuser or BYPASSRLS privileges. Do not expose `trustlayer` in Supabase Data API schemas and do not grant it to `anon` or `authenticated`. Custom SIWE cookies are **not** Supabase RLS identities: wallet isolation is explicitly implemented and tested in the server service. RLS prevents browser roles from bypassing the server; it does not distinguish wallets within the trusted server role. Database owners/operators remain privileged. See [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## API

All responses have `Cache-Control: no-store`. Writes require the exact configured Origin, reject cross-site Fetch Metadata and use JSON where a body is needed. No CORS access is enabled. Unknown fields are rejected. Bodies are streamed with a 40 KB limit. Errors share `{ "error": { "code": "...", "message": "...", "fields": [] } }`; `fields` is present only for validation errors. SQL/connection details are not returned or logged.

| Method / endpoint | Input / result |
| --- | --- |
| `POST /api/auth/nonce` | `{address, chainId:31337}` -> `{message, expiresAt}` and challenge cookie. |
| `POST /api/auth/verify` | `{message, signature}` + challenge cookie -> `{session:{address,chainId,expiresAt}}` and session cookie. |
| `GET /api/auth/session` | `{configured, session}`; session is null when absent/expired. When DATABASE_URL is absent, returns `configured:false` without pretending to connect. |
| `POST /api/auth/logout` | Deletes current durable session/challenge, clears cookies, returns `{loggedOut:true}`. |
| `GET /api/profile` | Authenticated own `{profile}` using SQL snake_case fields. |
| `PATCH /api/profile` | `{displayName, biography?}`; name 1-80 trimmed characters, biography <=2000; returns `{profile}`. |
| `GET /api/projects/[projectId]` | Requires query `chainId=31337&escrowAddress=0x...&deploymentHash=0x...`; returns `{project}` with milestone metadata. |
| `PUT /api/projects/[projectId]` | Same identity query; `{title,description,milestones:[{index,description}]}`; returns persisted `{project}`. Upserts only supplied milestone descriptions, preserving other existing milestone records. |

Project titles are 1-160 characters; descriptions 1-10000. Supply 1-5 distinct, real milestone indices and descriptions 1-4000 characters. Participants and all monetary/state fields come exclusively from contracts and cannot be included in the write body. This API does not claim that editable descriptive text still hashes to the project's original immutable on-chain metadata hash.

Status codes: 200 success, 400 validation, 401 missing/expired auth or invalid signature/challenge, 403 origin/role rejection, 404 missing chain resource/metadata, 409 deployment mismatch, 413 body too large, 415 wrong content type, 429 rate limit, 503 database/RPC/setup failure. Unsupported HTTP verbs receive 405. Authentication has durable five-minute global limits plus per-wallet nonce and per-challenge verification limits. These are basic abuse protection, not distributed denial-of-service protection; no untrusted forwarding header is used as an IP identity.

## Local setup and Supabase configuration

Keep root Hardhat dependencies and the `apps/web` lockfile separate. No populated environment file is tracked.

```powershell
npm.cmd ci
npm.cmd --prefix apps/web ci
npm.cmd run compile
Copy-Item apps/web/.env.example apps/web/.env.local
```

Edit `.env.local` locally. Set DATABASE_URL to the dedicated application login's Supabase direct/session-pooler URL and AUTH_ORIGIN to **exactly** `http://127.0.0.1:3000` for `next dev`. Hostname and port matter: localhost and 127.0.0.1 are different origins. Set DATABASE_MIGRATION_URL to an owner connection only while migrating. These variables are all server-only; do not use NEXT_PUBLIC_ prefixes. No Supabase anon/service API key is needed by this architecture.

Hosted connections require TLS with certificate validation; supply DATABASE_CA_CERT if a custom root CA is required. Do not append sslmode/sslcert/etc URL options, which can override `pg` TLS settings. Local loopback PostgreSQL uses plaintext for development only. Production AUTH_ORIGIN must be HTTPS; an HTTP `next start` preview cannot authenticate with production Secure cookies. Use `npm.cmd run web:dev` for local HTTP sign-in, or configure a trusted HTTPS origin for a production server.

Apply the versioned migration as database owner:

```powershell
npm.cmd --prefix apps/web run db:migrate
```

The runner loads `.env.local`, takes an advisory lock, records migration checksums in `public.trustlayer_schema_migrations`, skips already-applied files and rejects edited applied migrations. Each migration is transactional. It never resets a database or changes the blockchain. Alternatively, apply the SQL using the Supabase SQL editor and record/use a consistent migration history before switching migration tools.

### Safe migration diagnostics

Run a **read-only** connection/owner-permission check before retrying a failed migration:

```powershell
npm.cmd --prefix apps/web run db:migrate -- --check
```

This uses exactly the migration's connection configuration, executes `SELECT 1` and reads role/database/schema capabilities. It does not acquire a migration lock, create migration history, apply SQL files or reset anything. A successful connection is reported separately from sufficient owner permissions. Only retry the normal migration command after both succeed.

The npm script runs in `apps/web` and loads `.env.local` using Node's `--env-file-if-exists`. Existing shell variables take precedence over file values. `DATABASE_MIGRATION_URL` takes precedence over `DATABASE_URL`; an explicitly empty migration value fails validation rather than falling back. The runner prints only the selected variable's **name**, never its value. Keep the owner URI in `DATABASE_MIGRATION_URL` and the restricted application URI in `DATABASE_URL`.

| Safe code/category | Corrective action |
| --- | --- |
| `28P01` / authentication | Check the database password and exact Session Pooler owner username locally. URL-encode the actual password; template brackets are not part of the URI unless they are in the real password. |
| `42501` / privileges | Use an owner connection with the required role/schema permissions and ownership of any existing migration-history table. |
| `3D000` / database | Copy the correct database name from the Supabase connection panel. |
| `ENOTFOUND` / DNS | Check the copied hostname and DNS/VPN connectivity. |
| `ETIMEDOUT` or `PG_CONNECTION_TIMEOUT` | Check pooler availability, port, firewall/VPN and network restrictions. The latter is an application diagnostic for pg's uncoded timeout. |
| `SELF_SIGNED_CERT_IN_CHAIN` and other certificate codes | Configure a trusted database CA in `DATABASE_CA_CERT`; preserve certificate and hostname verification. |
| `42P06`, `42P07`, `42710`, `23505` / schema/history conflicts | Inspect existing objects and migration history without deleting/resetting anything. |
| `MIGRATION_CHECKSUM_MISMATCH` | Restore the original applied migration and add a new migration for later changes; do not rewrite history/checksums. |
| `OWNER_PERMISSIONS_REQUIRED` | The read-only owner capability check did not pass; do not retry with the restricted runtime URI. |

Failures show only an allowlisted code, category and fixed corrective guidance. Raw error messages, stacks, connection strings, identifiers, SQL details and values remain hidden. Pool/configuration errors are caught; rollback/unlock cleanup cannot replace the original diagnostic.

On 2026-11-20, hosted diagnostics confirmed that `.env.local` loaded correctly, the selected variable was `DATABASE_URL` because `DATABASE_MIGRATION_URL` was absent, and the connection had the expected Session Pooler host/owner username format, port 5432 and database name. TLS failed with **`SELF_SIGNED_CERT_IN_CHAIN`** with both Node's default and Windows system trust stores. No `DATABASE_CA_CERT` was configured. `SELECT 1` did not execute, database authentication was not reached, and owner privileges could not be established. No hosted migration or schema reset was attempted.

Obtain the trusted project's database CA PEM through the authenticated Supabase dashboard (see [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement)), and set `DATABASE_CA_CERT` to its PEM **contents**, using literal `\n` for line breaks if stored on one `.env.local` line. Do not set it to a file path, copy an unverified peer certificate as a trusted root, set `NODE_TLS_REJECT_UNAUTHORIZED=0` or use `rejectUnauthorized:false`. The current URI's password was found to be enclosed in square brackets; whether those belong to the actual password cannot be established before authentication. Verify this locally when copying the owner URI. Rerun `--check`; apply migrations only after verified TLS, successful authentication and sufficient owner capabilities.

For a certificate already downloaded from that trusted source, a temporary PowerShell configuration can read it without printing its contents:

```powershell
$env:DATABASE_CA_CERT = Get-Content -Raw -LiteralPath 'C:\path\to\downloaded-database-ca.crt'
npm.cmd --prefix apps/web run db:migrate -- --check
# Only after the check succeeds:
# npm.cmd --prefix apps/web run db:migrate
```

Diagnostic fix verification (2026-11-20): `npm.cmd run compile` exited 0; `npm.cmd --prefix apps/web run test:unit` passed **191 tests** (172 previous + 19 migration-diagnostic tests); `npm.cmd run web:typecheck` and `npm.cmd run web:lint` exited 0. Tests cover safe PostgreSQL/network/TLS classification, secret redaction, nested/cyclic errors, configuration precedence, checksum diagnostics and the actual read-only permission query under PostgreSQL owner/runtime roles. The hosted `db:migrate -- --check` exited 1 with the expected safe `SELF_SIGNED_CERT_IN_CHAIN` diagnostic. `npm.cmd --prefix apps/web run format:check` exited 0 and `git diff --check` passed. No schema/migration SQL, populated environment file, dependency, production contract or application transaction behavior was changed by this diagnostic task. Full browser/blockchain regressions were not rerun for this script-only change; the earlier Phase 4A results below remain historical.

As database owner, create a dedicated login using a strong locally chosen secret (do not paste real credentials into tracked documentation or shell history):

```sql
CREATE ROLE trustlayer_app LOGIN PASSWORD '<choose-a-secret-locally>' INHERIT;
GRANT trustlayer_server TO trustlayer_app;
```

Set DATABASE_URL to that login. Do not use migration-owner credentials in runtime configuration. Keep `trustlayer` out of exposed Supabase schemas. See [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres) and [node-postgres TLS](https://node-postgres.com/features/ssl).

For an optional local PostgreSQL 17 database with Docker installed, start a dedicated loopback service (the password comes from an explicit local environment variable):

```powershell
# Set POSTGRES_PASSWORD securely in this terminal first.
docker run --name trustlayer-phase4a-db -e POSTGRES_PASSWORD -e POSTGRES_DB=trustlayer -p 127.0.0.1:5432:5432 -v trustlayer-phase4a-db:/var/lib/postgresql/data -d postgres:17
```

Point DATABASE_MIGRATION_URL at its owner, migrate, create the dedicated login, then configure DATABASE_URL. Docker/PostgreSQL are optional for automated tests; this task's environment has neither installed.

Keep the existing local Hardhat node/deployment/export intact. `web:dev` mirrors its existing exported manifest to public metadata. The backend reads that same mirror from the Next application working directory and revalidates it live. After a legitimate re-export, run `npm.cmd --prefix apps/web run contracts:sync`. Do not edit generated metadata to bypass failures.

```powershell
npm.cmd run web:dev
```

On `/settings`, connect MetaMask, select **Sign in with Ethereum**, approve the message, then edit the wallet-linked profile. Preview preferences remain separate. Switch accounts to verify old profile data disappears and a new sign-in is required. Sign out revokes backend authentication without disconnecting MetaMask.

## Testing, resets and maintenance

Unit tests use the exact migration and real SQL under the actual `trustlayer_server` role in an isolated [PGlite PostgreSQL engine](https://pglite.dev/docs/). No map-based nonce/database replacement is used. They cover real signatures, expiry/replay/concurrent consumption, origin/chain/message tampering, sessions/logout/rotation, validation/status/errors, cross-wallet access, schema constraints, foreign keys and RLS/browser-role denial. The new backend integration script combines this database with an isolated production-contract EVM and unlocked development wallet signatures. Browser auth tests use test-only API/injected-wallet fixtures; production code has no test authentication bypass.

```powershell
npm.cmd run compile
npm.cmd test
npm.cmd run typecheck
npm.cmd --prefix apps/web run test:unit
npx.cmd hardhat run apps/web/scripts/verify-escrow-workflow.ts
npx.cmd hardhat run apps/web/scripts/verify-arbitration-workflow.ts
npx.cmd hardhat run apps/web/scripts/verify-backend-workflow.ts
npm.cmd run web:lint
npm.cmd run web:typecheck
npm.cmd --prefix apps/web run format:check
npm.cmd run web:build
$env:PLAYWRIGHT_PORT='3001'
$env:PLAYWRIGHT_CHANNEL='chrome'
npm.cmd run web:test
git diff --check
```

Hardhat operations must run sequentially. Browser tests own their port-3001 production server; port 3000 remains untouched. Tests never reset the existing node or rewrite the tracked manifest. `test:unit` starts with a fresh embedded database automatically; rerun it for a clean test reset.

For a **dedicated disposable PostgreSQL test database only**, stop its app connections, verify its host/database name, and drop that test database, recreate it, then rerun `db:migrate`. An alternative explicitly destructive schema reset in that isolated database is `DROP SCHEMA trustlayer CASCADE; DROP TABLE public.trustlayer_schema_migrations;` followed by migration. Never use either reset on a shared/live database. No reset was performed during this task.

Periodically delete expired auth rows as an operator; nonce/session checks already reject expired rows even before cleanup:

```sql
DELETE FROM trustlayer.auth_nonces WHERE expires_at < now() - interval '1 day';
DELETE FROM trustlayer.auth_sessions WHERE expires_at < now();
DELETE FROM trustlayer.auth_rate_limits WHERE window_start < now() - interval '1 day';
```

## Files created and modified

| Area | Created |
| --- | --- |
| SQL | `supabase/migrations/202611190001_phase4a.sql` |
| Server | `apps/web/src/lib/server/{api,chain,config,db,errors,runtime,service,validation}.ts` |
| API routes | `apps/web/src/app/api/auth/{nonce,verify,session,logout}/route.ts`, `api/profile/route.ts`, `api/projects/[projectId]/route.ts` |
| Client | `apps/web/src/lib/auth-client.ts`, `apps/web/src/components/auth-provider.tsx`, `backend-auth.tsx` |
| Tools/config | `apps/web/.env.example`, `apps/web/scripts/db-migrate.ts`, `verify-backend-workflow.ts` |
| Tests | `apps/web/unit/backend.test.ts`, `apps/web/test-support/database.ts`, `apps/web/tests/auth.spec.ts` |
| Documentation | `docs/PHASE4A.md` |

Modified: `apps/web/package.json` and its lockfile (new dependencies/script only); `apps/web/src/components/providers.tsx`, `settings.tsx`, `wallet.tsx`; `apps/web/tests/wallet-fixture.ts` (opt-in test signing); root `README.md`, `AGENTS.md`, `docs/PHASES.md` and `apps/web/README.md`.

The working tree already contained local changes to `apps/web/next-env.d.ts` and `packages/contracts/generated/deployments/31337.json` before this task. The manifest was not rewritten by Phase 4A. Next's generated declaration file is preserved in its original development-mode form after checks; it is not a manual backend feature change.

### Exact verification results

Executed on 2026-11-19 using Node.js 25.6.1 on Windows. Root dependencies/compiler were not upgraded.

| Command/check | Actual result |
| --- | --- |
| `npm.cmd run compile` | Exit 0; no contracts to compile. |
| `npm.cmd test` | Exit 0; **182 passing Node.js tests**, including all prior protocol/provisioning tests. |
| `npm.cmd run typecheck` | Exit 0. |
| `npm.cmd --prefix apps/web run test:unit` | Exit 0; **172 passed, 0 failed**, comprising 132 existing and 40 new backend/auth/database tests. |
| `npx.cmd hardhat run apps/web/scripts/verify-escrow-workflow.ts` | Exit 0; 11 confirmed frontend actions, two independent projects, exact approval/funding/settlement, strict timeout and token conservation. |
| `npx.cmd hardhat run apps/web/scripts/verify-arbitration-workflow.ts` | Exit 0; 70 confirmed actions, four verdicts, 12 rewards, deadline/treasury/collateral/escrow conservation checks. |
| `npx.cmd hardhat run apps/web/scripts/verify-backend-workflow.ts` | Exit 0; actual unlocked-wallet signature, production-contract authority, real SQL persistence, outsider/stale-scope rejection and logout. |
| `npm.cmd run web:typecheck` | Exit 0; Next route generation and TypeScript. |
| `npm.cmd run web:lint` | Exit 0; no errors/warnings. |
| `npm.cmd --prefix apps/web run format:check` | Exit 0; all matched files use Prettier style. |
| `npm.cmd run web:build` | Exit 0; optimized build/TypeScript success; all six API route patterns are dynamic Node routes. |
| Desktop auth smoke: `npx.cmd playwright test tests/auth.spec.ts --project=desktop` | Exit 0; **7 passed (26.6 seconds)** on port 3001 using Chrome. |
| `$env:PLAYWRIGHT_PORT='3001'; $env:PLAYWRIGHT_CHANNEL='chrome'; npm.cmd run web:test` | Exit 0; **273 passed (6.1 minutes)** across desktop/tablet/mobile: all 252 existing checks plus 21 new auth checks. |
| `npm.cmd --prefix apps/web audit --omit=dev --json` | Exit 0; **0 production vulnerabilities**. |
| `git diff --check` and new-file whitespace | Passed; final check repeated after documentation completion. |
| Protected-source diff | Production contracts, modules, compiler, generated ABIs/inventory and root package/lockfile unchanged. |
| Hosted Supabase connection / deployed role setup | **Not executed**; credentials/service unavailable. No external migration or database reset performed. |

An initial sandbox compilation failed before Solidity execution with `uv_os_get_passwd ENOMEM`; the authorized unsandboxed command succeeded. Initial new-code type/lint/format issues were corrected. An initial browser run exposed selectors matching hidden wallet-dialog text and an extra status region affecting the existing preferences test; that superseded run was stopped, the selectors/announcement corrected, and the final complete suite rerun. Existing tests were not weakened. No actual MetaMask test, public deployment, commit, push or Phase 4B work is claimed.

Phase 4A is ready for code review with all listed automated checks passing. Next, configure a real Supabase/local PostgreSQL instance, apply the owner migration and runtime role grant, then manually verify local MetaMask sign-in/profile editing. Hosted connectivity and manual wallet verification remain explicit external setup steps; no later phase is authorized by these results.

## Security limits and Phase 4B dependencies

- No hosted Supabase credentials/service were supplied. Embedded PostgreSQL verifies SQL behavior, not hosted connectivity, Supabase pooler/TLS/role provisioning, backups or operations. Those external setup steps still need verification before a real shared demo.
- No new actual MetaMask/manual hardware-wallet test is claimed. Browser tests use injected providers. EOA-only SIWE is deliberate; EIP-1271 and other networks require separate work.
- RLS trusts the server role. Protect database credentials, use least privilege and keep the schema unexposed. SameSite/origin checks do not defend against an application XSS or compromised server/RPC. Basic global rate limits can themselves be exhausted; production needs infrastructure abuse controls and bounded log/retention policies.
- Metadata is non-sensitive text, not proof of delivery or evidence access. Later file storage must bind objects to verified deployment/project/case, authenticate every retrieval, enforce participant/assigned-juror access and use private buckets/signed short-lived URLs. There is no bucket, file upload, file download endpoint or evidence content in this phase.
- Persistence does not replace blockchain truth or restore chain state. Hardhat Local may reset on restart, losing projects, fees, assignments, votes and funds. Existing database rows cannot recreate those states. An anchor mismatch fails closed until an intentional deployment/export; old rows remain separately scoped. Full local chain persistence/recovery, reorg-aware indexing and final cross-system integration remain deferred to Phase 5. Identical replay of the exact same anchored chain history is not distinguishable by this development identity scheme.
- Existing frontend defects and unrelated persistence issues remain deferred as requested. Phase 4A stops for review; do not proceed to Phase 4B automatically.
