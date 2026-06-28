import { expect, test } from "@playwright/test";

const integrationEnabled = process.env.E2E_INTEGRATION === "1";
const apiUrl = process.env.E2E_API_URL ?? "http://localhost:4000";
const testToken = process.env.E2E_TOKEN;

test.describe("Calendar Engine UI — integration (real backend)", () => {
  test.skip(!integrationEnabled || !testToken, "Set E2E_INTEGRATION=1 and E2E_TOKEN from calendar-engine-e2e-fixtures.ts");

  test.beforeEach(async ({ context }) => {
    await context.addInitScript((token) => {
      localStorage.setItem("token", token);
    }, testToken!);
  });

  test("full engine flow against local/staging backend", async ({ page }) => {
    await page.goto("/dashboard/calendar");
    await expect(page.getByTestId("owner-decision-queue")).toBeVisible({ timeout: 30_000 });

    const clientsRes = await page.request.get(`${apiUrl}/api/clients`, {
      headers: { Authorization: `Bearer ${testToken}` },
    });
    expect(clientsRes.ok()).toBeTruthy();
    const clientsBody = (await clientsRes.json()) as { clients: { id: string; name: string }[] };
    const clientId = clientsBody.clients[0]?.id;
    expect(clientId).toBeTruthy();

    await page.getByRole("button", { name: "תור חדש" }).click();
    await page.locator('label:has-text("לקוח") select').selectOption(clientId!);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    await page.locator('input[type="date"]').fill(tomorrow.toISOString().slice(0, 10));
    await page.locator('input[type="time"]').fill("09:30");
    await page.getByRole("button", { name: "שלח לאישור" }).click();
    await expect(page.getByText("ממתין לאישורך")).toBeVisible({ timeout: 15_000 });

    const approveBtn = page.getByTestId("decision-approve").first();
    await expect(approveBtn).toBeVisible({ timeout: 15_000 });
    await approveBtn.click();

    await expect(page.getByTestId("owner-decision-queue")).toContainText("אין החלטות ממתינות", {
      timeout: 15_000,
    });

    const eventButton = page.locator("button").filter({ hasText: clientsBody.clients[0]!.name }).first();
    await eventButton.click();
    await expect(page.getByTestId("calendar-event-drawer")).toBeVisible();
    await expect(page.getByText("מאושר")).toBeVisible();
    await expect(page.getByText("ציר זמן תיק")).toBeVisible();
  });
});
