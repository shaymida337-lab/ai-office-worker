import { expect, test } from "@playwright/test";
import {
  buildBriefingSnapshot,
  createCalendarEngineMockState,
  injectAuthToken,
  installCalendarApiMocks,
  MOCK_CLIENT,
  openCalendarPage,
  openDashboardPage,
  type CalendarEngineMockState,
} from "./helpers/calendarEngineMock";

const FUTURE_START = () => {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
};

test.describe("Calendar Engine — dashboard briefing (engine ON)", () => {
  let state: CalendarEngineMockState;

  test.beforeEach(async ({ context, page }) => {
    state = createCalendarEngineMockState();
    await injectAuthToken(context, page);
    await installCalendarApiMocks(page, state, "engine");
  });

  test("Natalie book surfaces pending decision in briefing snapshot", async ({ page }) => {
    await openCalendarPage(page);
    const startTime = FUTURE_START();

    await page.evaluate(async (iso) => {
      const token = localStorage.getItem("token");
      await fetch("/api/natalie/create-appointment", {
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
    }, startTime);

    const briefing = await page.evaluate(async () => {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/scheduling/briefing", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return res.json();
    });

    expect(briefing.pendingDecisions.length).toBeGreaterThan(0);
    expect(briefing.pendingDecisions[0].typeLabel).toBe("אישור תור");
    expect(briefing.pendingDecisions[0].href).toContain("decisionId=");
  });

  test("dashboard loads unified briefing with pending decision", async ({ page }) => {
    const startTime = FUTURE_START();
    state.events.push({
      id: "evt-dash-1",
      status: "pending_readiness",
      startAt: startTime,
      endAt: new Date(new Date(startTime).getTime() + 30 * 60_000).toISOString(),
      title: MOCK_CLIENT.name,
      clientId: MOCK_CLIENT.id,
      serviceId: null,
      workCaseId: "wc-dash-1",
      prerequisitesJson: [],
      client: MOCK_CLIENT,
      service: null,
      workCase: { id: "wc-dash-1", title: "תיק", status: "open" },
    });
    state.decisions.push({
      id: "dec-dash-1",
      type: "confirm_appointment",
      status: "pending",
      title: "אישור תור ללקוח",
      reason: null,
      calendarEventId: "evt-dash-1",
      workCaseId: "wc-dash-1",
      createdAt: new Date().toISOString(),
      calendarEvent: {
        id: "evt-dash-1",
        status: "pending_readiness",
        title: MOCK_CLIENT.name,
        startAt: startTime,
        endAt: new Date(new Date(startTime).getTime() + 30 * 60_000).toISOString(),
      },
      workCase: { id: "wc-dash-1", title: "תיק" },
    });

    await openDashboardPage(page);
    const snapshot = buildBriefingSnapshot(state, "engine");
    expect(snapshot.pendingDecisions.length).toBe(1);
    expect(snapshot.upcoming.length).toBe(1);
  });

  test("decisionId deep link highlights queue item and approve confirms event", async ({ page }) => {
    const startTime = FUTURE_START();
    state.events.push({
      id: "evt-link-1",
      status: "pending_readiness",
      startAt: startTime,
      endAt: new Date(new Date(startTime).getTime() + 30 * 60_000).toISOString(),
      title: MOCK_CLIENT.name,
      clientId: MOCK_CLIENT.id,
      serviceId: null,
      workCaseId: "wc-link-1",
      prerequisitesJson: [],
      client: MOCK_CLIENT,
      service: null,
      workCase: { id: "wc-link-1", title: "תיק", status: "open" },
    });
    state.decisions.push({
      id: "dec-link-1",
      type: "confirm_appointment",
      status: "pending",
      title: "אישור תור ללקוח",
      reason: null,
      calendarEventId: "evt-link-1",
      workCaseId: "wc-link-1",
      createdAt: new Date().toISOString(),
      calendarEvent: {
        id: "evt-link-1",
        status: "pending_readiness",
        title: MOCK_CLIENT.name,
        startAt: startTime,
        endAt: new Date(new Date(startTime).getTime() + 30 * 60_000).toISOString(),
      },
      workCase: { id: "wc-link-1", title: "תיק" },
    });

    await page.goto("/dashboard/calendar?decisionId=dec-link-1");
    await page.getByRole("heading", { name: "היומן שלי" }).waitFor({ timeout: 60_000 });
    const highlighted = page.locator('[data-decision-id="dec-link-1"]');
    await expect(highlighted).toBeVisible();
    await expect(highlighted).toHaveClass(/ring/);
    await highlighted.getByTestId("decision-approve").click();
    await expect(page.getByText("אין החלטות ממתינות")).toBeVisible({ timeout: 10_000 });
    expect(state.events.find((e) => e.id === "evt-link-1")?.status).toBe("confirmed");
  });

  test("dual-run briefing includes appointment and engine event", async ({ page }) => {
    const startTime = FUTURE_START();
    const later = new Date(new Date(startTime).getTime() + 2 * 60 * 60_000).toISOString();
    state.legacyAppointments.push({
      id: "appt-dual",
      startTime,
      durationMinutes: 30,
      status: "confirmed",
      clientId: MOCK_CLIENT.id,
    });
    state.events.push({
      id: "evt-dual",
      status: "confirmed",
      startAt: later,
      endAt: new Date(new Date(later).getTime() + 30 * 60_000).toISOString(),
      title: MOCK_CLIENT.name,
      clientId: MOCK_CLIENT.id,
      serviceId: null,
      workCaseId: "wc-dual",
      prerequisitesJson: [],
      client: MOCK_CLIENT,
      service: null,
      workCase: { id: "wc-dual", title: "תיק", status: "open" },
    });

    const briefing = buildBriefingSnapshot(state, "engine");
    expect(briefing.upcoming.length).toBe(2);
    expect(briefing.upcoming.some((item) => item.source === "appointment")).toBe(true);
    expect(briefing.upcoming.some((item) => item.source === "calendar_event")).toBe(true);
    await openDashboardPage(page);
  });
});

test.describe("Calendar Engine — dashboard briefing (engine OFF)", () => {
  test("briefing snapshot stays appointment-only when engine OFF", async ({ context, page }) => {
    const state = createCalendarEngineMockState();
    state.legacyAppointments.push({
      id: "appt-off",
      startTime: FUTURE_START(),
      durationMinutes: 30,
      status: "pending",
      clientId: MOCK_CLIENT.id,
    });
    await injectAuthToken(context, page);
    await installCalendarApiMocks(page, state, "appointments");

    const briefing = buildBriefingSnapshot(state, "appointments");
    expect(briefing.engineReadEnabled).toBe(false);
    expect(briefing.pendingDecisions.length).toBe(0);
    expect(briefing.upcoming.length).toBe(1);
    expect(briefing.upcoming[0]?.source).toBe("appointment");
  });
});
