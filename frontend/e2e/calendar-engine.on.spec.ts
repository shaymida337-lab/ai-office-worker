import { expect, test } from "@playwright/test";
import {
  createCalendarEngineMockState,
  createEngineEventViaUi,
  injectAuthToken,
  installCalendarApiMocks,
  MOCK_CLIENT,
  openCalendarPage,
  type CalendarEngineMockState,
} from "./helpers/calendarEngineMock";

test.describe("Calendar Engine UI — flags ON", () => {
  let state: CalendarEngineMockState;

  test.beforeEach(async ({ context, page }) => {
    state = createCalendarEngineMockState();
    await injectAuthToken(context, page);
    await installCalendarApiMocks(page, state, "engine");
  });

  test("calendar page loads engine path with Owner Decision Queue", async ({ page }) => {
    await openCalendarPage(page);
    await expect(page.getByTestId("owner-decision-queue")).toBeVisible();
    await expect(page.getByRole("heading", { name: "תור החלטות" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "היומן שלי" })).toBeVisible();
  });

  test("create draft → submit → pending decision → approve → confirmed + timeline", async ({ page }) => {
    await openCalendarPage(page);

    await createEngineEventViaUi(page);
    await expect(page.getByText("ממתין לאישורך")).toBeVisible();

    await expect.poll(() => state.decisions.filter((d) => d.status === "pending").length).toBe(1);
    await expect(page.getByTestId("owner-decision-queue")).toContainText("1 ממתינות");

    const eventsReload = page.waitForResponse(
      (r) => r.url().includes("/api/calendar/events") && r.request().method() === "GET"
    );
    await page.getByTestId("decision-approve").first().click();
    await eventsReload;
    await expect.poll(() => state.events.some((e) => e.status === "confirmed")).toBe(true);
    await expect(page.getByTestId("owner-decision-queue")).toContainText("אין החלטות ממתינות");

    const eventButton = page.locator("button").filter({ hasText: MOCK_CLIENT.name }).first();
    await expect(eventButton).toBeVisible({ timeout: 15_000 });
    await eventButton.click();
    const drawer = page.getByTestId("calendar-event-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("מאושר")).toBeVisible();
    await expect(drawer.getByText("ציר זמן תיק")).toBeVisible();
    await expect(drawer.getByText("האירוע אושר")).toBeVisible();
  });

  test("reject decision flow updates queue and event status", async ({ page }) => {
    await openCalendarPage(page);

    await createEngineEventViaUi(page);
    await expect.poll(() => state.decisions.length).toBe(1);

    await page.getByTestId("decision-reject").first().click();
    await expect.poll(() => state.decisions.length).toBe(0);
    await expect.poll(() => state.events[0]?.status).toBe("pending_readiness");
    await expect(page.getByTestId("owner-decision-queue")).toContainText("אין החלטות ממתינות");
  });
});

test.describe("Calendar Engine UI — 503 fallback", () => {
  test("engine API 503 shows Hebrew message and falls back to appointments without crash", async ({ context, page }) => {
    const state = createCalendarEngineMockState();
    await injectAuthToken(context, page);
    await installCalendarApiMocks(page, state, "engine-503");

    await openCalendarPage(page);

    await expect(page.getByTestId("engine-disabled-banner")).toBeVisible();
    await expect(page.getByTestId("engine-disabled-banner")).toContainText("מנוע היומן החדש אינו פעיל כרגע");
    await expect(page.getByRole("heading", { name: "היומן שלי" })).toBeVisible();
    expect(state.calendarEventsRequested + state.appointmentsRequested).toBeGreaterThan(0);
  });
});
