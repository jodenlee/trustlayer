import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.PLAYWRIGHT_PORT ?? "3000");
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("PLAYWRIGHT_PORT must be an integer from 1024 to 65535.");
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    channel: process.env.PLAYWRIGHT_CHANNEL,
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "tablet",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 820, height: 1180 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    // Regression servers must never use the developer's hosted database.
    // Auth browser fixtures exercise the real API with their own isolated DB.
    env: { DATABASE_URL: "", DATABASE_MIGRATION_URL: "" },
    command: `npm run start -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
