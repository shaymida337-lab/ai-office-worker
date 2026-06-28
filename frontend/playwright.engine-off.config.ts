import { defineConfig, devices } from "@playwright/test";

const apiUrl = process.env.E2E_API_URL ?? "http://localhost:4000";
const baseURL = "http://127.0.0.1:3200";

/** Dedicated config — flags OFF baked at build time (top-level webServer). */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /calendar-engine\.off\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    locale: "he-IL",
    baseURL,
  },
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : {
        command: "npx next start -p 3200",
        url: `${baseURL}/dashboard/calendar`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
