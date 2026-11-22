import { test, expect, type Page } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { authBackend } from "../test-support/auth-backend";
import { accountB, installRpc, installWallet } from "./wallet-fixture";

test.describe("wallet and SIWE refresh persistence", () => {
  let backend: Awaited<ReturnType<typeof authBackend>>;
  test.afterEach(async ({ page }) => {
    // Stop app polling before removing RPC interception; drain HTTP bridges
    // while their isolated server is still available.
    await page.goto("about:blank");
    await page.unrouteAll({ behavior: "wait" });
    await page.close();
    await backend?.close();
  });
  async function setup(page: Page, baseURL: string, deferReconnect = false) {
    backend = await authBackend(baseURL);
    const signer = privateKeyToAccount(generatePrivateKey());
    await page.exposeFunction("__signBackendMessage", (message: string) =>
      signer.signMessage({ message }),
    );
    await installWallet(page, {
      account: signer.address,
      authSigning: true,
      persistAuthorization: true,
      deferReconnect,
    });
    await installRpc(page);
    await page.route("**/api/**", async (route) => {
      const response = await route
        .fetch({
          url: `${backend.url}${new URL(route.request().url()).pathname}`,
          headers: await route.request().allHeaders(),
        })
        .catch(() => {
          throw new Error(
            "Isolated auth backend transport failed; request headers are hidden.",
          );
        });
      await route.fulfill({ response });
    });
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings/);
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await expect(signInButton(page)).toBeEnabled();
  }
  const signInButton = (page: Page) =>
    page
      .getByRole("main")
      .getByRole("button", { name: "Sign in with Ethereum" });
  async function login(page: Page) {
    await signInButton(page).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByLabel("Display name")).toBeVisible();
  }
  const authenticated = (page: Page) => page.getByLabel("Display name");
  const onSignIn = async (page: Page) => {
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByLabel("Display name")).toHaveCount(0);
  };

  test("restores an authorized wallet after refresh without automatically signing", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!);
    await page.reload();
    await expect(signInButton(page)).toBeEnabled();
    expect(
      await page.evaluate(() =>
        window.__testWallet.calls.filter((m) =>
          /sign|eth_requestAccounts|wallet_requestPermissions/i.test(m),
        ),
      ),
    ).toEqual([]);
  });
  test("restores a database session, HttpOnly cookie and saved profile on refresh", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!);
    await login(page);
    await page.getByLabel("Display name").fill("Persistent profile");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(
      page.getByText("Profile saved.", { exact: true }),
    ).toBeVisible();
    const cookie = (await page.context().cookies()).find(
      (c) => c.name === "tl_session",
    )!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Strict");
    expect(cookie.path).toBe("/");
    expect(cookie.secure).toBe(false);
    expect(cookie.expires - Date.now() / 1000).toBeGreaterThan(28_700);
    expect(
      await page.evaluate(() => document.cookie.includes("tl_session=")),
    ).toBe(false);
    await page.reload();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByLabel("Display name")).toHaveValue(
      "Persistent profile",
    );
    expect(backend.logouts()).toBe(0);
    expect(
      await page.evaluate(() =>
        window.__testWallet.calls.includes("personal_sign"),
      ),
    ).toBe(false);
  });
  test("waits for delayed wallet reconnection without deleting a valid server session", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!, true);
    await login(page);
    const reads = backend.reads();
    await page.reload();
    await expect(page.getByText("Restoring your session…")).toBeVisible();
    await expect.poll(backend.reads).toBeGreaterThan(reads);
    expect(backend.logouts()).toBe(0);
    await expect(page.getByLabel("Display name")).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings$/);
    await page.evaluate(() => window.__testWallet.resumeReconnection());
    await expect(authenticated(page)).toBeVisible();
    await expect(page).toHaveURL(/\/settings$/);
    expect(backend.logouts()).toBe(0);
  });
  test("expired database sessions show Sign In after a restored wallet", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!);
    await login(page);
    backend.expire();
    await page.reload();
    await onSignIn(page);
    await expect(signInButton(page)).toBeEnabled();
    expect(
      (await page.context().cookies()).some((c) => c.name === "tl_session"),
    ).toBe(false);
  });
  test("a different restored account revokes the previous backend identity", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!);
    await login(page);
    // Simulate an account changed in MetaMask while the page is closed/reloading.
    await page.evaluate(
      (address) => sessionStorage.setItem("test-wallet-account", address),
      accountB,
    );
    await page.reload();
    await onSignIn(page);
    await expect(signInButton(page)).toBeEnabled();
    await expect.poll(backend.logouts).toBeGreaterThan(0);
  });
  test("explicit backend logout survives refresh while the wallet reconnects", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!);
    await login(page);
    await page
      .getByRole("main")
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await onSignIn(page);
    await expect(signInButton(page)).toBeEnabled();
    await page.reload();
    await expect(signInButton(page)).toBeEnabled();
    await expect(page.getByLabel("Display name")).toHaveCount(0);
    expect(
      (await page.context().cookies()).some((c) => c.name === "tl_session"),
    ).toBe(false);
    await page.goto("/settings");
    await onSignIn(page);
  });
  test("a genuinely unavailable wallet on startup hides the profile without deleting a valid session", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!);
    await login(page);
    await page.evaluate(() =>
      sessionStorage.removeItem("test-wallet-authorized"),
    );
    const reads = backend.reads();
    await page.reload();
    await expect.poll(backend.reads).toBeGreaterThan(reads);
    await onSignIn(page);
    await expect(
      page.getByRole("button", { name: "Connect wallet", exact: true }),
    ).toBeVisible();
    expect(backend.logouts()).toBe(0);
    expect(
      (await page.context().cookies()).some((c) => c.name === "tl_session"),
    ).toBe(true);
  });
  test("explicit wallet disconnect revokes auth and does not reconnect after refresh", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!);
    await login(page);
    await page
      .getByRole("main")
      .getByRole("button", { name: "Manage wallet", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Disconnect wallet", exact: true })
      .click();
    await expect.poll(backend.logouts).toBeGreaterThan(0);
    await onSignIn(page);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Connect wallet", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Display name")).toHaveCount(0);
    expect(
      (await page.context().cookies()).some((c) => c.name === "tl_session"),
    ).toBe(false);
  });
  test("session API failure hides private data and preserves the cookie for recovery", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!);
    await login(page);
    backend.fail();
    await page.reload();
    await expect(
      page
        .getByRole("main")
        .getByRole("alert", { name: "Backend authentication error" }),
    ).toBeVisible();
    await onSignIn(page);
    expect(
      (await page.context().cookies()).some((c) => c.name === "tl_session"),
    ).toBe(true);
    backend.fail(false);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(authenticated(page)).toBeVisible();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(
      page
        .getByRole("main")
        .getByRole("alert", { name: "Backend authentication error" }),
    ).toHaveCount(0);
  });
  test("incorrect local origin rejects sign-in rather than relaxing cookie security", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!);
    backend.wrongOrigin();
    await signInButton(page).click();
    await expect(
      page
        .getByRole("main")
        .getByRole("alert", { name: "Backend authentication error" }),
    ).toContainText("origin");
    await onSignIn(page);
  });
});
