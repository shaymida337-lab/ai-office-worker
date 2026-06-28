import { expect, test } from "@playwright/test";
import {
  createCalendarEngineMockState,
  createConfirmedEngineEventViaUi,
  injectAuthToken,
  installCalendarApiMocks,
  MOCK_CLIENT,
  openCalendarPage,
  openConfirmedEventDrawer,
  type CalendarEngineMockState,
} from "./helpers/calendarEngineMock";

test.describe("Calendar Engine — cancel/reschedule flows", () => {
  let state: CalendarEngineMockState;

  test.beforeEach(async ({ context, page }) => {
    state = createCalendarEngineMockState();
    await injectAuthToken(context, page);
    await installCalendarApiMocks(page, state, "engine");
  });

  test("confirmed event drawer shows cancel and reschedule actions", async ({ page }) => {
    await openCalendarPage(page);
    await createConfirmedEngineEventViaUi(page, state);
    await openConfirmedEventDrawer(page, state);

    await expect(page.getByTestId("drawer-cancel-request")).toBeVisible();
    await expect(page.getByTestId("drawer-reschedule-toggle")).toBeVisible();
  });

  test("cancel request creates pending decision and approve cancels event", async ({ page }) => {
    await openCalendarPage(page);
    await createConfirmedEngineEventViaUi(page, state);
    await openConfirmedEventDrawer(page, state);

    await page.getByTestId("drawer-cancel-request").click();
    const drawer = page.getByTestId("calendar-event-drawer");
    await expect(drawer.getByText("ממתין לאישורך").first()).toBeVisible();
    await expect.poll(() => state.decisions.filter((d) => d.type === "cancel_appointment").length).toBe(1);
    await expect(page.getByTestId("decision-card-cancel_appointment")).toBeVisible();

    await expect(drawer.getByText("מאושר")).toBeVisible();
    await page.getByRole("button", { name: "סגור" }).click();
    await expect(drawer).toHaveCount(0);

    await page.getByTestId("decision-approve").first().click();
    await expect.poll(() => state.events[0]?.status).toBe("cancelled");
    await expect(page.getByTestId("owner-decision-queue")).toContainText("אין החלטות ממתינות");
  });

  test("reschedule request creates pending decision and approve reschedules event", async ({ page }) => {
    await openCalendarPage(page);
    await createConfirmedEngineEventViaUi(page, state);
    await openConfirmedEventDrawer(page, state);

    await page.getByTestId("drawer-reschedule-toggle").click();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateValue = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    await page.locator('[data-testid="calendar-event-drawer"] input[type="date"]').fill(dateValue);
    await page.locator('[data-testid="calendar-event-drawer"] input[type="time"]').fill("11:00");
    await page.getByTestId("drawer-reschedule-submit").click();

    await expect.poll(() => state.decisions.filter((d) => d.type === "reschedule_appointment").length).toBe(1);
    await expect(page.getByTestId("decision-card-reschedule_appointment")).toBeVisible();
    await expect(page.getByTestId("decision-prepared-payload")).toContainText("מועד מוצע");

    await page.getByRole("button", { name: "סגור" }).click();
    await expect(page.getByTestId("calendar-event-drawer")).toHaveCount(0);

    await page.getByTestId("decision-approve").first().click();
    await expect.poll(() => state.events[0]?.status).toBe("rescheduled");
    await expect.poll(() => state.events.some((e) => e.status === "pending_readiness")).toBe(true);
  });

  test("reject cancel request leaves event confirmed", async ({ page }) => {
    await openCalendarPage(page);
    await createConfirmedEngineEventViaUi(page, state);
    await openConfirmedEventDrawer(page, state);

    await page.getByTestId("drawer-cancel-request").click();
    await expect.poll(() => state.decisions.length).toBe(1);

    await page.getByRole("button", { name: "סגור" }).click();
    await expect(page.getByTestId("calendar-event-drawer")).toHaveCount(0);

    await page.getByTestId("decision-reject").first().click();
    await expect.poll(() => state.decisions.length).toBe(0);
    await expect.poll(() => state.events[0]?.status).toBe("confirmed");
  });
});
