import { expect, test, type Page } from "@playwright/test";
import { installRpc, installWallet } from "./wallet-fixture";
import {
  completeSignIn,
  installAuth,
  signIn,
  switchAccount,
} from "./auth-fixture";
import { escrowRpc } from "../test-support/escrow-rpc";
import { accountB } from "../test-support/protocol";

const protectedRoutes = [
  ["/dashboard", "Overview"],
  ["/projects", "Projects"],
  ["/projects/new", "New project"],
  ["/disputes", "Disputes"],
  ["/juror", "Jury"],
  ["/transactions", "Transactions"],
  ["/settings", "Settings"],
] as const;

function noOverflow(page: Page) {
  return expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

for (const [path] of protectedRoutes)
  test(`signed-out visit to ${path} redirects to sign-in with its destination`, async ({
    page,
  }) => {
    await installWallet(page);
    await installRpc(page);
    await installAuth(page);
    const response = await page.goto(`${path}?tab=1`);
    // The server proxy redirects before any protected page is rendered.
    expect(response?.request().redirectedFrom()?.url()).toContain(path);
    await expect(page).toHaveURL(
      `/sign-in?next=${encodeURIComponent(`${path}?tab=1`)}`,
    );
    await expect(
      page.getByRole("heading", { name: "Sign in to TrustLayer" }),
    ).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });

test("root sends signed-out visitors to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/sign-in");
});

test("sign-in page renders cleanly and never signs automatically", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await installWallet(page, { persistAuthorization: true });
  await installRpc(page);
  await installAuth(page);
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sign in with Ethereum", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sign in with Ethereum", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.__testWallet.calls.includes("personal_sign"),
    ),
  ).toBe(false);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("signing in returns to the intended page and every protected page renders", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await installWallet(page, { persistAuthorization: true });
  await installRpc(page);
  const auth = await installAuth(page);
  await signIn(page, "/transactions");
  expect(auth.verifications()).toBe(1);
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  for (const [path, heading] of protectedRoutes) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await noOverflow(page);
  }
  expect(auth.verifications()).toBe(1);
  expect(errors).toEqual([]);
});

test("a valid session is restored after refresh without another signature", async ({
  page,
}) => {
  await installWallet(page, { persistAuthorization: true });
  await installRpc(page);
  const auth = await installAuth(page);
  await signIn(page, "/projects");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/projects$/);
  expect(auth.verifications()).toBe(1);
});

test("restoration waits for the wallet before deciding", async ({ page }) => {
  await installWallet(page, {
    persistAuthorization: true,
    deferReconnect: true,
  });
  await installRpc(page);
  await installAuth(page);
  await signIn(page, "/settings");
  await page.reload();
  await expect(page.getByText("Restoring your session…")).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
  await page.evaluate(() => window.__testWallet.resumeReconnection());
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
});

test("rejected signature is explained and nothing is signed in", async ({
  page,
}) => {
  await installWallet(page);
  await installRpc(page);
  await page.exposeFunction("__signBackendMessage", async () => {
    throw new Error("User rejected sign-in request");
  });
  const auth = await installAuth(page, { exposeSigner: false });
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign in with Ethereum", exact: true })
    .click();
  await expect(
    page.getByRole("alert", { name: "Backend authentication error" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
  expect(auth.verifications()).toBe(0);
});

test("missing wallet extension shows setup guidance", async ({ page }) => {
  await installAuth(page);
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "No browser wallet found" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in with Ethereum" }),
  ).toHaveCount(0);
});

test("wrong network must be switched before signing in", async ({ page }) => {
  await installWallet(page, { chainId: 11155111 });
  await installRpc(page);
  await installAuth(page);
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(page.getByText(/Your wallet is on Sepolia/)).toBeVisible();
  await page.getByRole("button", { name: "Switch to Hardhat Local" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in with Ethereum", exact: true }),
  ).toBeVisible();
});

test("unconfigured backend blocks sign-in with a clear message", async ({
  page,
}) => {
  await installWallet(page);
  await installRpc(page);
  await installAuth(page, { configured: false });
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    page.getByRole("alert", { name: "Backend setup" }),
  ).toContainText("Sign-in is unavailable");
});

test("switching wallet accounts ends the session and keeps the destination", async ({
  page,
}) => {
  await installWallet(page);
  await installRpc(page);
  const auth = await installAuth(page);
  await signIn(page, "/settings");
  await page.evaluate((next) => window.__testWallet.account(next), accountB);
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings&ended=1/);
  await expect(page.getByText(/Your session ended/)).toBeVisible();
  expect(auth.logouts()).toBeGreaterThan(0);
  await completeSignIn(page, "/settings");
  expect(auth.sessionFor()).toBe(accountB.toLowerCase());
});

test("explicit sign-out returns to sign-in and does not re-sign", async ({
  page,
}, testInfo) => {
  await installWallet(page);
  await installRpc(page);
  const auth = await installAuth(page);
  await signIn(page, "/dashboard");
  if (testInfo.project.name !== "desktop")
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL("/sign-in");
  await expect(
    page.getByRole("button", { name: "Sign in with Ethereum", exact: true }),
  ).toBeVisible();
  expect(auth.verifications()).toBe(1);
  // Protected pages are refused again until a new signature.
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fprojects/);
});

