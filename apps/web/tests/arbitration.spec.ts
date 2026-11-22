import { test, expect, type Page } from "@playwright/test";
import {
  arbitrationRpc,
  jurorA,
  jurorB,
  outsider,
} from "../test-support/arbitration-rpc";
import {
  installWallet,
  connectWallet,
  accountA,
  accountB,
} from "./wallet-fixture";
import type { Address } from "viem";
const hash = `0x${"a".repeat(64)}`;
async function open(
  page: Page,
  state: ReturnType<typeof arbitrationRpc>,
  url = "/disputes/0",
  actor: Address = accountA,
) {
  await installWallet(page, { forwardRpc: true });
  await state.install(page);
  await page.goto(url);
  if (actor !== accountA)
    await page.evaluate(
      (address) => window.__testWallet.account(address),
      actor,
    );
  await connectWallet(page);
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("On-chain workspace", { exact: true }),
  ).toBeVisible();
}
async function review(page: Page, title: string) {
  await page.getByRole("button", { name: title, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  await dialog
    .getByRole("button", { name: "Confirm in wallet", exact: true })
    .click();
  return dialog;
}
async function confirmed(page: Page, title: string) {
  const dialog = await review(page, title);
  await expect(
    dialog.getByRole("button", { name: "Confirmed", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
}

for (const actor of [accountA, accountB])
  test(`participant ${actor} approves and opens a real case, then sees the frozen milestone`, async ({
    page,
  }) => {
    const state = arbitrationRpc();
    await open(page, state, "/projects/0", actor);
    await page.getByLabel("Opening evidence hash").fill(hash);
    await confirmed(page, "Approve 15 mUSD dispute fee");
    expect(state.cases).toHaveLength(0);
    expect(state.projects[0].milestones[0].state).toBe(1);
    await review(page, "Open dispute");
    await expect(page).toHaveURL(/\/disputes\/0$/);
    await expect(page.getByText("Disputed", { exact: true })).toBeVisible();
    expect(state.cases[0].opener.toLowerCase()).toBe(actor.toLowerCase());
    expect(state.writes).toEqual(["approve", "openDispute"]);
    await page.getByRole("link", { name: "View project", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "View on-chain dispute #0" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Approve & pay milestone",
        exact: true,
      }),
    ).toHaveCount(0);
  });
test("insufficient opener balance prevents approval and fee collection", async ({
  page,
}) => {
  const state = arbitrationRpc({ balance: 14_000_000n });
  await open(page, state, "/projects/0");
  await page.getByLabel("Opening evidence hash").fill(hash);
  await expect(
    page.getByRole("button", {
      name: "Approve 15 mUSD dispute fee",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByText(/Insufficient mUSD: the opener needs/),
  ).toBeVisible();
  expect(state.writes).toEqual([]);
});
test("fresh opening preflight prevents duplicate cases and stale review deadlines", async ({
  page,
}) => {
  const state = arbitrationRpc();
  await open(page, state, "/projects/0");
  await page.getByLabel("Opening evidence hash").fill(hash);
  await confirmed(page, "Approve 15 mUSD dispute fee");
  await page.getByRole("button", { name: "Open dispute", exact: true }).click();
  state.advance(state.projects[0].milestones[0].reviewEnd + 1n);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm in wallet", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText(/does not permit opening/),
  ).toBeInViewport();
  expect(state.cases).toHaveLength(0);
  expect(state.writes).toEqual(["approve"]);
});
test("juror shortage fails opening without freezing or paying the fee", async ({
  page,
}) => {
  const state = arbitrationRpc({ jurorsReady: false });
  await open(page, state, "/projects/0");
  await page.getByLabel("Opening evidence hash").fill(hash);
  await confirmed(page, "Approve 15 mUSD dispute fee");
  await review(page, "Open dispute");
  await expect(
    page.getByRole("dialog").getByText(/Cannot reserve three eligible jurors/),
  ).toBeInViewport();
  expect(state.cases).toHaveLength(0);
  expect(state.projects[0].milestones[0].state).toBe(1);
});
test("counterparty records one public response during the response window", async ({
  page,
}) => {
  const state = arbitrationRpc({ opened: true });
  await open(page, state, "/disputes/0", accountB);
  await page.getByLabel("Response evidence hash").fill(hash);
  await confirmed(page, "Record response hash");
  await expect(
    page.getByRole("button", { name: "Record response hash", exact: true }),
  ).toHaveCount(0);
  expect(state.cases[0].responseHash).toBe(hash);
});
test("registration, exact allowance, deposit, top-up and unlocked withdrawal are separate transactions", async ({
  page,
}) => {
  const state = arbitrationRpc();
  await open(page, state, "/juror", outsider);
  await confirmed(page, "Register as juror");
  await confirmed(page, "Approve exact stake allowance");
  expect(state.stake.get(outsider)?.depositedStake).toBe(0n);
  await confirmed(page, "Deposit stake");
  await expect(page.getByTestId("juror-deposited")).toContainText("100.00");
  await page.getByLabel("Deposit amount (mUSD)").fill("10.123456");
  await confirmed(page, "Approve exact stake allowance");
  await confirmed(page, "Deposit stake");
  await page.getByLabel("Withdraw amount (mUSD)").fill("20.123456");
  await confirmed(page, "Withdraw unlocked stake");
  await expect(page.getByTestId("juror-available")).toContainText("90.00");
  await expect(page.getByText("Not eligible", { exact: true })).toBeVisible();
  expect(state.writes).toEqual([
    "registerJuror",
    "approve",
    "depositStake",
    "approve",
    "depositStake",
    "withdrawStake",
  ]);
});
test("locked assignment collateral cannot be withdrawn and links to the assigned case", async ({
  page,
}, testInfo) => {
  const state = arbitrationRpc({ opened: true });
  await open(page, state, "/juror", jurorA);
  await expect(page.getByTestId("juror-locked")).toContainText("100.00");
  await page.getByLabel("Withdraw amount (mUSD)").fill("1");
  await expect(
    page.getByRole("button", { name: "Withdraw unlocked stake", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Withdrawal exceeds unlocked stake.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Dispute #0", exact: true }),
  ).toBeVisible();
  expect(state.writes).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("juror-collateral.png"),
    fullPage: true,
    scale: "css",
  });
});
test("assigned juror voting opens exactly at the response deadline and prevents duplicate votes", async ({
  page,
}) => {
  const state = arbitrationRpc({ opened: true });
  await open(page, state, "/disputes/0", jurorA);
  await expect(
    page.getByRole("button", { name: "Vote: Freelancer wins", exact: true }),
  ).toBeDisabled();
  state.advance(state.cases[0].responseDeadline);
  await page.getByRole("button", { name: "Refresh case", exact: true }).click();
  await confirmed(page, "Vote: Freelancer wins");
  await expect(
    page.getByText("Your recorded vote: Freelancer wins", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Vote: Client wins", exact: true }),
  ).toBeDisabled();
  expect(state.writes).toEqual(["castVote"]);
});
test("participants and unrelated wallets cannot vote or claim assigned rewards", async ({
  page,
}) => {
  const state = arbitrationRpc({ opened: true });
  state.advance(state.cases[0].responseDeadline);
  await open(page, state);
  await expect(page.getByRole("button", { name: /^Vote:/ })).toHaveCount(0);
  await page.evaluate(
    (address) => window.__testWallet.account(address),
    outsider,
  );
  await expect(page.getByText(/Acting as Viewer/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Vote:/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Claim 4 mUSD reward", exact: true }),
  ).toHaveCount(0);
  expect(state.writes).toEqual([]);
});
test("voting ends strictly after the voting deadline and finalization is permissionless", async ({
  page,
}) => {
  const state = arbitrationRpc({ opened: true });
  state.advance(state.cases[0].votingDeadline);
  await open(page, state, "/disputes/0", jurorA);
  await expect(
    page.getByRole("button", { name: "Vote: Split", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Finalize dispute", exact: true }),
  ).toHaveCount(0);
  state.advance(state.cases[0].votingDeadline + 1n);
  await page.getByRole("button", { name: "Refresh case", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Vote: Split", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Finalize dispute", exact: true }),
  ).toBeVisible();
});
for (const [ruling, bps, name, net] of [
  [1, 10000, "Freelancer wins", "99.00"],
  [2, 0, "Client wins", "0.00"],
  [3, 5000, "Split", "49.50"],
  [0, 5000, "50/50 fallback", "49.50"],
] as const)
  test(`finalization displays the stored ${name} verdict and exact allocations`, async ({
    page,
  }, testInfo) => {
    const state = arbitrationRpc({ opened: true });
    if (ruling === 1) state.cases[0].freelancerVotes = 2;
    if (ruling === 2) state.cases[0].clientVotes = 2;
    if (ruling === 3) state.cases[0].splitVotes = 2;
    state.advance(state.cases[0].votingDeadline + 1n);
    await open(page, state, "/disputes/0", outsider);
    await confirmed(page, "Finalize dispute");
    await expect(
      page
        .getByTestId("case-settlement")
        .getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("case-settlement")
        .getByText("Freelancer net", { exact: true })
        .locator(".."),
    ).toContainText(net);
    expect(state.cases[0].freelancerBps).toBe(bps);
    await expect(
      page.getByText("Unlocked for this case", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Finalize dispute", exact: true }),
    ).toHaveCount(0);
    if (ruling === 0) {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("finalized-dispute.png"),
        fullPage: true,
        scale: "css",
      });
    }
  });
test("assigned juror claims a fixed reward once and history records the actual claim", async ({
  page,
}) => {
  const state = arbitrationRpc({ finalized: true });
  await open(page, state, "/disputes/0", jurorA);
  await confirmed(page, "Claim 4 mUSD reward");
  await expect(
    page.getByText("Your 4 mUSD reward was claimed for this case.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Claim 4 mUSD reward", exact: true }),
  ).toHaveCount(0);
  if (
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .getByRole("navigation", { name: "Workspace navigation", exact: true })
    .filter({ visible: true })
    .getByRole("link", { name: "Transactions", exact: true })
    .click();
  await expect(
    page.getByText("Juror reward claimed", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Wallet activity/).first()).toBeVisible();
  expect(state.writes).toEqual(["claimJurorReward"]);
});
test("discovery includes a juror and removes unrelated cases after wallet switching", async ({
  page,
}) => {
  const state = arbitrationRpc({ opened: true });
  await open(page, state, "/disputes", jurorA);
  await expect(
    page.getByRole("link", { name: "Dispute #0", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    (address) => window.__testWallet.account(address),
    outsider,
  );
  await expect(
    page.getByRole("heading", {
      name: "No matching on-chain disputes loaded",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Dispute #0", exact: true }),
  ).toHaveCount(0);
});
for (const kind of ["rejected", "reverted", "RPC"] as const)
  test(`case action ${kind} is visible without a false vote confirmation`, async ({
    page,
  }) => {
    const state = arbitrationRpc({ opened: true });
    state.advance(state.cases[0].responseDeadline);
    await open(page, state, "/disputes/0", jurorA);
    if (kind === "rejected") state.reject();
    else if (kind === "reverted") state.revert();
    else state.failRpc("eth_estimateGas");
    await review(page, "Vote: Split");
    await expect(
      page
        .getByRole("dialog")
        .getByText(
          kind === "rejected"
            ? /Request rejected in your wallet/
            : kind === "reverted"
              ? /mined transaction reverted/
              : /local RPC or wallet request failed/,
        ),
    ).toBeInViewport();
    expect(state.votes.size).toBe(0);
  });
test("changing wallets invalidates an open vote review", async ({ page }) => {
  const state = arbitrationRpc({ opened: true });
  state.advance(state.cases[0].responseDeadline);
  await open(page, state, "/disputes/0", jurorA);
  await page.getByRole("button", { name: "Vote: Split", exact: true }).click();
  await page.evaluate(
    (address) => window.__testWallet.account(address),
    jurorB,
  );
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm in wallet", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("dialog").getByText(/wallet or deployment changed/),
  ).toBeVisible();
  expect(state.writes).toEqual([]);
});
test("nonexistent numeric dispute ID has a useful unavailable state", async ({
  page,
}) => {
  const state = arbitrationRpc();
  await open(page, state, "/disputes/999");
  await expect(
    page.getByText("This dispute does not exist on the verified deployment.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("pending vote keeps its hash through verification and cannot be submitted twice", async ({
  page,
}) => {
  const state = arbitrationRpc({ opened: true });
  state.advance(state.cases[0].responseDeadline);
  state.defer(true);
  await open(page, state, "/disputes/0", jurorA);
  const dialog = await review(page, "Vote: Split");
  await expect(dialog.getByText("confirming", { exact: true })).toBeVisible();
  await expect(dialog.locator("code")).toHaveText(/^0x[\da-f]{64}$/i);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  const pending = dialog.getByRole("button", {
    name: "Request pending…",
    exact: true,
  });
  await expect(pending).toBeDisabled();
  await pending.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  expect(state.writes).toEqual(["castVote"]);
  state.defer(false);
  await expect(
    dialog.getByRole("button", { name: "Confirmed", exact: true }),
  ).toBeVisible();
});

test("fresh vote preflight rejects a deadline that expires while review is open", async ({
  page,
}) => {
  const state = arbitrationRpc({ opened: true });
  state.advance(state.cases[0].responseDeadline);
  await open(page, state, "/disputes/0", jurorA);
  await page.getByRole("button", { name: "Vote: Split", exact: true }).click();
  state.advance(state.cases[0].votingDeadline + 1n);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm in wallet", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText(/does not permit this action/),
  ).toBeInViewport();
  expect(state.writes).toEqual([]);
});
