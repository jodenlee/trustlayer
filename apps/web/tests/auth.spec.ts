import { test, expect, type Page } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { verifyMessage } from "viem";
import { randomBytes } from "node:crypto";
import { accountB, installRpc, installWallet } from "./wallet-fixture";

// Browser UI tests use an isolated API fixture. Real SIWE/cookie/SQL behavior is
// covered by backend.test.ts; no test backend is enabled in the production app.
async function setup(page: Page, rejected = false, deferSigning = false) {
  const signer = privateKeyToAccount(generatePrivateKey());
  let session: { address: string; chainId: number; expiresAt: string } | null =
    null;
  let profile = {
    wallet_address: signer.address.toLowerCase(),
    display_name: "",
    biography: "",
  };
  let logouts = 0;
  let verifications = 0;
  let completeSigning: (() => void) | undefined;
  await page.exposeFunction("__signBackendMessage", async (message: string) => {
    if (rejected) throw new Error("User rejected sign-in request");
    if (deferSigning)
      await new Promise<void>((resolve) => {
        completeSigning = resolve;
      });
    return signer.signMessage({ message });
  });
  await installWallet(page, { account: signer.address, authSigning: true });
  await installRpc(page);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let result: unknown;
    if (path.endsWith("/auth/session")) result = { configured: true, session };
    else if (path.endsWith("/auth/nonce")) {
      const address = request.postDataJSON().address;
      result = {
        message: createSiweMessage({
          address,
          chainId: 31337,
          domain: new URL(request.url()).host,
          uri: new URL(request.url()).origin,
          version: "1",
          nonce: randomBytes(16).toString("hex"),
          issuedAt: new Date(),
          expirationTime: new Date(Date.now() + 300_000),
        }),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      };
    } else if (path.endsWith("/auth/verify")) {
      ++verifications;
      const { message, signature } = request.postDataJSON();
      expect(
        await verifyMessage({ message, signature, address: signer.address }),
      ).toBe(true);
      session = {
        address: signer.address.toLowerCase(),
        chainId: 31337,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      };
      result = { session };
      await page.context().addCookies([
        {
          name: "tl_session",
          value: "b".repeat(64),
          url: new URL(request.url()).origin,
        },
      ]);
    } else if (path.endsWith("/auth/logout")) {
      session = null;
      ++logouts;
      await page.context().clearCookies({ name: "tl_session" });
      result = { loggedOut: true };
    } else if (path === "/api/profile") {
      if (!session) {
        await route.fulfill({
          status: 401,
          json: { error: { message: "Sign in again." } },
        });
        return;
      }
      if (request.method() === "PATCH") {
        const data = request.postDataJSON();
        profile = {
          ...profile,
          display_name: data.displayName,
          biography: data.biography,
        };
      }
      result = { profile };
    } else if (path.startsWith("/api/projects/") || path === "/api/files") {
      await route.fulfill({
        status: 404,
        json: { error: { message: "Not found" } },
      });
      return;
    } else throw new Error(`Unexpected API fixture ${path}`);
    await route.fulfill({ json: result });
  });
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings/);
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sign in with Ethereum", exact: true }),
  ).toBeVisible();
  return {
    expire: () => {
      session = null;
    },
    logouts: () => logouts,
    completeSigning: () => completeSigning?.(),
    verifications: () => verifications,
  };
}
const signedIn = (page: Page) =>
  expect(page.getByLabel("Display name")).toBeVisible();
const signedOut = async (page: Page) => {
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByLabel("Display name")).toHaveCount(0);
};
test("wallet connection remains separate from backend sign-in and profile editing", async ({
  page,
}) => {
  await setup(page);
  expect(
    await page.evaluate(() =>
      window.__testWallet.calls.includes("personal_sign"),
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Sign in with Ethereum", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  await signedIn(page);
  await page.getByLabel("Display name").fill("Taylor");
  await page.getByLabel("About you (optional)").fill("Protocol developer");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.", { exact: true })).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await signedOut(page);
  await expect(
    page.getByRole("button", { name: "Sign in with Ethereum", exact: true }),
  ).toBeVisible();
});
test("wallet rejection remains visible without creating backend authentication", async ({
  page,
}) => {
  const fixture = await setup(page, true);
  await page
    .getByRole("button", { name: "Sign in with Ethereum", exact: true })
    .click();
  await expect(
    page.getByRole("alert", { name: "Backend authentication error" }),
  ).toBeVisible();
  await signedOut(page);
  expect(fixture.verifications()).toBe(0);
});
test("switching wallets revokes backend authentication and hides the previous profile", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page
    .getByRole("button", { name: "Sign in with Ethereum", exact: true })
    .click();
  await signedIn(page);
  await page.evaluate(
    (address) => window.__testWallet.account(address),
    accountB,
  );
  await expect(page).toHaveURL(/ended=1/);
  await signedOut(page);
  await expect.poll(fixture.logouts).toBeGreaterThan(0);
});
test("expired backend session is removed on focus refresh", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page
    .getByRole("button", { name: "Sign in with Ethereum", exact: true })
    .click();
  await signedIn(page);
  fixture.expire();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await signedOut(page);
});
test("profile validation blocks an empty persistent display name", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Sign in with Ethereum", exact: true })
    .click();
  await signedIn(page);
  await page.getByLabel("Display name").fill("");
  await page.getByRole("button", { name: "Save profile" }).click();
  expect(
    await page
      .getByLabel("Display name")
      .evaluate((element: HTMLInputElement) => element.validity.valueMissing),
  ).toBe(true);
});
test("wallet changes during a pending signature never verify the old account", async ({
  page,
}) => {
  const fixture = await setup(page, false, true);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Sign in with Ethereum" }).click();
  await expect(
    main.getByRole("button", { name: "Confirm in your wallet…" }),
  ).toBeDisabled();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          window.__testWallet.calls.filter(
            (method) => method === "personal_sign",
          ).length,
      ),
    )
    .toBe(1);
  await page.evaluate(
    (address) => window.__testWallet.account(address),
    accountB,
  );
  fixture.completeSigning();
  await expect(
    main.getByRole("alert", { name: "Backend authentication error" }),
  ).toContainText("Wallet changed");
  expect(fixture.verifications()).toBe(0);
  await signedOut(page);
});
test("unsupported networks cannot request a backend signature", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => window.__testWallet.chain(1));
  await expect(
    page
      .getByRole("main")
      .getByRole("button", { name: "Switch to Hardhat Local" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("main")
      .getByRole("button", { name: "Sign in with Ethereum" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.__testWallet.calls.includes("personal_sign"),
    ),
  ).toBe(false);
});
