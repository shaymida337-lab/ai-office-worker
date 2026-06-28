import { expect, test } from "@playwright/test";
import {
  createCalendarEngineMockState,
  createConfirmedEngineEventViaUi,
  createEngineEventViaUi,
  ensureCalendarWeekShowsEvent,
  injectAuthToken,
  installCalendarApiMocks,
  MOCK_CLIENT,
  openCalendarPage,
  openConfirmedEventDrawer,
  type CalendarEngineMockState,
} from "./helpers/calendarEngineMock";

test.describe("Calendar Engine — complete/no-show flows", () => {
  let state: CalendarEngineMockState;

  test.beforeEach(async ({ context, page }) => {
    state = createCalendarEngineMockState();
    await injectAuthToken(context, page);
    await installCalendarApiMocks(page, state, "engine");
  });

  test("regression: past-start confirmed event visible when displayed week includes event date", async ({ page }) => {
    await openCalendarPage(page);
    await createEngineEventViaUi(page, { startInPast: true });
    await expect.poll(() => state.decisions.length).toBe(1);
    await page.getByTestId("decision-approve").first().click();
    await expect.poll(() => state.events[0]?.status).toBe("confirmed");

    const eventStart = state.events[0]?.startAt;
    expect(eventStart).toBeTruthy();
    await ensureCalendarWeekShowsEvent(page, eventStart!);

    await expect(page.locator("button").filter({ hasText: MOCK_CLIENT.name }).first()).toBeVisible();
  });

  test("confirmed event drawer shows complete and no-show actions", async ({ page }) => {
    await openCalendarPage(page);
    await createConfirmedEngineEventViaUi(page, state, { startInPast: true });
    await openConfirmedEventDrawer(page, state);

    await expect(page.getByTestId("drawer-complete-toggle")).toBeVisible();
    await expect(page.getByTestId("drawer-no-show-toggle")).toBeVisible();
  });

  test("complete flow requires notes and updates status to הושלם", async ({ page }) => {
    await openCalendarPage(page);
    await createConfirmedEngineEventViaUi(page, state, { startInPast: true });
    await openConfirmedEventDrawer(page, state);

    await page.getByTestId("drawer-complete-toggle").click();
    await page.locator('[data-testid="calendar-event-drawer"] textarea').fill("פגישה מוצלחת");
    await page.getByTestId("drawer-complete-submit").click();

    await expect.poll(() => state.events[0]?.status).toBe("completed");
    const drawer = page.getByTestId("calendar-event-drawer");
    await expect(drawer.getByText("הושלם", { exact: true }).first()).toBeVisible();
    await expect(drawer.getByText("ציר זמן תיק")).toBeVisible();
    await expect(drawer.getByText("האירוע הושלם")).toBeVisible();
  });

  test("no-show flow updates status to לא הגיע and timeline", async ({ page }) => {
    await openCalendarPage(page);
    await createConfirmedEngineEventViaUi(page, state, { startInPast: true });
    await openConfirmedEventDrawer(page, state);

    await page.getByTestId("drawer-no-show-toggle").click();
    await page.locator('[data-testid="calendar-event-drawer"] textarea').fill("לא הגיע לפגישה");
    await page.getByTestId("drawer-no-show-submit").click();

    await expect.poll(() => state.events[0]?.status).toBe("no_show");
    const drawer = page.getByTestId("calendar-event-drawer");
    await expect(drawer.getByText("לא הגיע", { exact: true }).first()).toBeVisible();
    await expect(drawer.getByText("הלקוח לא הגיע")).toBeVisible();
  });
});
