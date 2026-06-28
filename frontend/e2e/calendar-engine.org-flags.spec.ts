import { expect, test } from "@playwright/test";
import {
  createCalendarEngineMockState,
  injectAuthToken,
  installCalendarApiMocks,
  MOCK_CLIENT,
  openCalendarPage,
} from "./helpers/calendarEngineMock";

test.describe("Calendar Engine — org-level capability flags", () => {
  test("org disabled uses /api/appointments and hides Owner Decision Queue", async ({ context, page }) => {
    const state = createCalendarEngineMockState();
    state.orgEngineEnabled = false;
    await injectAuthToken(context, page);
    await installCalendarApiMocks(page, state, "engine");

    await page.route(/\/api\/appointments/, async (route) => {
      state.appointmentsRequested += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "appt-org-off-1",
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
    expect(state.appointmentsRequested).toBeGreaterThan(0);
    await expect(page.locator("button").filter({ hasText: MOCK_CLIENT.name }).first()).toBeVisible();
  });

  test("org enabled uses calendar engine path and shows Owner Decision Queue", async ({ context, page }) => {
    const state = createCalendarEngineMockState();
    state.orgEngineEnabled = true;
    await injectAuthToken(context, page);
    await installCalendarApiMocks(page, state, "engine");

    await openCalendarPage(page);

    await expect(page.getByTestId("owner-decision-queue")).toBeVisible();
    await expect.poll(() => state.calendarEventsRequested).toBeGreaterThan(0);
  });

  test("global UI kill switch OFF uses legacy path even when org enabled in capabilities mock", async ({
    context,
    page,
  }) => {
    const state = createCalendarEngineMockState();
    state.orgEngineEnabled = true;
    await injectAuthToken(context, page);
    await installCalendarApiMocks(page, state, "appointments");

    await page.route(/\/api\/appointments/, async (route) => {
      state.appointmentsRequested += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await openCalendarPage(page);

    await expect(page.getByTestId("owner-decision-queue")).toHaveCount(0);
    expect(state.calendarEventsRequested).toBe(0);
  });
});
