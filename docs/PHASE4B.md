# Phase 4B: persistent metadata and private files

Phase 4B extends the existing Next.js Node route handlers, SIWE sessions and PostgreSQL service. Production Solidity, generated ABIs, fees, voting rules and deployment modules are unchanged. Stop after this phase for review; Phase 5 is not implemented.

## Private-file workflow correction (2026-11-20)

The manual PNG upload exposed two independent defects that the original mocks did not reproduce:

1. `useVerifiedDeployment` revalidates every 30 seconds and on relevant focus events. While fetching it deliberately sets `ready=false`; `useChainProject.view` consequently disappears and the milestone/file controls unmount. File selection, upload key and progress were local to `PrivateFiles`, so this looked like a page refresh and discarded the selected file. Metadata/session refreshes do not require a document reload to trigger this path. Deployment safety checks remain unchanged.
2. `FileService.upload` first reserves a PostgreSQL row, then checks whether its immutable Storage object already exists before attempting `POST`. The real hosted Storage API returned **HTTP 400** with `{statusCode:"404", error:"not_found", message:"Object not found"}` for the absent object. The adapter recognized only HTTP 404, raised application **HTTP 503 / `storage_download` / "Private storage retrieval failed."**, marked the reservation `failed` and never attempted the object upload. This was an upload preflight retrieval error, not evidence that listing failed or a stored file was lost. Supabase documents both modern and [legacy Storage error envelopes](https://supabase.com/docs/guides/storage/debugging/error-codes).

The fix recognizes only that exact legacy object-not-found envelope, after verifying the configured private bucket. Other HTTP 400, credential/permission failures, missing buckets and server errors still fail closed. Bucket errors now include a safe upstream HTTP status without credentials, paths or response bodies.

An app-level `FileDraftProvider` holds the actual browser `File`, immutable upload key, operation token, progress and result state in memory. Its key includes wallet, deployment anchor, project, milestone, case and category. Routine verification remounts and transient reconnecting/connecting states retain drafts. Actual disconnection or a settled account/chain change clears them and prevents an old operation from recreating them. No raw bytes are saved to localStorage, sessionStorage, IndexedDB, disk or the query cache. A genuine browser reload still requires selecting an unuploaded local file again.

The upload lock is acquired synchronously in the shared store, preventing double-clicks and remount-triggered duplicate requests. It releases on success, errors, timeouts and authentication expiry. Responses/callbacks require the original valid SIWE identity and current wallet; stale responses stay hidden. A response completed while its original component is unmounted updates the matching draft safely; the remounted UI can use the listed hash through **Use this hash**. Upload success and blockchain submission remain separate actions.

File selection, uploading, success/failure, listing errors and authentication requirements are separate UI states. Only a successful empty list displays **No accessible files are recorded**. Listing failures expose **Retry file listing** and never disable upload controls. The existing byte-bound idempotency key survives background remounts, so retrying stored bytes after a database synchronization failure does not upload a second object. Failed reservations remain tracked; confirmed evidence is never deleted automatically.

### Hosted diagnosis and actual data status

Read-only checks against the developer's configured hosted services established:

- The server key is now accepted, `GET bucket` returns HTTP 200, the bucket identity matches the configured name, and `public=false`. The previous handoff's key-format blocker has been resolved externally; no credentials were changed by this fix.
- The private bucket permits PNG and the reported 5,626-byte file fits both the application and configured bucket limits. The reservation's bucket matches the configured bucket.
- The reported `Screenshot 2025-05-14 113840.png` has one matching reservation, size **5,626 bytes**, category `deliverable`, state **failed**, for project 0 / milestone 0. At diagnosis its object request returned the exact legacy not-found response. No retrievable stored object was found; this attempt stopped before `POST`, rather than orphaning a successful upload.
- The uploader has an active database session. The original error path occurs after SIWE and participant checks; fresh RPC reads also confirm that the uploader is the project's freelancer and the milestone is currently accepting delivery.
- The server/public manifest matches the generated deployment anchor. The live RPC's chain ID, anchored block and production contract runtimes validate successfully. The reservation's saved scope matches that deployment.
- Calling the corrected adapter against the same reserved path now returns `null` for the absent object, as intended. No hosted upload, download of private contents, object deletion, evidence mutation or metadata update was performed. The failed row was retained.
- A read-only lookup in Supabase's `storage.objects` catalog also found no matching object entry for this reservation, corroborating the absent-object result.

The hosted checks verify configuration/read connectivity and the exact failure mode. They do **not** claim a successful hosted object upload or actual MetaMask walkthrough. Complete the manual retry below with the user's own selected file.

### Files changed for this correction

- `apps/web/src/components/private-files.tsx`: shared upload state, stable retries, stale-result guards, independent listing errors and explicit status labels.
- `apps/web/src/components/providers.tsx`: mounts the file-draft provider at application level.
- New `apps/web/src/components/file-draft-provider.tsx` and `apps/web/src/lib/file-drafts.ts`: scoped memory-only drafts, operation locks, reconnection/account-change rules.
- `apps/web/src/lib/server/storage.ts`: exact legacy not-found recognition and safe bucket error reporting.
- `apps/web/tests/files.spec.ts`, `apps/web/unit/files.test.ts`, and new `apps/web/unit/file-drafts.test.ts`: polling/remount, pending locks, failed listing, account switch, expiry, duplicate retry, database/Storage partial failure, credential and missing-bucket regressions.
- `docs/PHASE4B.md`: diagnosis, hosted status, verification and manual recovery instructions.

The pre-existing local deployment-manifest change belongs to the developer and is preserved. No Solidity, economics, authentication rules, migration or privileged environment configuration was changed.

### Manual retry and recovery

1. Restart the existing development server if necessary to load the corrected code. Use the configured exact local origin, connect the freelancer and sign in. Do not reset/redeploy the local chain or reapply migrations for this fix.
2. Open the active project/milestone and select the PNG again. Its filename/size and **File selected** status remain visible through routine background verification; a real browser reload still loses an unuploaded file selection.
3. Click **Upload privately** once. Watch progress and the private upload success/hash. The draft key and pending lock survive temporary remounts; a failed request can retry the same selection/key. Listing failure has its own message and retry button.
4. If upload succeeded but metadata synchronization failed, retry the same selected file without choosing it again. The server checks existing bytes and finishes the existing reservation rather than overwriting or creating another object. After a genuine page reload, reselecting generates a new key; do not assume this recovers an older key automatically. The previously reported empty failed reservation is retained and does not represent an uploaded document.
5. Review and confirm the existing milestone transaction separately. If the hash input was remounted, choose **Use this hash** from the saved file list. After confirmation, sign in as client and use **Download & verify**. Retry a confirmed association using the original receipt if needed; never resend a confirmed chain action to repair metadata.
6. Verify that a wallet switch/disconnect hides the old draft/results. After SIWE expiry, authenticate again before uploading or retrieving files. Test listing recovery with synthetic data; never relax bucket policies to make a failed download work.

### Verified correction results

| Command/check                                                               | Result                                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd --prefix apps/web run test:unit`                                   | **241 passed**, 0 failed, 0 skipped; includes 13 additional regressions                                                                                                                                     |
| `PLAYWRIGHT_PORT=3001`, `PLAYWRIGHT_CHANNEL=chrome`, `npm.cmd run web:test` | **339 passed**, 0 failed, desktop/tablet/mobile, **11.1 minutes**                                                                                                                                           |
| `npm.cmd run compile`                                                       | Exit 0; no Solidity changes to compile                                                                                                                                                                      |
| `npm.cmd test`                                                              | **182 passed**, 0 failed, isolated Hardhat regression networks                                                                                                                                              |
| Four `npx.cmd hardhat run apps/web/scripts/verify-*-workflow.ts` commands   | All passed: escrow, arbitration, backend and files; isolated production-contract EVMs, no persistent node/export changes                                                                                    |
| `npm.cmd run typecheck`                                                     | Passed                                                                                                                                                                                                      |
| `npm.cmd run web:typecheck`                                                 | Passed                                                                                                                                                                                                      |
| `npm.cmd run web:lint`                                                      | Passed, no warnings/errors                                                                                                                                                                                  |
| `npm.cmd run web:build`                                                     | Production compilation, TypeScript and route generation passed                                                                                                                                              |
| `npm.cmd --prefix apps/web run format:check`                                | Passed                                                                                                                                                                                                      |
| `git diff --check`, changed/new-file whitespace scan                        | Passed                                                                                                                                                                                                      |
| Hosted read-only checks                                                     | Accepted server key, matching private bucket, PNG/size restrictions satisfied, matching deployment/participant/upload window, absent object/API and Storage catalog, corrected missing-object normalization |

The new browser tests use a synthetic PNG with the reported name and size, fast-forward background verification, keep an upload response pending across another remount, and verify same-key retry produces one database row and one stored object. Additional browser cases cover listing failure with usable upload controls and account switching during an upload. Existing expiry/relogin, actual receipt association and private-download regressions remain intact. Unit tests cover connecting/reconnecting identity policy, actual disconnect cleanup, retained-byte retry after database failure, Storage credential/permission failures, missing buckets and the exact legacy not-found envelope.

The first focused polling test exposed a missing UI status prefix (the selected file itself was already retained); the label was corrected and final tests pass. No existing test assertions were removed or weakened. Actual MetaMask and hosted object upload/download were not performed by automation. The original implementation results later in this document are historical baselines; the table above is the current correction result.

## Architecture and authority

The browser uses same-origin authenticated APIs. PostgreSQL stores descriptive metadata, immutable file records and integrity-access audit records. A server-only adapter uses Supabase's private Storage REST API; no browser Supabase client or privileged key is bundled. Every object operation verifies that the configured bucket exists and is private. There are no public or permanent signed URLs. Downloads pass through the authorized backend, are bounded in memory and are returned as attachments with `no-store`, `nosniff`, and a sandbox CSP.

Every metadata/file access freshly validates the generated active deployment against RPC chain ID, anchored block and contract runtimes, then reads real project/milestone/case state. The scope is chain ID + escrow address + deployment anchor + zero-based project/milestone/case ID. A database row never proves that a project exists. A reset, stale export or unrelated case fails closed; old rows do not become active projects. Re-export and synchronize the genuine persistent local deployment after a reset; never edit generated metadata to bypass verification.

Wallet connection and SIWE sign-in remain separate. All file operations require a valid database-backed SIWE session; writes also require the configured exact Origin. Existing HttpOnly/SameSite/expiration and production Secure-cookie rules remain unchanged. Authorization uses the session wallet and current contract participants/assigned jurors, never a client-supplied role. Changing accounts hides private query data and clears the previous backend identity through the existing auth provider. No automatic signature requests are added.

## Database migration

`supabase/migrations/202611200002_phase4b.sql` is additive. The applied Phase 4A migration/checksum is unchanged.

- `projects.revision` and `sync_hash`: optimistic edits and identical-request idempotency.
- `milestones.name`: persistent display name alongside its existing description.
- `files`: deployment/project/milestone/case, category, uploader, upload key, sanitized filename, content type/size/SHA-256, private bucket/path, synchronization status, confirmed transaction/block and chain acceptance time.
- `file_access`: requesting wallet, file, integrity result and server timestamp.
- Unique upload keys per wallet; one linked primary file per contract reference; bounded per-milestone records; RLS/grants consistent with `trustlayer_server`.
- A trigger prevents changing file identity/content/path and prevents editing or deleting linked evidence. File rows and access history are retained. The existing legacy Phase 4A submission/dispute metadata tables remain intact; file associations have their own explicit state machine.

The implementation uses parameterized SQL and short database transactions. It reserves uploads before storage I/O, preventing untracked objects when storage succeeds but a later request fails. Storage I/O is not performed while holding SQL locks. An upload interrupted in `uploading` can be reclaimed with the same key after five minutes; a `failed` reservation can be retried immediately. Different bytes/targets cannot reuse its key. Identical ready/linked retries return the original file.

The existing privileged `DATABASE_URL` remains supported and was not changed. Database owner/runtime-role separation, reduced audit privileges, quotas and operational cleanup are Phase 5 hardening items. Custom SIWE cookies do not authenticate Supabase RLS; the server mediates access. Keep the `trustlayer` schema unexposed to browser roles.

## Files created or modified

Created (18):

- `apps/web/scripts/verify-files-workflow.ts`.
- `apps/web/src/app/api/files/[id]/associate/route.ts`.
- `apps/web/src/app/api/files/[id]/route.ts`.
- `apps/web/src/app/api/files/[id]/verify/route.ts`.
- `apps/web/src/app/api/files/route.ts`.
- `apps/web/src/app/api/projects/[projectId]/milestones/[index]/route.ts`.
- `apps/web/src/components/private-files.tsx`.
- `apps/web/src/components/project-metadata.tsx`.
- `apps/web/src/lib/files.ts`.
- `apps/web/src/lib/metadata-client.ts`.
- `apps/web/src/lib/server/file-service.ts`.
- `apps/web/src/lib/server/storage.ts`.
- `apps/web/test-support/files-backend.ts`.
- `apps/web/test-support/storage.ts`.
- `apps/web/tests/files.spec.ts`.
- `apps/web/unit/files.test.ts`.
- `docs/PHASE4B.md`.
- `supabase/migrations/202611200002_phase4b.sql`.

Modified (20):

- `AGENTS.md`.
- `README.md`.
- `apps/web/.env.example`.
- `apps/web/src/components/chain-dispute-detail.tsx`.
- `apps/web/src/components/chain-project-detail.tsx`.
- `apps/web/src/components/chain-projects.tsx`.
- `apps/web/src/components/project-arbitration.tsx`.
- `apps/web/src/components/project-form.tsx`.
- `apps/web/src/components/reviewed-action.tsx`.
- `apps/web/src/components/shell.tsx`.
- `apps/web/src/lib/blockchain/hooks/README.md`.
- `apps/web/src/lib/blockchain/projects.ts`.
- `apps/web/src/lib/server/api.ts`.
- `apps/web/src/lib/server/chain.ts`.
- `apps/web/src/lib/server/runtime.ts`.
- `apps/web/src/lib/server/service.ts`.
- `apps/web/src/lib/server/validation.ts`.
- `apps/web/test-support/auth-backend.ts`.
- `apps/web/test-support/database.ts`.
- `docs/PHASES.md`.

No production contracts, deployment modules, generated ABIs, dependencies/lockfiles, populated environment files or existing test expectations were changed.

## API inventory

All scopes use `chainId=31337&escrowAddress=0x...&deploymentHash=0x...`.

| Endpoint                                    | Purpose                                                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /api/projects/[id]`                    | Participant-only saved project/milestone text, participants and revision                                              |
| `PUT /api/projects/[id]`                    | Participant-authorized idempotent synchronization; optional `expectedRevision` rejects stale edits with 409           |
| `GET /api/projects/[id]/milestones/[index]` | Saved milestone name/description after live participant/index verification                                            |
| `GET /api/files`                            | Bounded authorized list; target adds `projectId`, `milestoneIndex`, optional `disputeId`; also returns upload limit   |
| `POST /api/files`                           | Target + `category`; raw bounded bytes; `Idempotency-Key` UUID, encoded `X-File-Name`, `X-Content-SHA256`, exact MIME |
| `GET /api/files/[uuid]`                     | Authorized download; verifies actual stored bytes; `X-Content-SHA256` reports the recorded hash                       |
| `GET /api/files/[uuid]/verify`              | Same authorization/integrity check without returning file bytes; records an access audit result                       |
| `POST /api/files/[uuid]/associate`          | Uploader-only synchronization using `transactionHash` and, for opening evidence, actual `disputeId`                   |
| `DELETE /api/files/[uuid]`                  | Tombstone only an empty failed reservation owned by the caller; never delete uploaded bytes                           |

There is no client-controlled bucket/object path parameter. UUID-only paths are generated as `v1/{deployment UUID}/{file UUID}`. Uploads never upsert/overwrite existing objects. Filenames are display/download labels only and cannot change a path. Lists/download DTOs omit bucket, object path and service credentials. Errors use safe messages without dependency response bodies or SQL/credentials. Typical responses: 400 invalid target/input, 401 expired/missing session, 403 role/origin rejection, 404 nonexistent resource, 409 stale state/duplicate binding/retention, 413 size, 415 type/signature, 422 hash mismatch, 429 rate/quota, 503 dependency/setup failure.

## Project metadata synchronization

Creation keeps the original chain transaction and receipt-derived project ID. After confirmation, a matching authenticated client can synchronize titles, project description, milestone names and descriptions. The review dialog distinguishes wallet/receipt progress from metadata synchronization. Funding remains separate; no token balance is required for creation.

The chain and PostgreSQL do not share a transaction. A metadata failure reports that chain creation succeeded and navigates to that existing project. Sign in and use **Project metadata → Save project metadata** to retry; never click Create again. The same deployment/project cannot gain duplicate metadata rows. Participant edits send a revision and refuse lost updates. Identical payload retries preserve the revision. Saved details restore after refresh, and dashboard/list titles are loaded only for actual discovered on-chain projects. Descriptive text remains private to participants; assigned jurors receive necessary files, not blanket project-edit rights.

Without sign-in or a successful save, existing in-memory metadata remains a fallback. Unsaved text can be lost on refresh; re-enter it in the existing project's metadata form. No draft bodies or private files are stored in localStorage. Metadata edits do not rewrite the original on-chain metadata commitment or financial state.

## Hashing and workflow

Files use SHA-256 of **exact bytes**, in browser and server, encoded as `0x` followed by 64 lowercase hexadecimal characters. Filename, path, MIME and descriptions are not hashed in place of bytes. The browser-reviewed hash must match the server result. Downloads are checked by the server before returning bytes and again by the browser before saving. Mismatches are audited and return no file. Hashing proves byte equality, not authorship, confidentiality, completeness or work quality; hashes are public and guessable content can be tested against them.

SHA-256 differs from Ethereum Keccak-256. The unchanged contracts accept opaque nonzero `bytes32` values in `submitMilestone(projectId,index,evidenceHash)`, `openDispute(projectId,index,evidenceHash)` and `respondToDispute(disputeId,evidenceHash)`; they do not compute either algorithm. The existing versioned **Keccak-256 project metadata JSON commitment is preserved**. File SHA-256 is explicitly separate. Existing manually entered hashes remain supported; they do not automatically imply a private file exists.

Freelancer workflow:

1. Connect and sign in as the real project freelancer; select the current active pending milestone.
2. Select PDF, PNG, JPEG or UTF-8 plain text. Review filename, size/type and progress. Server checks nonempty size, MIME and basic file signatures/text validity.
3. Upload privately. The verified SHA-256 populates the existing submission input. Upload success is **not** on-chain submission.
4. Review and confirm the existing milestone transaction. Existing fresh-state/wallet checks and duplicate/uncertain-receipt locks still apply.
5. On confirmation, associate the upload with its exact receipt/event/hash/actor/project/index. A client can then download it privately.
6. Wallet rejection/revert leaves the uploaded draft available for the same valid submission window. If association fails after confirmation, use **Retry confirmed association** with the original transaction hash; no new blockchain transaction is sent.

The contract supports one submission per milestone, not arbitrary revision history. Immutable upload records and the confirmed reference are retained; no new Solidity resubmission mechanism is invented.

## Evidence access and deadlines

| File                  | Who uploads        | Deadline/state                                                                           | Who reads                                                                                           |
| --------------------- | ------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Deliverable           | Freelancer         | Current active pending milestone; inclusive due time + existing 48-hour grace            | Uploader while draft; both participants after association; jurors assigned to that milestone's case |
| Opening               | Either participant | Current submitted milestone, inclusive review deadline, no existing case                 | Uploader while draft; participants and assigned case jurors after receipt association               |
| Response              | Counterparty only  | Case open, no existing response hash, chain timestamp strictly before `responseDeadline` | Uploader while draft; participants and assigned jurors after receipt association                    |
| Supplemental evidence | Either participant | Case open, chain timestamp strictly before `responseDeadline`                            | Participants and assigned jurors after accepted upload                                              |

Roles/deadlines are checked before reserving an upload and again after storage acknowledgement. At the exact response deadline, new response/evidence uploads are rejected. Reads remain authorized after case finalization, including historical assigned jurors. Unrelated wallets, jurors from other cases and anonymous requests cannot retrieve files. Fresh chain state is required even for retained files; outages/resets fail closed.

The existing contract permits exactly an opening hash and one response hash. **Supplemental attachments remain off-chain**, append-only before the same response deadline; they do not update on-chain hashes, votes, jury, deadlines, ruling or rewards. Only primary associations require canonical successful receipts and matching emitted events. A delayed association may recover already-confirmed primary references after the deadline; it cannot create a new contract submission.

All stored objects are retained in this prototype, including unlinked drafts and interrupted uploads with stored bytes. Automatic deletion could race a transaction the server cannot observe. Only an empty failed reservation can be tombstoned; its database audit row remains. There is no automatic TTL, garbage collection, overwrite or post-deadline replacement. Review a retention/privacy policy before using real confidential data.

## Manual Supabase setup

The hosted Phase 4A connection already exists. Preserve its working `.env.local` and `DATABASE_URL`; **do not copy `.env.example` over it**.

1. In the same Supabase project's Dashboard → Storage → New bucket, create `trustlayer-private`, with **Public bucket disabled**.
2. Set the bucket file-size limit to 10 MiB (or your chosen limit up to the application's hard 20 MiB maximum). Allowed MIME types: `application/pdf`, `image/png`, `image/jpeg`, `text/plain`.
3. Do not add permissive `anon`/`authenticated` object policies. Review existing policies for this bucket and ensure browser roles have no direct object access. TrustLayer custom SIWE sessions use server authorization, not Supabase Auth JWTs.
4. Copy the project HTTPS URL and **legacy `service_role` JWT** from project API settings into the server-only variables below. This adapter deliberately validates that JWT's role; publishable/anon keys and the newer `sb_secret_...` format are not accepted by this version. Never paste keys into commands, chats, public files or `NEXT_PUBLIC_` variables.
5. Add locally, using the actual values only in ignored `.env.local`:

```dotenv
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=REPLACE_WITH_LEGACY_SERVICE_ROLE_JWT
SUPABASE_STORAGE_BUCKET=trustlayer-private
UPLOAD_MAX_BYTES=10485760
```

6. From the repository root, run:

```powershell
npm.cmd --prefix apps/web run db:migrate -- --check
npm.cmd --prefix apps/web run db:migrate
npm.cmd run web:dev
```

Migration commands load `apps/web/.env.local`, prefer `DATABASE_MIGRATION_URL` when configured and otherwise retain the working `DATABASE_URL` fallback. On this implementation run, SELECT 1/authentication/owner checks succeeded; Phase 4A was skipped and **202611200002_phase4b.sql was applied to the hosted database**. No reset, data deletion or credential changes were performed. Future runs should skip both checksummed migrations.

Restart Next after environment changes. Use `AUTH_ORIGIN=http://127.0.0.1:3000` and that exact browser origin for local HTTP with `next dev`. Production still requires HTTPS/Secure cookies; do not weaken them for `next start` over local HTTP.

Supabase reference: [private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [server service-key access and RLS](https://supabase.com/docs/guides/storage/security/access-control). The service key bypasses Storage RLS, making server authorization and key custody essential.

## Manual MetaMask verification

Use the existing persistent chain 31337 deployment/export, local ETH and development mUSD provisioning documented in Phase 3C/3D. Do not reset your running node or redeploy merely for this phase.

1. At the configured local origin, connect the client and explicitly sign in in Settings. Create a project with titles/descriptions. Confirm MetaMask, observe the actual transaction hash/receipt and separate metadata result. Funding remains its existing separate approval/funding flow.
2. Refresh the detail page; verify saved title, milestone name/description and wallet/session persistence. Edit permitted metadata and refresh again. Check dashboard/list titles. An unrelated signed-in wallet must not access/edit private metadata.
3. Connect/sign in as freelancer, accept the funded project and privately upload a harmless `.txt` file. Confirm its SHA-256 is displayed before signing; upload alone must not submit the milestone.
4. Reject the wallet transaction once, then reuse the draft/hash while the submission window permits. Confirm submission, switch/sign in as client, download and verify the exact original bytes.
5. Open a dispute with a privately uploaded opening file after the existing exact fee approval. Sign in as counterparty, upload/record one response. Add supplemental attachments while the 12-hour response window remains open. They must be labeled off-chain.
6. Sign in as each assigned juror and retrieve case files. An unrelated wallet must fail. At/after the response deadline upload controls close; after finalization authorized retained downloads still work. No extra evidence can alter voting/outcome.
7. Exercise failure recovery with harmless synthetic data: upload/storage failure retries the same key; confirmed-chain/metadata failure retries metadata only; confirmed-chain/file-association failure retries the original receipt only. Never resend a confirmed contract action to repair backend state.

These are manual steps, not a claim that actual MetaMask or hosted Storage was exercised automatically.

## Original implementation verification and limitations (historical baseline)

Automated verification uses all sorted real SQL migrations in isolated PGlite under `trustlayer_server`, isolated byte storage and a mocked HTTP Storage adapter. Browser tests use the real SIWE/API/SQL path with test-only injected wallets and deterministic RPC fixtures. The new EVM script exercises actual production-contract file references with isolated SQL/storage. No automated test uses hosted credentials.

Final verification recovered the completed full browser run: **330 passed in 5.4 minutes**, exit code 0. The original process completion output and `apps/web/test-results/.last-run.json` (`status: passed`, no failed test IDs) both confirm completion, so the interrupted run did not need to be restarted. The earlier 327-test run also passed; the final suite includes three additional viewport executions of the upload-expiry regression.

On continuation, the current frontend/backend unit tests and quality checks were rerun successfully. A hosted **read-only** transaction confirmed `SELECT 1`, both migration records/checksums and the existence of `trustlayer.files`/`file_access`. No migration was reapplied and no data/schema changes were performed during continuation.

| Verification                                    | Verified result                                                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd --prefix apps/web run test:unit`       | 228 passed, 0 failed, 0 skipped; rerun on continuation                                                                     |
| `npm.cmd run web:test` with port 3001 / Chrome  | 330 passed, 0 failed, 3 viewports, 5.4 minutes; original completed run recovered                                           |
| `npm.cmd run typecheck`                         | Exit 0; rerun on continuation                                                                                              |
| `npm.cmd run web:typecheck`                     | Route generation and TypeScript passed, exit 0; rerun on continuation                                                      |
| `npm.cmd run web:lint`                          | Exit 0, no lint warnings/errors; rerun on continuation                                                                     |
| `npm.cmd run web:build`                         | Production build and route generation passed, exit 0; rerun on continuation                                                |
| `npm.cmd --prefix apps/web run format:check`    | All matched files use Prettier style, exit 0; rerun on continuation                                                        |
| `git diff --check` and new-file whitespace scan | Passed; no trailing whitespace or conflict markers                                                                         |
| Hosted migration verification                   | Both Phase 4A and Phase 4B applied with matching local SHA-256 checksums; Phase 4B tables present; read-only check         |
| Solidity/ABI/economics preservation             | No diff in production contracts, Ignition modules, contract exports, compiler configuration or dependencies                |
| `npm.cmd run compile`                           | Exit 0, no contracts to compile; executed earlier in this Phase 4B task                                                    |
| `npm.cmd test`                                  | 182 blockchain tests passed earlier in this task; contract sources remain unchanged                                        |
| Four Hardhat EVM verification scripts below     | All passed earlier in this task against actual isolated production contracts; no later changes to those adapters/contracts |
| Original handoff Storage readiness              | Historical `storage_setup`; credentials/private bucket verified read-only in the correction above                          |

The upload-expiry fix releases the upload button's pending lock in `finally` while suppressing private results/callbacks from an expired or changed SIWE identity. Its regression holds an acknowledged upload response, expires the real isolated database session, releases the late response, signs in again and verifies that upload is enabled, stale success text stays hidden, only one object exists and no blockchain transaction was sent. It passed on desktop, tablet and mobile, both in the focused run and the final full suite.

At the original Phase 4B handoff, Storage configuration failed with `storage_setup` because the configured key was not an accepted legacy service-role JWT. That historical blocker is now resolved: the follow-up read-only checks above verified accepted credentials and the matching private bucket. Hosted object writes and the actual MetaMask walkthrough still require manual verification. No credentials were changed by Codex.

Commands executed during implementation:

```powershell
npm.cmd run compile
npm.cmd test
npm.cmd run typecheck
npm.cmd --prefix apps/web run test:unit
npx.cmd hardhat run apps/web/scripts/verify-escrow-workflow.ts
npx.cmd hardhat run apps/web/scripts/verify-arbitration-workflow.ts
npx.cmd hardhat run apps/web/scripts/verify-backend-workflow.ts
npx.cmd hardhat run apps/web/scripts/verify-files-workflow.ts
npm.cmd run web:typecheck
npm.cmd run web:lint
npm.cmd run web:build
npm.cmd --prefix apps/web run format:check
$env:PLAYWRIGHT_PORT='3001'
$env:PLAYWRIGHT_CHANNEL='chrome'
npm.cmd run web:test
git diff --check
```

Formatting fixes used the installed Prettier formatter. Focused browser runs also covered `tests/files.spec.ts`, creation regressions and the existing counterparty-response test before full-suite runs. Initial verification caught and corrected a new verification-script argument error, duplicate file listings, a response confirmation dialog closing too early and React ref/format issues. The response dialog now explicitly remains visible during file association, preserving the existing regression expectations. New browser teardown closes the page before disposing its isolated backend so polling cannot escape to the developer's RPC; no existing tests were weakened.

Phase 4B is ready for **code review**, with automated verification complete. Hosted Storage configuration and the manual Supabase/MetaMask walkthrough remain outstanding. No production Solidity/economic change, database reset, commit, push, public deployment or Phase 5 implementation was performed. Only this report was completed during continuation; application features were preserved.

Known limitations: no malware scanning (MIME/magic checks are not antivirus), end-to-end encryption, external immutable timestamp/notarization of supplemental evidence, object-lock backups, content moderation or general file formats. API downloads buffer at most 20 MiB; upload default is 10 MiB. Limits are per wallet/window and 20 retained records per participant/milestone (40 total, with separate allowances so one party cannot exhaust the other's quota), not a distributed storage/billing quota. Server/operator and Supabase administrators retain custody and can bypass application checks; SQL triggers do not protect against an owner disabling them or an administrator changing objects. SHA-256 detects byte tampering on retrieval but does not guarantee availability or prevent privileged removal/censorship.

Phase 5 review items: dedicated runtime database role, append-only audit hardening, safe administrated orphan retention/cleanup, storage quotas/monitoring, malware quarantine, key rotation and least privilege, backup/restore, stronger availability/custody guarantees, local-chain persistence/recovery, reorg-aware indexing, external security review and a full hosted/MetaMask walkthrough. None is silently implemented here.
