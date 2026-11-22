import { test, expect, type Page } from "@playwright/test";
import { escrowRpc } from "../test-support/escrow-rpc";
import { installWallet, accountB } from "./wallet-fixture";
import { installAuth, signIn } from "./auth-fixture";

/** Transaction confirmation regressions for stale wallet nonces and slow receipts. */
async function openDraft(page: Page, state: ReturnType<typeof escrowRpc>) {
  await installWallet(page, { forwardRpc: true, persistAuthorization: true });
  await installAuth(page);
  await state.install(page);
  await page.route("**/api/projects/**", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          json: {
            project: {
              id: "fixture",
              title: "Confirmation regression",
              description: "Public test scope",
              revision: 1,
              milestones: [],
            },
          },
        })
      : route.fallback(),
  );
  await signIn(page, "/projects/new");
}
async function review(page: Page) {
  await page.getByLabel("Project name").fill("Confirmation regression");
  await page.getByLabel("Scope of work").fill("Public test scope");
  await page.getByLabel("Freelancer wallet address").fill(accountB);
  await page.getByLabel("Deliverable", { exact: true }).fill("Handoff");
  await page.getByLabel("Amount (mUSD)").fill("10");
  await page.getByLabel("Due date (UTC)").fill("2030-12-31");
  await page.getByRole("button", { name: "Review draft", exact: true }).click();
  return page.getByRole("dialog", { name: "Review your project draft" });
}
const sends = (page: Page) =>
  page.evaluate(
    () =>
      window.__testWallet.calls.filter((m) => m === "eth_sendTransaction")
        .length,
  );

test("a stale wallet nonce is reported as stuck, blocks duplicates across refresh, and recovers explicitly", async ({
  page,
}) => {
  const state = escrowRpc({ empty: true, balance: 0n });
  await openDraft(page, state);
  state.nonceGapNext(4);
  const dialog = await review(page);
  await dialog
    .getByRole("button", { name: "Create project in wallet", exact: true })
    .click();
  // Detected from the node well before the 60-second receipt timeout.
  await expect(
    dialog.getByText("Stuck: wallet nonce is ahead of the chain", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    dialog.getByText(
      /signed this transaction with nonce 4, but this chain expects nonce 0/,
    ),
  ).toBeVisible();
  expect(state.writes).toEqual([]);
  expect(state.projects).toEqual([]);
  expect(state.queued()).toHaveLength(1);
  // The same attempt cannot be resubmitted from this page.
  await expect(
    dialog.getByRole("button", { name: "Create project in wallet" }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Check receipt again", exact: true })
    .click();
  await expect(
    dialog.getByRole("alert", { name: "Project creation" }),
  ).toContainText("expects nonce 0");
  expect(await sends(page)).toBe(1);

  // A refresh loses this tab's memory, but the node still holds the stuck
  // transaction: a new attempt is refused before any wallet request.
  await page.reload();
  await expect(page.getByLabel("Project name")).toBeVisible();
  const again = await review(page);
  await again
    .getByRole("button", { name: "Create project in wallet", exact: true })
    .click();
  await expect(
    again.getByText(/stuck in the local node \(nonce 4; the chain expects 0\)/),
  ).toBeVisible();
  expect(await sends(page)).toBe(0);
  expect(state.queued()).toHaveLength(1);
  await page.keyboard.press("Escape");

  // Transactions shows the node's view and the safe recovery procedure.
  await page.goto("/transactions");
  const panel = page.getByRole("region", { name: "Waiting in the local node" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Stuck (nonce gap)")).toBeVisible();
  await expect(panel.getByText(/dev:drop-queued/)).toBeVisible();
  await expect(panel.getByText(/Clear activity and nonce data/)).toBeVisible();

  // After the operator explicitly drops the queued entry, one attempt succeeds.
  state.dropQueued();
  await page.goto("/projects/new");
  const final = await review(page);
  await final
    .getByRole("button", { name: "Create project in wallet", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects\/0$/);
  expect(state.writes).toEqual(["createProject"]);
  expect(state.projects).toHaveLength(1);
});

test("a receipt timeout is not a failure: rechecking recovers the same project once", async ({
  page,
}) => {
  const state = escrowRpc({ empty: true, balance: 0n });
  await page.clock.install();
  await openDraft(page, state);
  state.defer(true);
  const dialog = await review(page);
  await dialog
    .getByRole("button", { name: "Create project in wallet", exact: true })
    .click();
  await expect(
    dialog.getByText("Waiting for confirmation…", { exact: true }),
  ).toBeVisible();
  await page.clock.runFor(65_000);
  await expect(
    dialog.getByText("Confirmation unknown", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText(/do not assume failure/)).toBeVisible();
  // Fast-forwarding also expires the periodic deployment check; re-verify as a
  // user would. Rechecking must never require resubmitting.
  await page.keyboard.press("Escape");
  const setup = page.getByRole("alert", { name: "Deployment setup" });
  if (await setup.isVisible())
    await setup.getByRole("button", { name: "Retry verification" }).click();
  await expect(setup).toBeHidden();
  await page
    .getByRole("button", { name: "Check pending creation", exact: true })
    .click();
  await expect(
    dialog.getByText("Confirmation unknown", { exact: true }),
  ).toBeVisible();
  // No duplicate can be sent while the original is unresolved.
  await expect(
    dialog.getByRole("button", { name: /^Create project/ }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Check receipt again", exact: true })
    .click();
  await expect(
    dialog.getByRole("alert", { name: "Project creation" }),
  ).toContainText(/do not resubmit|Still waiting/i);
  // The receipt eventually appears; recovery reads the canonical ID from it.
  state.defer(false);
  await dialog
    .getByRole("button", { name: "Check receipt again", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects\/0$/);
  await expect(
    page.getByText(
      "Project #0 created on-chain. Metadata synchronized. Funding is a separate step.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(state.writes).toEqual(["createProject"]);
  expect(state.projects).toHaveLength(1);
  expect(await sends(page)).toBe(1);
});
