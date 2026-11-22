import { test, expect, type Page } from "@playwright/test";
import { escrowRpc } from "../test-support/escrow-rpc";
import { installWallet, accountB } from "./wallet-fixture";
import { installAuth, signIn } from "./auth-fixture";

async function reviewProject(
  page: Page,
  state: ReturnType<typeof escrowRpc>,
  deferSigning = false,
) {
  await installWallet(page, { forwardRpc: true, deferSigning });
  await installAuth(page);
  await state.install(page);
  // Saving descriptive details succeeds after a confirmed creation.
  await page.route("**/api/projects/**", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          json: {
            project: {
              id: "fixture",
              title: "Creation regression",
              description: "Public test scope",
              revision: 1,
              milestones: [],
            },
          },
        })
      : route.fallback(),
  );
  await signIn(page, "/projects/new");
  await page.getByLabel("Project name").fill("Creation regression");
  await page.getByLabel("Scope of work").fill("Public test scope");
  await page.getByLabel("Freelancer wallet address").fill(accountB);
  await page.getByLabel("Deliverable", { exact: true }).fill("Handoff");
  await page.getByLabel("Amount (mUSD)").fill("100.123456");
  await page.getByLabel("Due date (UTC)").fill("2030-12-31");
  await page.getByRole("button", { name: "Review draft", exact: true }).click();
  return page.getByRole("dialog", { name: "Review your project draft" });
}

test("zero ETH creation shows the gas error in the open review dialog", async ({
  page,
}) => {
  const state = escrowRpc({ empty: true, balance: 0n, ethBalance: 0n });
  const dialog = await reviewProject(page, state);
  await dialog
    .getByRole("button", { name: "Create project in wallet", exact: true })
    .click();
  await expect(
    dialog.getByText(/Insufficient local ETH for gas/),
  ).toBeInViewport();
  expect(state.writes).toEqual([]);
  expect(state.projects).toEqual([]);
  await expect(page).toHaveURL(/\/projects\/new$/);
});

test("zero mUSD creation visibly waits for the wallet and receipt before navigating", async ({
  page,
}) => {
  const state = escrowRpc({ empty: true, balance: 0n });
  state.defer(true);
  const dialog = await reviewProject(page, state, true);
  const create = dialog.getByRole("button", {
    name: "Create project in wallet",
    exact: true,
  });
  await create.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__testWallet.calls.filter((m) => m === "eth_sendTransaction")
            .length,
      ),
    )
    .toBe(1);
  await expect(dialog.getByText(/Confirm it when prompted/)).toBeInViewport();
  await expect(
    dialog.getByRole("button", { name: "Creating project…", exact: true }),
  ).toBeDisabled();
  await expect(page).toHaveURL(/\/projects\/new$/);
  await page.evaluate(() => window.__testWallet.confirmSigning());
  await expect(
    dialog.getByText("Waiting for confirmation…", { exact: true }),
  ).toBeVisible();
  await dialog.getByText("Transaction details", { exact: true }).click();
  await expect(dialog.locator(".hash-full")).toHaveText(/^0x[\da-f]{64}$/i);
  expect(state.writes).toEqual(["createProject"]);
  state.defer(false);
  await expect(page).toHaveURL(/\/projects\/0$/);
  await expect(
    page.getByText(
      "Project #0 created on-chain. Metadata synchronized. Funding is a separate step.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(state.projects[0].state).toBe(0);
  expect(state.projects[0].remaining).toBe(0n);
});

for (const failure of ["rejection", "RPC", "revert", "manifest"] as const)
  test(`creation ${failure} remains visible in the review dialog without navigation`, async ({
    page,
  }) => {
    const state = escrowRpc({ empty: true, balance: 0n });
    const dialog = await reviewProject(page, state);
    if (failure === "rejection") state.reject();
    if (failure === "revert") state.revert();
    if (failure === "RPC") state.failRpc("eth_estimateGas");
    if (failure === "manifest") state.manifest.ephemeral = true;
    await dialog
      .getByRole("button", { name: "Create project in wallet", exact: true })
      .click();
    await expect(
      dialog.getByText(
        failure === "rejection"
          ? /Request rejected in your wallet/
          : failure === "revert"
            ? /mined transaction reverted/
            : failure === "manifest"
              ? /ephemeral verification deployment/
              : /local RPC or wallet request failed/,
      ),
    ).toBeInViewport();
    await expect(page).toHaveURL(/\/projects\/new$/);
    expect(state.projects).toEqual([]);
    expect(state.writes).toEqual(failure === "revert" ? ["createProject"] : []);
  });

test("creation extracts a nonzero ID from the confirmed receipt", async ({
  page,
}) => {
  const state = escrowRpc({ balance: 0n });
  const dialog = await reviewProject(page, state);
  await dialog
    .getByRole("button", { name: "Create project in wallet", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects\/1$/);
  expect(state.writes).toEqual(["createProject"]);
});

test("invalid creation draft shows validation without signing", async ({
  page,
}) => {
  const state = escrowRpc({ empty: true, balance: 0n });
  const dialog = await reviewProject(page, state);
  await dialog
    .getByRole("button", { name: "Continue editing", exact: true })
    .click();
  await page.getByLabel("Amount (mUSD)").fill("0");
  await page.getByRole("button", { name: "Review draft", exact: true }).click();
  await expect(
    page.getByRole("alert", { name: "Draft validation" }),
  ).toContainText("positive mUSD amount");
  await expect(dialog).not.toBeVisible();
  expect(state.writes).toEqual([]);
});

for (const change of ["chain", "disconnect"] as const)
  test(`creation review ${change} change ends the session and prevents signing`, async ({
    page,
  }) => {
    const state = escrowRpc({ empty: true, balance: 0n });
    const dialog = await reviewProject(page, state);
    await page.evaluate((change) => {
      if (change === "chain") window.__testWallet.chain(1);
      else window.__testWallet.disconnect();
    }, change);
    // The signed-in identity no longer matches: the session is revoked, the
    // review dialog disappears and nothing can be signed.
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fprojects%2Fnew/);
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Create project in wallet" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        window.__testWallet.calls.includes("eth_sendTransaction"),
      ),
    ).toBe(false);
    expect(state.writes).toEqual([]);
  });
