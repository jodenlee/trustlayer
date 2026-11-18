# Phase 3A — Frontend foundation and design system

## Scope and architecture

The Next.js App Router app lives in `apps/web`, with its own package.json, package-lock.json and node_modules. Root scripts forward to the app without npm workspaces or changes to root Hardhat dependencies. Solidity 0.8.28, all deployment modules and generated contract artifacts are preserved.

New app dependencies are Next.js 16.4.6, React 19.3.1, Tailwind 4.3.5, Lucide React 1.74.0 and locally bundled Inter Variable. TypeScript stays on the repository's 5.9 line. ESLint 9.39.4 matches the current eslint-plugin-react peer range (through 9); no forced ESLint 10 peer overrides are used. Node 22.13+ is the repository baseline; this environment used Node 25.6.1/npm 11.9.0.

The root layout owns the local font, metadata and preview context. `(public)` provides the landing layout; `(workspace)` provides sidebar/header/mobile navigation, preview notice, loading and error states. Server route components resolve known preview IDs and return not-found for unknown projects/cases. Client components own filters, dialogs, draft form validation and session preferences. The initial state is deterministic; dates use explicit UTC formatting and no clock-dependent countdown is rendered.

There are no route handlers, server actions, wallet providers, RPC calls, signing, token approvals, real transactions, uploads or backend persistence. Contract-related buttons are disabled. The wallet placeholder opens an explanatory dialog and makes no connection request.

## Application structure

```text
apps/web/
  src/app/
    (public)/                    landing page and separate public layout
    (workspace)/                 shared shell and all application routes
    globals.css                  semantic design styles and Tailwind theme
    icon.svg                     local brand icon
    layout.tsx                   metadata, bundled font and preview providers
    not-found.tsx                useful unknown-route fallback
  src/components/                reusable primitives, shell and page compositions
  src/lib/
    models.ts                    typed UI models with bigint token quantities
    preview-data.ts              isolated fictional projects/cases
    format.ts                    exact six-decimal amounts and explicit UTC dates
    blockchain/config.ts         metadata only, no RPC/provider initialization
    blockchain/types.ts          type-only references to existing contract package
    blockchain/hooks/README.md   future hook/adaptor responsibilities
  tests/workspace.spec.ts        production-browser route and interaction tests
  playwright.config.ts           desktop, tablet and phone projects
```

## Route inventory

| Route | Implemented interface |
| --- | --- |
| `/` | Protocol introduction, illustrative escrow plan, process, dispute timeline, juror rules |
| `/dashboard` | Sample active projects, escrow, pending milestones, disputes, attention items and illustrative activity |
| `/projects` | Search, state filters, milestone progress, project links and empty results |
| `/projects/new` | Local draft form, 1–5 milestone editing, exact amount validation and review dialog |
| `/projects/[id]` | Participants, funding overview, sequential milestones, review/submission/dispute states |
| `/disputes` | Case filters, frozen funds, response/voting states and deadlines |
| `/disputes/[id]` | Milestone context, evidence placeholder, jurors, UTC timeline and unfinalized outcome |
| `/juror` | Sample deposited/available/locked stake, assignment, vote placeholder and empty rewards |
| `/transactions` | Honest empty history; typed table is prepared for type/status/amount/time/hash |
| `/settings` | Wallet/network placeholders, session display name, precision preference and light appearance |

Five fictional project IDs (`tl-1039`, `tl-1042` through `tl-1045`) and two case IDs (`dp-2001`, `dp-2002`) are available. States and dates are fixed illustrations, not live chain observations. Transaction history intentionally has no fixtures, hashes or confirmations. No dispute result is invented. Global sample/empty mode persists during client-side navigation; detail pages suppress sample records in empty mode. Refresh resets all preferences and unsaved drafts.

## Components and design system

