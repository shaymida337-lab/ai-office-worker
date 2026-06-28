import { expect, test } from "@playwright/test";
import {
  createCalendarEngineMockState,
  injectAuthToken,
  installCalendarApiMocks,
  MOCK_CLIENT,
  openCalendarPage,
} from "./helpers/calendarEngineMock";

test.describe("Calendar Engine UI — flags OFF", () => {
  test("uses /api/appointments and hides Owner Decision Queue", async ({ context, page }) => {
    const state = createCalendarEngineMockState();
    await injectAuthToken(context, page);
    await installCalendarApiMocks(page, state, "appointments");

    await page.route(/\/api\/appointments/, async (route) => {
      state.appointmentsRequested += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "appt-legacy-1",
            clientId: MOCK_CLIENT.id,
            serviceId: null,
            startTime: new Date().toISOString(),
            durationMinutes: 30,
            status: "pending",
            notes: null,
            client: MOCK_CLIENT,
            service: null,
          },
        ]),
      });
    });

    await openCalendarPage(page);

    await expect(page.getByTestId("owner-decision-queue")).toHaveCount(0);
    expect(state.calendarEventsRequested).toBe(0);
    await expect(page.locator("button").filter({ hasText: MOCK_CLIENT.name }).first()).toBeVisible();
  });

  test("create flow posts to /api/appointments", async ({ context, page }) => {
    const state = createCalendarEngineMockState();
    await injectAuthToken(context, page);
    await installCalendarApiMocks(page, state, "appointments");

    let postAppointments = 0;
    await page.route(/\/api\/appointments/, async (route) => {
      if (route.request().method() === "POST") {
        postAppointments += 1;
        return route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
      }
      state.appointmentsRequested += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await openCalendarPage(page);
    await page.getByRole("button", { name: "תור חדש" }).click();
    await page.locator('label:has-text("לקוח") select').selectOption(MOCK_CLIENT.id);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await page.locator('input[type="date"]').fill(tomorrow.toISOString().slice(0, 10));
    await page.locator('input[type="time"]').fill("11:00");
    await page.getByRole("button", { name: "שמור תור" }).click();

    await expect.poll(() => postAppointments).toBe(1);
    await expect(page.getByText("התור נוסף בהצלחה")).toBeVisible();
  });

  test("Natalie book uses legacy appointment path when engine OFF", async ({ context, page }) => {
    const state = createCalendarEngineMockState();
    await injectAuthToken(context, page);
    await installCalendarApiMocks(page, state, "appointments");
    await openCalendarPage(page);

    const startTime = new Date(Date.now() + 86_400_000).toISOString();
    const result = await page.evaluate(async (iso) => {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/natalie/create-appointment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          clientName: "לקוח בדיקה",
          startTime: iso,
          durationMinutes: 30,
        }),
      });
      return { status: res.status, body: await res.json() };
    }, startTime);

    expect(result.status).toBe(201);
    expect(state.legacyAppointments.length).toBe(1);
    expect(state.events.length).toBe(0);
    expect(state.natalieBookRequests).toBe(1);
  });
});
