import { expect, test } from "@playwright/test";
import {
  createCalendarEngineMockState,
  createConfirmedEngineEventViaUi,
  injectAuthToken,
  installCalendarApiMocks,
  MOCK_CLIENT,
  openCalendarPage,
  type CalendarEngineMockState,
} from "./helpers/calendarEngineMock";

const FUTURE_START = () => {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
};

test.describe("Calendar Engine — Natalie scheduling facade (engine ON)", () => {
  let state: CalendarEngineMockState;

  test.beforeEach(async ({ context, page }) => {
    state = createCalendarEngineMockState();
    await injectAuthToken(context, page);
    await installCalendarApiMocks(page, state, "engine");
    await openCalendarPage(page);
  });

  test("unified slot suggestions exclude calendar engine busy blocks", async ({ page }) => {
    const blockedStart = FUTURE_START();
    state.events.push({
      id: "evt-busy",
      status: "confirmed",
      startAt: blockedStart,
      endAt: new Date(new Date(blockedStart).getTime() + 60 * 60_000).toISOString(),
      title: MOCK_CLIENT.name,
      clientId: "client-e2e-1",
      serviceId: null,
      workCaseId: "wc-busy",
      prerequisitesJson: [],
      client: { id: "client-e2e-1", name: "לקוח בדיקה", whatsappNumber: null, color: null },
      service: null,
      workCase: { id: "wc-busy", title: "תיק", status: "open" },
    });

    const slots = await page.evaluate(async () => {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/appointments/availability/slots", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ durationMinutes: 60, limit: 5 }),
      });
      return res.json();
    });

    expect(Array.isArray(slots.slots)).toBe(true);
    for (const slot of slots.slots as Array<{ startTime: string }>) {
      expect(slot.startTime).not.toBe(blockedStart);
    }
  });

  test("Natalie book creates pending engine decision", async ({ page }) => {
    const startTime = FUTURE_START();
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
    expect(result.body.pendingApproval).toBe(true);
    expect(state.decisions.some((d) => d.type === "confirm_appointment")).toBe(true);
    expect(state.events.some((e) => e.status === "pending_readiness")).toBe(true);
    expect(state.natalieBookRequests).toBe(1);
  });

  test("Natalie cancel creates owner decision without immediate cancel", async ({ page }) => {
    await createConfirmedEngineEventViaUi(page, state);
    const eventId = state.events[0]!.id;

    const result = await page.evaluate(async (id) => {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/natalie/cancel-appointment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ appointmentId: id }),
      });
      return { status: res.status, body: await res.json() };
    }, eventId);

    expect(result.status).toBe(200);
    expect(result.body.pendingApproval).toBe(true);
    expect(state.events[0]?.status).toBe("confirmed");
    expect(state.decisions.some((d) => d.type === "cancel_appointment")).toBe(true);
  });

  test("Natalie reschedule creates owner decision", async ({ page }) => {
    await createConfirmedEngineEventViaUi(page, state);
    const eventId = state.events[0]!.id;
    const newStart = FUTURE_START();

    const result = await page.evaluate(
      async ({ id, start }) => {
        const token = localStorage.getItem("token");
        const res = await fetch("/api/natalie/reschedule-appointment", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ appointmentId: id, newStartTime: start }),
        });
        return { status: res.status, body: await res.json() };
      },
      { id: eventId, start: newStart }
    );

    expect(result.status).toBe(200);
    expect(result.body.pendingApproval).toBe(true);
    expect(state.decisions.some((d) => d.type === "reschedule_appointment")).toBe(true);
  });

  test("double booking rejected when slot already taken", async ({ page }) => {
    const startTime = FUTURE_START();
    state.events.push({
      id: "evt-existing",
      status: "confirmed",
      startAt: startTime,
      endAt: new Date(new Date(startTime).getTime() + 30 * 60_000).toISOString(),
      title: "לקוח בדיקה",
      clientId: "client-e2e-1",
      serviceId: null,
      workCaseId: "wc-existing",
      prerequisitesJson: [],
      client: { id: "client-e2e-1", name: "לקוח בדיקה", whatsappNumber: null, color: null },
      service: null,
      workCase: { id: "wc-existing", title: "תיק", status: "open" },
    });

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

    expect(result.status).toBe(409);
    expect(result.body.code).toBe("time_conflict");
  });
});
