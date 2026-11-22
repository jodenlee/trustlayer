import { expect, test, type Page } from "@playwright/test";
import { escrowRpc } from "../test-support/escrow-rpc";
import { TrustEscrowAbi } from "@trustlayer/contracts";
import { encodeFunctionData } from "viem";
import { accountA, accountB, installWallet } from "./wallet-fixture";
import { installAuth, signIn, switchAccount } from "./auth-fixture";

async function openProject(
  page: Page,
  state: ReturnType<typeof escrowRpc>,
  account: string = accountA,
) {
  await installWallet(page, { forwardRpc: true });
  await installAuth(page);
  await state.install(page);
  await signIn(page, "/projects/0");
  if (account !== accountA) await switchAccount(page, account);
  await expect(page.getByRole("heading", { name: "Milestones" })).toBeVisible();
}
async function confirm(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm in wallet" })
    .click();
}
test("on-chain discovery identifies the current wallet role and excludes unrelated wallets", async ({
  page,
}) => {
  const state = escrowRpc();
  await installWallet(page, { forwardRpc: true });
  await installAuth(page);
  await state.install(page);
  await signIn(page, "/projects");
  await expect(
    page.getByRole("table", { name: "On-chain wallet projects" }),
  ).toContainText("client");
  await switchAccount(page, accountB);
  await expect(
    page.getByRole("table", { name: "On-chain wallet projects" }),
  ).toContainText("freelancer");
  await switchAccount(page, `0x${"3".repeat(40)}`);
  await expect(
    page.getByRole("heading", { name: "No on-chain projects yet" }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});
test("project discovery shows a loading state instead of fabricated zero projects", async ({
  page,
}) => {
  const state = escrowRpc();
  await installWallet(page, { forwardRpc: true });
  await installAuth(page);
  await state.install(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const selector = encodeFunctionData({
    abi: TrustEscrowAbi,
    functionName: "nextProjectId",
  });
  await page.route("http://127.0.0.1:8545/**", async (route) => {
    const request = route.request().postDataJSON();
    if (request.method === "eth_call" && request.params?.[0]?.data === selector)
      await gate;
    await route.fallback();
  });
  await signIn(page, "/projects");
  await expect(
    page.getByRole("status").filter({ hasText: "Loading on-chain projects" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No on-chain projects yet" }),
  ).toHaveCount(0);
  release();
  await expect(
    page.getByRole("table", { name: "On-chain wallet projects" }),
  ).toContainText("client");
});
test("approval is exact, cannot duplicate while pending, and is separate from funding", async ({
  page,
}) => {
  const state = escrowRpc();
  await openProject(page, state);
  state.defer(true);
  await confirm(page, "1. Approve mUSD");
  await expect(
    page.getByText("Waiting for confirmation…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "1. Approve mUSD" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "2. Fund escrow" }),
  ).toBeDisabled();
  expect(state.writes).toEqual(["approve"]);
  expect(state.projects[0].remaining).toBe(0n);
  state.defer(false);
  await expect(
    page.getByRole("button", { name: "2. Fund escrow" }),
  ).toBeEnabled({ timeout: 15_000 });
  expect(state.writes).toEqual(["approve"]);
  await confirm(page, "2. Fund escrow");
  await expect(
    page.getByText("Awaiting acceptance", { exact: true }),
  ).toBeVisible();
  expect(state.writes).toEqual(["approve", "fundProject"]);
  expect(state.projects[0].remaining).toBe(100_000_000n);
});
test("insufficient mUSD displays a useful error and disables approval/funding", async ({
  page,
}) => {
  const state = escrowRpc({ balance: 1n });
  await openProject(page, state);
  await expect(
    page.getByRole("alert", { name: "Funding balance" }),
  ).toContainText("Insufficient mUSD balance");
  await expect(
    page.getByRole("button", { name: "1. Approve mUSD" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "2. Fund escrow" }),
  ).toBeDisabled();
  expect(state.writes).toEqual([]);
});
test("only the named freelancer can accept a funded project", async ({
  page,
}) => {
  const state = escrowRpc({ state: 1 });
  await openProject(page, state);
  await expect(
    page.getByRole("button", { name: "Accept project", exact: true }),
  ).toHaveCount(0);
  await switchAccount(page, accountB);
  await expect(
    page.getByRole("button", { name: "Accept project", exact: true }),
  ).toBeEnabled();
  await confirm(page, "Accept project");
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  expect(state.writes).toEqual(["acceptProject"]);
});
test("submission accepts a non-sensitive hash and displays confirmed review deadline", async ({
  page,
}) => {
  const state = escrowRpc({ state: 2 });
  await openProject(page, state, accountB);
  await page
    .getByLabel("Deliverable fingerprint (SHA-256)")
    .fill("private file contents");
  await expect(
    page.getByRole("button", { name: "Submit milestone", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Deliverable fingerprint (SHA-256)")
    .fill(`0x${"a".repeat(64)}`);
  await confirm(page, "Submit milestone");
  await expect(page.getByText("In review", { exact: true })).toBeVisible();
  await expect(page.getByText(/Review deadline/)).toBeVisible();
  expect(state.writes).toEqual(["submitMilestone"]);
});
test("client approval displays gross, exact fee and net, then records actual settlement", async ({
  page,
}, testInfo) => {
  const state = escrowRpc({ state: 2, milestoneState: 1 });
  await openProject(page, state);
  const allocation = page.getByLabel("Payout if approved");
  await expect(allocation).toContainText("100.00");
  await expect(allocation).toContainText("1.00");
  await expect(allocation).toContainText("99.00");
  await confirm(page, "Approve & pay milestone");
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Confirmed on-chain events" }),
  ).toContainText("Milestone settled");
  await expect(
    page.getByRole("table", { name: "Confirmed on-chain events" }),
  ).toContainText("Freelancer net 99.00");
  expect(state.writes).toEqual(["approveMilestone"]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("settled-on-chain-project.png"),
    fullPage: true,
    scale: "css",
  });
});
test("changing wallet invalidates an open financial review dialog", async ({
  page,
}) => {
  const state = escrowRpc();
  await openProject(page, state);
  await page
    .getByRole("button", {
      name: "1. Approve mUSD",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Approve mUSD for escrow" }),
  ).toBeVisible();
  await page.evaluate(
    (address) => window.__testWallet.account(address),
    accountB,
  );
  // The session is revoked and the review dialog disappears with the page.
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fprojects%2F0&ended=1/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirm in wallet", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.__testWallet.calls.includes("eth_sendTransaction"),
    ),
  ).toBe(false);
  expect(state.writes).toEqual([]);
});
test("fresh preflight cannot approve a later milestone than the one reviewed", async ({
  page,
}) => {
  const state = escrowRpc({ state: 2, milestoneState: 1 });
  const project = state.projects[0];
  project.milestones.push({ ...project.milestones[0] });
  project.total *= 2n;
  project.remaining = project.total;
  await openProject(page, state);
  await page
    .getByRole("button", { name: "Approve & pay milestone", exact: true })
    .click();
  project.current = 1;
  project.milestones[0].state = 3;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm in wallet", exact: true })
    .click();
  await expect(
    page.getByText(/current milestone changed since review/),
  ).toBeVisible();
  expect(state.writes).toEqual([]);
});

test("timeout release remains unavailable until chain time is strictly after reviewEnd", async ({
  page,
}) => {
  const state = escrowRpc({ state: 2, milestoneState: 1 });
  await openProject(page, state, accountB);
  await expect(
    page.getByRole("button", {
      name: "Release payment after review period",
      exact: true,
    }),
  ).toHaveCount(0);
  state.advance(state.projects[0].milestones[0].reviewEnd + 1n);
  await page.getByText("Technical details", { exact: true }).click();
  await page
    .getByRole("button", { name: "Refresh project", exact: true })
    .click();
  await confirm(page, "Release payment after review period");
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  expect(state.writes).toEqual(["releaseAfterReviewTimeout"]);
});
for (const stateValue of [2, 3])
  test(`frozen or settled milestone ${stateValue} cannot be paid through the UI`, async ({
    page,
  }) => {
    const state = escrowRpc({ state: 2, milestoneState: stateValue });
    await openProject(page, state);
    await expect(
      page.getByRole("button", {
        name: "Approve & pay milestone",
        exact: true,
      }),
    ).toHaveCount(0);
    await switchAccount(page, accountB);
    await expect(
      page.getByRole("heading", { name: "Milestones" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit milestone", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Release payment after review period",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(state.writes).toEqual([]);
  });
test("wallet transaction rejection never deposits tokens", async ({ page }) => {
  const state = escrowRpc();
  await openProject(page, state);
  state.reject();
  await confirm(page, "1. Approve mUSD");
  await expect(
    page.getByText("Request rejected in your wallet. Nothing was confirmed.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(state.writes).toEqual([]);
  expect(state.projects[0].remaining).toBe(0n);
});
test("reverted receipt is not displayed as confirmed funding", async ({
  page,
}) => {
  const state = escrowRpc({ allowance: 100_000_000n });
  await openProject(page, state);
  state.revert();
  await confirm(page, "2. Fund escrow");
  await expect(
    page.getByText("Transaction failed", { exact: true }),
  ).toBeVisible();
  expect(state.projects[0].remaining).toBe(0n);
  expect(state.projects[0].state).toBe(0);
});
test("creation confirms receipt project ID and labels metadata as session-only", async ({
  page,
}) => {
  const state = escrowRpc({ empty: true });
  await installWallet(page, { forwardRpc: true, persistAuthorization: true });
  await installAuth(page);
  await state.install(page);
  // No persistent metadata store is available: details stay session-only.
  await page.route("**/api/projects/**", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 503,
          json: { error: { message: "Isolated metadata unavailable" } },
        })
      : route.fallback(),
  );
  await signIn(page, "/projects/new");
  await page.getByLabel("Project name").fill("Browser agreement");
  await page.getByLabel("Scope of work").fill("Session-only scope");
  await page.getByLabel("Freelancer wallet address").fill(accountB);
  await page.getByLabel("Deliverable", { exact: true }).fill("Design handoff");
  await page.getByLabel("Amount (mUSD)").fill("100.123456");
  await page.getByLabel("Due date (UTC)").fill("2030-12-31");
  await page.getByRole("button", { name: "Review draft", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create project in wallet", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects\/0$/);
  await expect(
    page.getByRole("heading", { name: "Browser agreement", exact: true }),
  ).toBeVisible();
  await page.getByText("Technical details", { exact: true }).click();
  await expect(
    page.getByText("This browser session only", { exact: true }),
  ).toBeVisible();
  expect(state.writes).toEqual(["createProject"]);
  expect(state.projects[0].state).toBe(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Project #0", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No saved description for this project."),
  ).toBeVisible();
  await page.getByText("Technical details", { exact: true }).click();
  await expect(page.getByText("Not available", { exact: true })).toBeVisible();
});
