import { defineConfig, devices } from "@playwright/test";

const apiUrl = process.env.E2E_API_URL ?? "http://localhost:4000";
const skipWebServer = Boolean(process.env.E2E_SKIP_WEBSERVER);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /calendar-engine\.(on|503|off|integration)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  projects: [
    {
      name: "integration",
      testMatch: /calendar-engine\.integration\.spec\.ts/,
      use: {
        baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3000",
      },
    },
  ],
  use: {
    ...devices["Desktop Chrome"],
    locale: "he-IL",
  },
});