| Component area | Inventory |
| --- | --- |
| Shell | Logo, desktop sidebar, active navigation, mobile dialog drawer, breadcrumb header, disconnected status, wallet placeholder, footer, skip link |
| Layout | PageHeading, Card, CardHeading, StatCard, shared form sections and responsive detail grids |
| Controls | Button/ButtonLink variants, Input/Field, textareas, search, pressed-state filters, precision toggle |
| Data | Generic DataTable, ProjectTable, Money, StatusBadge, MilestoneProgress, TimelineItem, TransactionStatus |
| Feedback | EmptyState, Skeleton/LoadingPage, error boundary, not-found view, Dialog, dismissible toast notifications |

Light surfaces use white and `#f6f8fb`, navy `#172d46`, muted blue `#4269a2`, subtle borders, 7–11px control/card radii and restrained green/amber/red status tones. Inter is installed locally to avoid build/runtime font-network dependencies. Monetary values use tabular numerals. No decorative application illustrations, gradients or gratuitous animation are used.

At 1024px the sidebar becomes mobile navigation. Below 768px metrics use two columns, detail/form sidebars stack, and table rows become labeled cards without document-level horizontal scrolling. Full six-decimal balances have a smaller responsive treatment. Native modal dialogs provide focus containment, Escape dismissal, focus restoration, labeled headings and scroll locking. Navigation uses aria-current, filters use aria-pressed, inputs have explicit labels, progress bars expose numeric values, and toasts use a polite live region. This is not a formal accessibility audit.

## Data and protocol boundaries

Models store token amounts as bigint six-decimal base units. Parsing rejects zero, negative values, more than six decimal places, and uint256 overflow. Formatting does not convert through floating-point numbers. Draft review validates non-zero EVM-shaped freelancer addresses, required scope, 1–5 milestones and increasing UTC due dates with the first beyond the 7-day acceptance window. This is preview validation; future submission must revalidate against chain time, contract rules, account identity and checksum/metadata requirements.

The preview reflects 1% of freelancer payouts, full-budget funding, sequential settlement, 72-hour review, frozen disputed milestones, opener-paid 15 mUSD, 12-hour response then 24-hour voting, three jurors, majority or 50/50 fallback, 100 mUSD available stake per assignment and 4 mUSD reserved per assigned juror after finalization. Selection is described as deterministic, not secure randomness. Stakes, escrow, rewards and treasury are distinct concepts throughout the UI.

`@trustlayer/contracts` is a local file dependency. The only package addition is an additive `./metadata` export pointing to existing chain/name/decimal constants; generated files are unchanged. `config.ts` imports those constants. `types.ts` references existing LocalDeployment and inferred getContracts types without a runtime client. No page contains deployment addresses or duplicate ABIs, and no ephemeral manifest is auto-loaded.

## Development and verification commands

From the repository root (use npm.cmd on PowerShell where npm.ps1 is disabled):

```powershell
npm.cmd --prefix apps/web ci
npm.cmd run web:dev
# http://127.0.0.1:3000

npm.cmd run web:lint
npm.cmd run web:typecheck
npm.cmd run web:build
npm.cmd run web:start
npm.cmd --prefix apps/web run format:check

# Stop any existing server on port 3000 before browser tests.
npm.cmd --prefix apps/web exec -- playwright install chromium
npm.cmd run web:test
# Alternative: installed Chrome, without downloading bundled Chromium
$env:PLAYWRIGHT_CHANNEL='chrome'
npm.cmd run web:test

# Unchanged blockchain checks; run sequentially.
npm.cmd run compile
npm.cmd test
npm.cmd run typecheck
```

`web:test` owns a production server at 127.0.0.1:3000 and stops it afterward. Build first. Screenshots and failed-run traces go to ignored `apps/web/test-results/`. The suite exercises required routes at desktop (1440×1000), tablet (820×1180) and mobile (390×664 CSS pixels), console/page errors, overflow, navigation/filtering, empty states, wallet dialog/Escape/focus, draft validation/precision/range, session toasts/preferences, private-evidence dialog, honest transaction emptiness and unknown routes. Four screenshots per viewport support visual inspection; these are review captures, not pixel-baseline assertions.

## Verification results (2026-11-18)

