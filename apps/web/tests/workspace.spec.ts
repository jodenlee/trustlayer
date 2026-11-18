import { expect, test } from "@playwright/test";

const routes = [
  ["/", "Good work deserves a clear path to payment."],
  ["/dashboard", "Welcome back, Alex"],
  ["/projects", "Projects"],
  ["/projects/new", "Start with a clear agreement"],
  ["/projects/tl-1042", "Brand & website refresh"],
  ["/disputes", "Disputes"],
  ["/disputes/dp-2001", "Illustration set"],
  ["/juror", "An independent perspective"],
  ["/transactions", "Transactions"],
  ["/settings", "Make yourself at home"],
] as const;

for (const [path, heading] of routes) {
  test(`renders ${path} without hydration errors or page overflow`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    if (path !== "/")
      await expect(
        page.getByText("Fictional sample data", { exact: false }),
      ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    expect(errors).toEqual([]);
  });
}

test("navigation is usable on this viewport", async ({ page }, testInfo) => {
  await page.goto("/dashboard");
  if (testInfo.project.name !== "desktop")
    await page.getByRole("button", { name: "Open navigation" }).click();
  const navigation = page
    .getByRole("navigation", { name: "Workspace navigation" })
    .filter({ visible: true });
  await navigation.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Completed", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Developer documentation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Brand & website refresh", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Search projects" })
    .fill("does not exist");
  await expect(
    page.getByRole("heading", { name: "No matching projects" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(
    page.getByRole("link", { name: "Brand & website refresh", exact: true }),
  ).toBeVisible();
});

test("empty preview is honest and persists through navigation", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Show empty state" }).click();
  await expect(
    page.getByRole("heading", { name: "Your next project starts here" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "All projects", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A fresh start for your workspace" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show sample data" }).click();
  await expect(
    page.getByRole("link", { name: "Brand & website refresh", exact: true }),
  ).toBeVisible();
});

test("wallet placeholder opens an accessible dialog without connecting", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const wallet = page.getByRole("button", {
    name: "Connect wallet",
    exact: true,
  });
  await wallet.click();
  const dialog = page.getByRole("dialog", {
    name: "Wallet connection",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(/no connection request was made/),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(wallet).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("draft validation and review never create a project or payment", async ({
  page,
}) => {
  await page.goto("/projects/new");
  await page.getByRole("button", { name: "Review draft" }).click();
  await expect(
    page.getByRole("alert", { name: "Draft validation" }),
  ).toContainText("Add a project name");
  await page.getByLabel("Project name").fill("Local preview draft");
  await page
    .getByLabel("Scope of work")
    .fill("An interface test, no private data.");
  await page
    .getByLabel("Freelancer wallet address")
    .fill(`0x${"1".repeat(40)}`);
  await page
    .getByLabel("Deliverable", { exact: true })
    .fill("A clear deliverable");
  await page.getByLabel("Amount (mUSD)").fill("10.1234567");
  const futureDate = new Date(Date.now() + 20 * 86400000)
    .toISOString()
    .slice(0, 10);
  await page.getByLabel("Due date (UTC)").fill(futureDate);
  await page.getByRole("button", { name: "Review draft" }).click();
  await expect(
    page.getByRole("alert", { name: "Draft validation" }),
  ).toContainText("at most six decimal places");
  await page.getByLabel("Amount (mUSD)").fill("10.123456");
  await page.getByRole("button", { name: "Review draft" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Review your project draft",
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("10.123456 mUSD", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Create project · wallet required" }),
  ).toBeDisabled();
  await expect(dialog.getByText("Local draft · not created")).toBeVisible();
});

test("milestone form enforces the one-to-five range", async ({ page }) => {
  await page.goto("/projects/new");
  for (let i = 0; i < 4; i++)
    await page
      .getByRole("button", { name: "Add milestone", exact: true })
      .click();
  await expect(
    page.getByRole("button", { name: /Add milestone \(limit reached\)/ }),
  ).toBeDisabled();
  await expect(page.getByLabel("Deliverable", { exact: true })).toHaveCount(5);
  await page.getByRole("button", { name: "Remove milestone 5" }).click();
  await expect(page.getByLabel("Deliverable", { exact: true })).toHaveCount(4);
});

test("session preferences update the header and token precision", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("Display name").fill("Taylor Quinn");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Display name updated for this preview session.",
  );
  await expect(page.getByRole("link", { name: "Profile settings" })).toHaveText(
    "TQ",
  );
  await page.getByLabel("Full token precision").check();
  // Keep the root provider mounted during navigation.
  if (await page.getByRole("button", { name: "Open navigation" }).isVisible())
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Overview" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Taylor" }),
  ).toBeVisible();
  await expect(page.getByText("5,350.000000", { exact: false })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});

test("dispute views show boundaries and no invented results", async ({
  page,
}) => {
  await page.goto("/disputes/dp-2001");
  await expect(page.getByText("Not finalized", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/strictly after the voting deadline/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cast vote · wallet required" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "About private evidence" }).click();
  await expect(
    page.getByRole("dialog", { name: "Private evidence" }),
  ).toContainText("does not upload or retrieve files");
});

test("transaction history does not fabricate confirmations or hashes", async ({
  page,
}) => {
  await page.goto("/transactions");
  await expect(
    page.getByRole("heading", { name: "Your transaction history starts here" }),
  ).toBeVisible();
  await expect(page.locator("table")).toHaveCount(0);
  await expect(page.getByText(/0x[\da-f]{40,}/i)).toHaveCount(0);
});

test("unknown project displays a useful not-found page", async ({ page }) => {
  await page.goto("/projects/missing");
  await expect(
    page.getByRole("heading", { name: "That page is out of scope." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to overview" }),
  ).toHaveAttribute("href", "/dashboard");
});

test("capture landing and workspace for visual review", async ({
  page,
}, testInfo) => {
  for (const [name, route] of [
    ["landing", "/"],
    ["dashboard", "/dashboard"],
    ["project-form", "/projects/new"],
    ["dispute", "/disputes/dp-2001"],
  ]) {
    await page.goto(route);
    await page.screenshot({
      path: testInfo.outputPath(`${name}.png`),
      fullPage: true,
    });
  }
});