test("an expired session redirects to sign-in on the next check", async ({
  page,
}) => {
  await installWallet(page);
  await installRpc(page);
  const auth = await installAuth(page);
  await signIn(page, "/disputes");
  await auth.expire();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdisputes&ended=1/);
});

test("a stale session cookie cannot unlock pages or cause a redirect loop", async ({
  page,
  baseURL,
}) => {
  await installWallet(page);
  await installRpc(page);
  await installAuth(page);
  await page
    .context()
    .addCookies([{ name: "tl_session", value: "a".repeat(64), url: baseURL! }]);
  await page.goto("/juror");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fjuror/);
  await expect(
    page.getByRole("heading", { name: "Sign in to TrustLayer" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Jury" })).toHaveCount(0);
});

test("post-sign-in destinations cannot leave the application", async ({
  page,
}) => {
  await installWallet(page);
  await installRpc(page);
  await installAuth(page);
  await page.goto("/sign-in?next=https%3A%2F%2Fevil.example%2F");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await completeSignIn(page, "/dashboard");
});

test("navigation is usable on this viewport", async ({ page }, testInfo) => {
  await installWallet(page);
  await installRpc(page);
  await installAuth(page);
  await signIn(page, "/dashboard");
  if (testInfo.project.name !== "desktop")
    await page.getByRole("button", { name: "Open navigation" }).click();
  const navigation = page
    .getByRole("navigation", { name: "Workspace navigation" })
    .filter({ visible: true });
  await navigation.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(
    page.getByRole("heading", { name: "No on-chain projects yet" }),
  ).toBeVisible();
  await noOverflow(page);
});

test("draft validation and review never create a project or payment", async ({
  page,
}) => {
  await installWallet(page);
  await installRpc(page);
  await installAuth(page);
  await signIn(page, "/projects/new");
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
    .fill(`0x${"3".repeat(40)}`);
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
  await expect(dialog.getByText("Local draft · not created")).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.__testWallet.calls.includes("eth_sendTransaction"),
    ),
  ).toBe(false);
});

test("milestone form enforces the one-to-five range", async ({ page }) => {
  await installWallet(page);
  await installRpc(page);
  await installAuth(page);
  await signIn(page, "/projects/new");
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

test("profile name and token precision preferences apply across pages", async ({
  page,
}, testInfo) => {
  await installWallet(page);
  await installRpc(page, { decimals: 6 });
  await installAuth(page);
  await signIn(page, "/settings");
  await page.getByLabel("Display name").fill("Taylor Quinn");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await page.getByLabel("Full token precision").check();
  if (testInfo.project.name !== "desktop")
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Overview" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Taylor" }),
  ).toBeVisible();
  await expect(page.getByTestId("live-balance")).toContainText(/\.\d{6}/);
});

test("unknown project displays a useful not-found page", async ({ page }) => {
  await installWallet(page, { persistAuthorization: true });
  await installRpc(page);
  await installAuth(page);
  await signIn(page, "/dashboard");
  await page.goto("/projects/missing");
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to overview" }),
  ).toHaveAttribute("href", "/dashboard");
});

test("capture sign-in and workspace for visual review", async ({
  page,
}, testInfo) => {
  const state = escrowRpc();
  await installWallet(page, { forwardRpc: true, persistAuthorization: true });
  await state.install(page);
  await installAuth(page);
  await page.goto("/sign-in");
  await page.screenshot({
    path: testInfo.outputPath("sign-in.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page.screenshot({
    path: testInfo.outputPath("sign-in-connected.png"),
    fullPage: true,
  });
  await completeSignIn(page, "/dashboard");
  for (const [name, route, ready] of [
    ["dashboard", "/dashboard", "Needs your attention"],
    ["projects", "/projects", "Projects"],
    ["project", "/projects/0", "Milestones"],
    ["project-form", "/projects/new", "New project"],
    ["disputes", "/disputes", "Disputes"],
    ["jury", "/juror", "Jury"],
    ["transactions", "/transactions", "Transactions"],
    ["settings", "/settings", "Settings"],
  ] as const) {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { name: ready, exact: true }).first(),
    ).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: testInfo.outputPath(`${name}.png`),
      fullPage: true,
    });
  }
  await switchAccount(page, accountB);
  await page.goto("/projects/0");
  await expect(page.getByRole("heading", { name: "Milestones" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("project-freelancer.png"),
    fullPage: true,
  });
});