| Command | Actual result |
| --- | --- |
| `npm.cmd run web:build` | Exit 0; Next.js 16.4.6 optimized build, TypeScript success, 18 static pages generated including icon and not-found; all required route patterns present |
| `npm.cmd run web:lint` | Exit 0; 0 errors and 0 warnings (`--max-warnings 0`) |
| `npm.cmd run web:typecheck` | Exit 0; route type generation and `tsc --noEmit` pass |
| `$env:PLAYWRIGHT_CHANNEL='chrome'; npm.cmd run web:test` | Exit 0; **60 passed (33.9s)**, 20 checks per viewport; no route console/page errors or document overflow detected |
| `npm.cmd --prefix apps/web run format:check` | Exit 0; all matched files use Prettier style |
| `git diff --check` | Exit 0; Git prints only Windows LF/CRLF conversion notices |
| `npm.cmd run compile` | Exit 0; no contracts to compile after successful compilation during the regression run |
| `npm.cmd test` | Exit 0; **156 passing (156 nodejs)** |
| `npm.cmd run typecheck` | Exit 0; root Hardhat/test/script/contracts-package TypeScript passes |

Blockchain regression executed successfully: **156 passing (156 nodejs)**. Standalone `npm.cmd run compile` exited 0 with “No contracts to compile”; the preceding regression run compiled 16 Solidity files with solc 0.8.28. Root TypeScript exited 0. An initial concurrent compile/test attempt caused an artifact-cache ENOENT; running compilation after tests resolved it without source changes. Run those commands sequentially.

An initial browser pass had 29 passes/31 failures: 28 route-console failures from the missing icon and three draft test selectors matching Next's route announcer as well as the form alert. A local icon and explicitly labeled validation alert fixed these causes; the full rerun passed. Initial lint reported one anonymous-default-export warning, fixed by naming the PostCSS config object.

The native graphical browser connection was unavailable (computer-use native pipe could not connect). Browser automation uses installed Chrome in headless mode. Desktop, tablet and mobile captures have been visually inspected; no headed/manual browser walkthrough or Safari/Firefox/device-hardware verification is claimed. A bundled Chromium installation was started; after Chromium and FFmpeg downloaded, its remaining headless-shell download was stopped because installed Chrome had already passed the full suite. Use the documented Chrome channel or finish the install command before using Playwright's default channel.

## Known limitations and dependency audit

This is a UI foundation, not an operational dApp. No real balances, permissions, deadlines, votes, results or confirmations are read. Evidence has no storage/access control yet. Sample dates do not tick forward; preferences and drafts are memory-only. Sample juror identities do not represent verified independent people. TransactionStatus is prepared for future receipts but the history remains empty. Loading/error views exist, while static preview routes do not simulate network delays.

`npm.cmd --prefix apps/web audit --omit=dev --json` reports **0 production vulnerabilities**. Full audit currently reports **14 high-severity development dependency findings** cascading from [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) in picomatch (through 4.0.7; no patched release listed). These tools process repository-owned lint globs here; untrusted glob inputs must not be introduced. Do not force npm's suggested major framework downgrade. ESLint 9 also emits an upstream end-of-support notice; upgrading to 10 awaits compatible React lint-plugin peers. Recheck both during dependency maintenance. These findings do not make the current preview production-ready.

## Phase 3B requirements (not implemented or authorized here)

After approval, add Wagmi/Viem providers and account/chain-aware read adapters. Supply a freshly exported persistent local deployment, call parseLocalDeployment and assertDeploymentOnChain, then use getContracts with the wallet's actual chain. Chain ID alone is insufficient after a reset. Invalidate state on account/chain changes, read mutable authorities, convert real contract states into UI models, handle RPC/error/loading states and derive deadlines from chain time.

Any later transaction work requires explicit allowance/receipt/revert handling, current role/state validation, correct bigint accounting, real hashes and verified confirmations. Private evidence needs separate authenticated storage and authorization; no confidential content belongs on-chain. Keep juror selection claims and protocol economics unchanged. Review Phase 3A before approving any further phase.

Framework setup references: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Next.js ESLint](https://nextjs.org/docs/app/api-reference/config/eslint), [Tailwind with Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs).
