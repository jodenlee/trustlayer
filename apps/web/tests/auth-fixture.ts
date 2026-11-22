import { expect, type Page, type Route } from "@playwright/test";
import { createSiweMessage } from "viem/siwe";
import { randomBytes } from "node:crypto";

/**
 * Browser-only SIWE API stand-in for UI workflow tests. It exercises the real
 * client flow (nonce → wallet signature → verify → session cookie → gate) but
 * does not verify signatures; production SIWE/cookie/SQL behavior is covered by
 * unit/backend tests and the specs that route to the isolated authBackend.
 */
export interface MockAuth {
  sessionFor: () => string | null;
  verifications: () => number;
  logouts: () => number;
  expire: () => Promise<void>;
  setProfile: (name: string) => void;
}
export async function installAuth(
  page: Page,
  options: {
    configured?: boolean;
    exposeSigner?: boolean;
    /** Leave project/file APIs unhandled so a spec can route them itself. */
    passthroughData?: boolean;
  } = {},
): Promise<MockAuth> {
  let address: string | null = null;
  let verifications = 0;
  let logouts = 0;
  let displayName = "";
  const token = randomBytes(32).toString("hex");
  if (options.exposeSigner !== false)
    await page.exposeFunction(
      "__signBackendMessage",
      async () => `0x${"11".repeat(65)}`,
    );
  const session = () =>
    address
      ? {
          address,
          chainId: 31337,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        }
      : null;
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, json: body });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/auth/session")
      return json(route, {
        configured: options.configured ?? true,
        session: session(),
      });
    if (path === "/api/auth/nonce") {
      const body = request.postDataJSON() as { address: `0x${string}` };
      return json(route, {
        message: createSiweMessage({
          address: body.address,
          chainId: 31337,
          domain: url.host,
          uri: url.origin,
          version: "1",
          nonce: randomBytes(16).toString("hex"),
          issuedAt: new Date(),
          expirationTime: new Date(Date.now() + 300_000),
        }),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      });
    }
    if (path === "/api/auth/verify") {
      const { message } = request.postDataJSON() as { message: string };
      address = message.split("\n")[1].trim().toLowerCase();
      verifications++;
      await page.context().addCookies([
        {
          name: "tl_session",
          value: token,
          url: url.origin,
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
      return json(route, { session: session() });
    }
    if (path === "/api/auth/logout") {
      address = null;
      logouts++;
      await page.context().clearCookies({ name: "tl_session" });
      return json(route, { loggedOut: true });
    }
    if (path === "/api/profile") {
      if (!address)
        return json(route, { error: { message: "Sign in again." } }, 401);
      if (request.method() === "PATCH")
        displayName = (request.postDataJSON() as { displayName: string })
          .displayName;
      return json(route, {
        profile: {
          wallet_address: address,
          display_name: displayName,
          biography: "",
        },
      });
    }
    if (options.passthroughData) return route.fallback();
    if (path.startsWith("/api/projects/") && request.method() === "GET")
      return json(
        route,
        { error: { code: "not_found", message: "No saved project details." } },
        404,
      );
    if (path === "/api/files" && request.method() === "GET")
      return json(route, { files: [], maxBytes: 10 * 1024 * 1024 });
    return route.fallback();
  });
  return {
    sessionFor: () => address,
    verifications: () => verifications,
    logouts: () => logouts,
    expire: async () => {
      address = null;
      await page.context().clearCookies({ name: "tl_session" });
    },
    setProfile: (name) => {
      displayName = name;
    },
  };
}
/**
 * Visit a protected path while signed out, complete the sign-in page flow and
 * land back on the intended destination.
 */
export async function signIn(page: Page, path = "/dashboard") {
  await page.goto(path);
  await expect(page).toHaveURL(/\/sign-in/);
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await completeSignIn(page, path);
}
/** The wallet is already connected on the sign-in page; sign and return. */
export async function completeSignIn(page: Page, path?: string) {
  await page
    .getByRole("button", { name: "Sign in with Ethereum", exact: true })
    .click();
  if (path)
    await expect(page).toHaveURL(
      new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    );
  await expect(page.getByRole("main")).toBeVisible();
}
/**
 * Switch the injected wallet account. The app revokes the old session and
 * returns to sign-in; sign in as the new account to resume at the same page.
 */
export async function switchAccount(page: Page, address: string) {
  const path = new URL(page.url()).pathname;
  await page.evaluate((next) => window.__testWallet.account(next), address);
  await expect(page).toHaveURL(/\/sign-in/);
  await completeSignIn(page, path);
}
