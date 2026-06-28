import { defineConfig, devices } from "@playwright/test";

const apiUrl = process.env.E2E_API_URL ?? "http://localhost:4000";
const baseURL = "http://127.0.0.1:3100";
const skipWebServer = Boolean(process.env.E2E_SKIP_WEBSERVER);

/** Playwright config for Calendar Engine flags ON E2E (dev server). */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /calendar-engine\.(on|cancel-reschedule|complete-noshow|natalie-scheduling|dashboard-briefing|org-flags)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  use: {
    ...devices["Desktop Chrome"],
    locale: "he-IL",
    baseURL,
  },
  webServer: skipWebServer
    ? undefined
    : {
        command: "node scripts/dev-e2e-on.mjs",
        url: `${baseURL}/dashboard/calendar`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          ...process.env,
          NEXT_PUBLIC_API_URL: apiUrl,
          NEXT_PUBLIC_CALENDAR_ENGINE_V1_READ: "true",
          NEXT_PUBLIC_CALENDAR_ENGINE_V1_WRITE: "true",
        },
      },
});
