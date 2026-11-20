import { test, expect, type Page } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { escrowRpc } from "../test-support/escrow-rpc";
import { filesBackend } from "../test-support/files-backend";
import {
  arbitrationRpc,
  jurorB,
  jurorC,
} from "../test-support/arbitration-rpc";
import { randomUUID } from "node:crypto";
import { FileService } from "../src/lib/server/file-service";
import { sha256 } from "../src/lib/server/storage";
import { accountB, connectWallet, installWallet } from "./wallet-fixture";

test.describe("persistent metadata and private attachments", () => {
  let backend: Awaited<ReturnType<typeof filesBackend>>,
    state: ReturnType<typeof escrowRpc>,
    signer: ReturnType<typeof privateKeyToAccount>;
  test.afterEach(async ({ page }) => {
    // Close the page before removing handlers: no polling may escape to the
    // developer's running local RPC while the isolated backend is torn down.
    await page.close();
    await backend?.close();
  });
  async function setup(
    page: Page,
    origin: string,
    role: "client" | "worker" | "juror" = "client",
    empty = false,
    caseMode = false,
  ) {
    signer = privateKeyToAccount(generatePrivateKey());
    const caseState = caseMode ? arbitrationRpc({ opened: true }) : undefined;
    state = caseState ?? escrowRpc({ state: 2, empty });
    if (!empty && role !== "juror")
      state.projects[0][role === "client" ? "client" : "freelancer"] =
        signer.address;
    if (caseState) {
      if (role === "client") {
        caseState.cases[0].client = signer.address;
        caseState.cases[0].opener = signer.address;
      }
      if (role === "worker") caseState.cases[0].freelancer = signer.address;
      if (role === "juror")
        caseState.cases[0].jurors = [signer.address, jurorB, jurorC];
    }
    backend = await filesBackend(origin, state);
    await page.exposeFunction("__signBackendMessage", (message: string) =>
      signer.signMessage({ message }),
    );
    await installWallet(page, {
      account: signer.address,
      authSigning: true,
      forwardRpc: true,
      persistAuthorization: true,
    });
    await state.install(page);
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url());
      const response = await route.fetch({
        url: `${backend.url}${u.pathname}${u.search}`,
        headers: await route.request().allHeaders(),
      });
      await route.fulfill({ response });
    });
    await page.goto("/settings");
    await connectWallet(page);
    await page.keyboard.press("Escape");
    await page
      .getByRole("main")
      .getByRole("button", { name: "Sign in with Ethereum" })
      .click();
    await expect(page.getByLabel("Backend display name")).toBeVisible();
    return caseState;
  }
  async function save(page: Page, title = "Persistent project") {
    await page.getByLabel("Saved project title").fill(title);
    await page
      .getByLabel("Saved project description")
      .fill("Private persistent scope");
    await page
      .getByLabel("Milestone 1 name", { exact: true })
      .fill("Saved delivery");
    await page
      .getByLabel("Milestone 1 description", { exact: true })
      .fill("Saved milestone scope");
    await page.getByRole("button", { name: "Save project metadata" }).click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
  }
  test("saves participant metadata and restores titles/descriptions after refresh", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!);
    await page.goto("/projects/0");
    await save(page);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Persistent project", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Milestone 1 description", { exact: true }),
    ).toHaveValue("Saved milestone scope");
    await page.goto("/projects");
    await expect(
      page.getByRole("table", { name: "On-chain wallet projects" }),
    ).toContainText("Persistent project");
  });
  test("recovers metadata failure after chain creation without another create transaction", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!, "client", true);
    backend.failMetadata();
    await page.goto("/projects/new");
    await page.getByLabel("Project name").fill("Creation sync recovery");
    await page
      .getByLabel("Scope of work")
      .fill("Recover this existing chain project");
    await page.getByLabel("Freelancer wallet address").fill(accountB);
    await page.getByLabel("Deliverable", { exact: true }).fill("Delivery");
    await page.getByLabel("Amount (mUSD)").fill("10");
    await page.getByLabel("Due date (UTC)").fill("2030-12-31");
    await page
      .getByRole("button", { name: "Review draft", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Create project in wallet", exact: true })
      .click();
    await expect(page).toHaveURL(/\/projects\/0$/);
    await expect(
      page.getByText(/created on-chain. Metadata not synchronized/),
    ).toBeVisible();
    expect(state.writes).toEqual(["createProject"]);
    backend.failMetadata(false);
    await save(page, "Recovered existing project");
    expect(state.writes).toEqual(["createProject"]);
    expect(state.projects).toHaveLength(1);
  });
  test("uploads exact bytes, reviews the hash and links only after milestone confirmation", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!, "worker");
    await page.goto("/projects/0");
    const input = page.getByLabel("Select deliverable file");
    await input.setInputFiles({
      name: "delivery.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Exact browser private delivery"),
    });
    await page.getByRole("button", { name: "Upload privately" }).click();
    await expect(page.getByText(/Uploaded privately. SHA-256/)).toBeVisible();
    expect(state.writes).toEqual([]);
    await expect(
      page.getByRole("button", { name: "Use this hash" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Submit milestone", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm in wallet" })
      .click();
    await expect.poll(() => state.writes).toContain("submitMilestone");
    await expect
      .poll(async () =>
        backend.service.db
          .query("SELECT status FROM trustlayer.files")
          .then((r) => r.rows[0]?.status),
      )
      .toBe("linked");
    await page.reload();
    await expect(page.getByText("Confirmed on-chain reference")).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download & verify" }).click();
    await download;
    await expect(page.getByText(/SHA-256 verified against/)).toBeVisible();
  });
  test("rejects unsupported uploads and safely retries a storage failure", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!, "worker");
    await page.goto("/projects/0");
    await page.getByLabel("Select deliverable file").setInputFiles({
      name: "bad.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg/>"),
    });
    await page.getByRole("button", { name: "Upload privately" }).click();
    await expect(page.getByText(/Supported files:/)).toBeVisible();
    backend.storage.fail();
    await page.getByLabel("Select deliverable file").setInputFiles({
      name: "retry.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Retry same private bytes"),
    });
    await page.getByRole("button", { name: "Upload privately" }).click();
    await expect(
      page.getByText(
        "Backend database or verified blockchain is unavailable. Check server setup and retry.",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    backend.storage.fail(false);
    await page.getByRole("button", { name: "Upload privately" }).click();
    await expect(page.getByText(/Uploaded privately. SHA-256/)).toBeVisible();
    expect(backend.storage.objects.size).toBe(1);
    expect(state.writes).toEqual([]);
  });
  test("expired sessions and account switching hide saved private identity", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!);
    await page.goto("/projects/0");
    await save(page);
    backend.expire();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Persistent project", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Saved project title")).toHaveCount(0);
    await page.evaluate(() =>
      window.__testWallet.account(`0x${"f".repeat(40)}`),
    );
    await expect(page.getByLabel("Saved project title")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Download & verify" }),
    ).toHaveCount(0);
  });
  test("case evidence uploads remain off-chain and close at the response deadline", async ({
    page,
    baseURL,
  }) => {
    const c = await setup(page, baseURL!, "client", false, true);
    await page.goto("/disputes/0");
    await page.getByLabel("Select evidence file").setInputFiles({
      name: "evidence.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Private case evidence"),
    });
    await page.getByRole("button", { name: "Upload privately" }).click();
    await expect(page.getByText(/Off-chain evidence only/)).toBeVisible();
    expect(state.writes).toEqual([]);
    c!.advance(c!.cases[0].responseDeadline);
    await page.reload();
    await expect(page.getByText("Off-chain case attachment")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Upload privately" }),
    ).toHaveCount(0);
  });
  test("assigned jurors retrieve retained evidence and account changes clear private UI", async ({
    page,
    baseURL,
  }) => {
    const c = await setup(page, baseURL!, "juror", false, true);
    const bytes = Buffer.from("Evidence for the assigned jury");
    const files = new FileService(backend.service, backend.storage.storage);
    await files.upload(
      c!.projects[0].client.toLowerCase(),
      {
        chainId: "31337",
        escrowAddress: c!.manifest.contracts.TrustEscrow.address.toLowerCase(),
        deploymentHash: c!.manifest.verifiedBlock.hash.toLowerCase(),
        projectId: "0",
        milestoneIndex: 0,
        disputeId: "0",
      },
      "evidence",
      randomUUID(),
      "case.txt",
      "text/plain",
      bytes,
      sha256(bytes),
    );
    c!.cases[0].status = 2;
    c!.cases[0].finalizedAt = c!.cases[0].votingDeadline + 1n;
    c!.advance(c!.cases[0].finalizedAt);
    await page.goto("/disputes/0");
    await expect(page.getByText("Off-chain case attachment")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Upload privately" }),
    ).toHaveCount(0);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download & verify" }).click();
    await download;
    await expect(page.getByText(/SHA-256 verified against/)).toBeVisible();
    await page.evaluate(() =>
      window.__testWallet.account(`0x${"f".repeat(40)}`),
    );
    await expect(
      page.getByRole("button", { name: "Download & verify" }),
    ).toHaveCount(0);
    await expect(page.getByText("Off-chain case attachment")).toHaveCount(0);
  });
  test("counterparty file association keeps the confirmed response receipt visible", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!, "worker", false, true);
    await page.goto("/disputes/0");
    await page.getByLabel("Select response file").setInputFiles({
      name: "response.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Private counterparty response"),
    });
    await page.getByRole("button", { name: "Upload privately" }).click();
    await expect(page.getByText(/Uploaded privately. SHA-256/)).toBeVisible();
    await page
      .getByRole("button", { name: "Record response hash", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Record response hash",
      exact: true,
    });
    await dialog
      .getByRole("button", { name: "Confirm in wallet", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Confirmed", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        backend.service.db
          .query("SELECT status FROM trustlayer.files")
          .then((r) => r.rows[0]?.status),
      )
      .toBe("linked");
    expect(state.writes).toEqual(["respondToDispute"]);
  });
  test("an upload finishing after SIWE expiry unlocks retry without restoring stale private results", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!, "worker");
    await page.goto("/projects/0");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/files?**", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      const u = new URL(route.request().url());
      const response = await route.fetch({
        url: `${backend.url}${u.pathname}${u.search}`,
        headers: await route.request().allHeaders(),
      });
      await gate;
      await route.fulfill({ response });
    });
    try {
      await page.getByLabel("Select deliverable file").setInputFiles({
        name: "expired.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Upload completes after sign-in expires"),
      });
      const response = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).pathname === "/api/files",
      );
      await page.getByRole("button", { name: "Upload privately" }).click();
      await expect.poll(() => backend.storage.objects.size).toBe(1);
      backend.expire();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(
        page.getByText(/Sign in as a relevant participant/),
      ).toBeVisible();
      release();
      await (await response).finished();
      const nonce = await backend.service.nonce(signer.address.toLowerCase());
      const login = await backend.service.verify(
        nonce.message,
        await signer.signMessage({ message: nonce.message }),
        nonce.challenge,
      );
      await page.context().addCookies([
        {
          name: "tl_session",
          value: login.token,
          url: baseURL!,
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(
        page.getByRole("button", { name: "Upload privately" }),
      ).toBeEnabled();
      await expect(page.getByText(/Uploaded privately. SHA-256/)).toHaveCount(
        0,
      );
      expect(state.writes).toEqual([]);
      expect(backend.storage.objects.size).toBe(1);
    } finally {
      release();
    }
  });
});
