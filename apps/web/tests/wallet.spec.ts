import { expect, test, type Page } from "@playwright/test";
import {
  accountA,
  accountB,
  installRpc,
  installWallet,
} from "./wallet-fixture";
import { installAuth, signIn, switchAccount } from "./auth-fixture";

const connect = (page: Page) =>
  page.getByRole("button", { name: "Connect wallet", exact: true }).click();

test("missing provider renders wallet setup without requesting credentials", async ({
  page,
}) => {
  await installAuth(page);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(
    page.getByRole("heading", { name: "No browser wallet found" }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText(
    "never asks for a private key or recovery phrase",
  );
  await expect(page.getByTestId("live-balance")).toHaveCount(0);
});
test("connection reads real-provider data, displays metadata, and disconnect clears it", async ({
  page,
}) => {
  await installWallet(page);
  await installRpc(page);
  await installAuth(page);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByTestId("live-balance")).toHaveCount(0);
  await connect(page);
  await expect(page.getByText(/0x1111…1111 · Hardhat Local/)).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.__testWallet.calls.filter((method) =>
        /sendTransaction|sign/i.test(method),
      ),
    ),
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Sign in with Ethereum", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId("live-balance")).toContainText("123.456789");
  await expect(
    page.getByText("Verified on RPC & wallet", { exact: true }),
  ).toBeVisible();
  await page.getByText("Protocol & contract details").click();
  await expect(page.getByText("mUSD · 6 decimals · on-chain")).toBeVisible();
  await expect(page.getByText("MockUSD", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Current treasury owner", { exact: true }),
  ).toBeVisible();
  // The only signature is the explicit SIWE sign-in; no transaction is sent.
  expect(
    await page.evaluate(() =>
      window.__testWallet.calls.filter((method) =>
        /sendTransaction|sign/i.test(method),
      ),
    ),
  ).toEqual(["personal_sign"]);
  await page
    .getByRole("main")
    .getByRole("button", { name: "Manage wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Disconnect wallet", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByTestId("live-balance")).toHaveCount(0);
  await expect(
    page.getByText("Verified on RPC & wallet", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Connect wallet", exact: true }),
  ).toBeVisible();
});
test("wallet rejection is displayed and never becomes a connected balance", async ({
  page,
}) => {
  await installWallet(page, { rejected: true });
  await installRpc(page);
  await installAuth(page);
  await page.goto("/dashboard");
  await connect(page);
  await expect(
    page.getByRole("alert", { name: "Wallet request error" }),
  ).toContainText("Request rejected");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(
    page.getByRole("button", { name: "Sign in with Ethereum" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("live-balance")).toHaveCount(0);
});
test("account changes refetch balances and provider disconnection removes them", async ({
  page,
}) => {
  await installWallet(page);
  await installRpc(page);
  await installAuth(page);
  await signIn(page, "/settings");
  await expect(page.getByTestId("live-balance")).toContainText("123.456789");
  await switchAccount(page, accountB);
  await expect(page.getByTestId("live-balance")).toContainText("9.876543");
  await expect(page.getByRole("main").getByTitle(accountB)).toBeVisible();
  await page.evaluate(() => window.__testWallet.disconnect());
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByTestId("live-balance")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Connect wallet", exact: true }),
  ).toBeVisible();
});
test("wrong network pauses reads and explicit switch can add the local network", async ({
  page,
}) => {
  await installWallet(page, { chainId: 1, unknownNetwork: true });
  await installRpc(page);
  await installAuth(page);
  await page.goto("/dashboard");
  await connect(page);
  await expect(page.getByRole("main")).toContainText(
    "Your wallet is on Ethereum (1)",
  );
  await expect(
    page.getByRole("button", { name: "Sign in with Ethereum" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Switch to Hardhat Local" }).click();
  await page
    .getByRole("button", { name: "Sign in with Ethereum", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("live-balance")).toContainText("123.456789");
  expect(await page.evaluate(() => window.__testWallet.calls)).toContain(
    "wallet_addEthereumChain",
  );
  await page.evaluate(() => window.__testWallet.chain(11155111));
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByTestId("live-balance")).toHaveCount(0);
  await expect(page.getByText(/Your wallet is on Sepolia/)).toBeVisible();
});
test("rejected network switch retains mismatch and disabled reads", async ({
  page,
}) => {
  await installWallet(page, { chainId: 1, switchRejected: true });
  await installRpc(page);
  await installAuth(page);
  await page.goto("/dashboard");
  await connect(page);
  await page.getByRole("button", { name: "Switch to Hardhat Local" }).click();
  await expect(
    page.getByRole("alert", { name: "Network request error" }),
  ).toContainText("Request rejected");
  await expect(
    page.getByRole("button", { name: "Sign in with Ethereum" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("live-balance")).toHaveCount(0);
});
for (const [name, options, message] of [
  ["unavailable RPC", { unavailable: true }, "Local blockchain unavailable"],
  ["missing manifest", { missing: true }, "Local setup required"],
  ["invalid manifest", { invalid: true }, "Local setup required"],
  ["ephemeral manifest", { ephemeral: true }, "Local setup required"],
  ["reset RPC chain", { rpcWrongBlock: true }, "Local setup required"],
] as const)
  test(`${name} shows guidance instead of a fabricated balance`, async ({
    page,
  }) => {
    await installWallet(page);
    await installRpc(page, options);
    await installAuth(page);
    await signIn(page, "/dashboard");
    await expect(
      page.getByRole("alert", { name: "Deployment setup" }),
    ).toContainText(message);
    await expect(page.getByTestId("live-balance")).toHaveText("—");
  });
test("wallet on another 31337 instance fails the block-identity check", async ({
  page,
}) => {
  await installWallet(page, { walletWrongBlock: true });
  await installRpc(page);
  await installAuth(page);
  await signIn(page, "/dashboard");
  await expect(
    page.getByRole("alert", { name: "Deployment setup" }),
  ).toContainText("Local setup required");
  await expect(page.getByTestId("live-balance")).toHaveText("—");
});
for (const [name, options] of [
  ["wrong token decimals", { decimals: 18 }],
  ["failed contract read", { readFailure: true }],
] as const)
  test(`${name} is not a successful token read`, async ({ page }) => {
    await installWallet(page);
    await installRpc(page, options);
    await installAuth(page);
    await signIn(page, "/dashboard");
    await expect(
      page.getByRole("alert", { name: "Token read error" }),
    ).toContainText("Token read failed");
    await expect(page.getByTestId("live-balance")).toHaveText("—");
  });
test("signed-in wallet shows real project reads and empty history", async ({
  page,
}, testInfo) => {
  await installWallet(page);
  await installRpc(page);
  await installAuth(page);
  await signIn(page, "/dashboard");
  await expect(
    page.getByText("Fictional sample data", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No projects yet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "You’re all caught up" }),
  ).toBeVisible();
  await expect(page.getByTestId("live-balance")).toContainText("123.456789");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("wallet-connected.png"),
    fullPage: true,
    scale: "css",
  });
  if (await page.getByRole("button", { name: "Open navigation" }).isVisible())
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Transactions", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No transaction requests this session" }),
  ).toBeVisible();
  await expect(page.locator("table")).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: /No matching events in these blocks|No activity yet/,
    }),
  ).toBeVisible();
  if (await page.getByRole("button", { name: "Open navigation" }).isVisible())
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await expect(page.getByRole("main").getByTitle(accountA)).toBeVisible();
});
