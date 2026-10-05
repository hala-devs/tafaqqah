import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end acceptance journey. Runs against a dev server with the development mock
 * provider (no API key needed). Override the target with E2E_BASE_URL.
 */
const PORT = Number(process.env.E2E_PORT ?? 3210);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e-artifacts/results",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    locale: "ar",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next dev -p ${PORT}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
