import type { Page, Route } from "@playwright/test";
import { expect } from "@playwright/test";

export const TEST_TOKEN = "e2e-test-token";

export const MOCK_CLIENT = {
  id: "client-e2e-1",
  name: "לקוח בדיקה",
  whatsappNumber: null,
  color: null,
};

export const MOCK_SERVICE = {
  id: "svc-e2e-1",
  name: "ייעוץ",
  durationMinutes: 30,
  price: null,
  color: "#3B82F6",
  isActive: true,
};

type MockEvent = {
  id: string;
  status: string;
  startAt: string;
  endAt: string;
  title: string;
  clientId: string;
  serviceId: string | null;
  workCaseId: string;
  prerequisitesJson: unknown[];
  client: typeof MOCK_CLIENT;
  service: typeof MOCK_SERVICE | null;
  workCase: { id: string; title: string; status: string };
};

type MockDecision = {
  id: string;
  type: string;
  status: string;
  title: string;
  reason: string | null;
  calendarEventId: string;
  workCaseId: string;
  createdAt: string;
  preparedPayloadJson?: Record<string, unknown> | null;
  calendarEvent: {
    id: string;
    status: string;
    title: string;
    startAt: string;
    endAt: string;
  };
  workCase: { id: string; title: string };
};

type MockTimelineEntry = {
  id: string;
  type: string;
  summary: string;
  createdAt: string;
};

export type CalendarEngineMockState = {
  events: MockEvent[];
  decisions: MockDecision[];
  timeline: MockTimelineEntry[];
  legacyAppointments: Array<{
    id: string;
    startTime: string;
    durationMinutes: number;
    status: string;
    clientId: string;
  }>;
  appointmentsRequested: number;
  calendarEventsRequested: number;
  natalieBookRequests: number;
  natalieCancelRequests: number;
  natalieRescheduleRequests: number;
  engineDisabled: boolean;
  orgEngineEnabled: boolean;
};

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function orgSettings() {
  return {
    id: "org-e2e",
    name: "E2E Org",
    businessName: "E2E Org",
    businessType: "service_business",
    businessSize: null,
    mainBusinessPain: null,
    enabledModules: ["calendar", "crm", "invoices", "tasks"],
    onboardingCompleted: true,
    onboardingRequired: false,
    recommendedModules: ["calendar"],
    locale: "he",
    currency: "ILS",
    timezone: "Asia/Jerusalem",
  };
}

function nextEventId(state: CalendarEngineMockState) {
  return `evt-e2e-${state.events.length + 1}`;
}

function nextDecisionId(state: CalendarEngineMockState) {
  return `dec-e2e-${state.decisions.length + 1}`;
}

function nextTimelineId(state: CalendarEngineMockState) {
  return `tl-e2e-${state.timeline.length + 1}`;
}

/** Mirrors calendar page week boundaries (Sunday-start, local timezone). */
function getWeekStartLocal(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function addDaysLocal(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isEventInWeek(eventStartIso: string, weekStart: Date): boolean {
  const eventStart = new Date(eventStartIso);
  const weekEnd = addDaysLocal(weekStart, 7);
  return eventStart >= weekStart && eventStart < weekEnd;
}

export async function waitForCalendarEventsReload(page: Page) {
  await page
    .waitForResponse(
      (response) =>
        response.url().includes("/api/calendar/events") &&
        response.request().method() === "GET" &&
        response.ok(),
      { timeout: 15_000 }
    )
    .catch(() => undefined);
}

/**
 * Week grid only renders events whose local date falls on a visible column.
 * After approve, reload may lag; past-day fixtures may sit in the previous week (e.g. Sunday → Saturday).
 */
export async function ensureCalendarWeekShowsEvent(page: Page, eventStartIso: string) {
  const eventButton = page.locator("button").filter({ hasText: MOCK_CLIENT.name }).first();

  await waitForCalendarEventsReload(page);
  if (await eventButton.isVisible().catch(() => false)) {
    return;
  }

  let displayedWeekStart = getWeekStartLocal(new Date());
  const eventStart = new Date(eventStartIso);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (isEventInWeek(eventStartIso, displayedWeekStart)) {
      await expect(eventButton).toBeVisible({ timeout: 10_000 });
      return;
    }

    if (eventStart < displayedWeekStart) {
      await page.getByRole("button", { name: "שבוע קודם" }).click();
      displayedWeekStart = addDaysLocal(displayedWeekStart, -7);
    } else {
      await page.getByRole("button", { name: "שבוע הבא" }).click();
      displayedWeekStart = addDaysLocal(displayedWeekStart, 7);
    }
    await waitForCalendarEventsReload(page);

    if (await eventButton.isVisible().catch(() => false)) {
      return;
    }
  }

  await expect(eventButton).toBeVisible({ timeout: 10_000 });
}

export function createCalendarEngineMockState(): CalendarEngineMockState {
  return {
    events: [],
    decisions: [],
    timeline: [],
    legacyAppointments: [],
    appointmentsRequested: 0,
    calendarEventsRequested: 0,
    natalieBookRequests: 0,
    natalieCancelRequests: 0,
    natalieRescheduleRequests: 0,
    engineDisabled: false,
    orgEngineEnabled: true,
  };
}

function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function unifiedSlotBlocked(
  state: CalendarEngineMockState,
  startIso: string,
  durationMinutes: number,
  exclude?: { appointmentId?: string; calendarEventId?: string }
): boolean {
  const start = new Date(startIso).getTime();
  const end = start + durationMinutes * 60_000;

  for (const appt of state.legacyAppointments) {
    if (appt.status === "cancelled") continue;
    if (exclude?.appointmentId && appt.id === exclude.appointmentId) continue;
    const apptStart = new Date(appt.startTime).getTime();
    const apptEnd = apptStart + appt.durationMinutes * 60_000;
    if (intervalsOverlap(start, end, apptStart, apptEnd)) return true;
  }

  for (const event of state.events) {
    if (!["pending_readiness", "confirmed"].includes(event.status)) continue;
    if (exclude?.calendarEventId && event.id === exclude.calendarEventId) continue;
    const evtStart = new Date(event.startAt).getTime();
    const evtEnd = new Date(event.endAt).getTime();
    if (intervalsOverlap(start, end, evtStart, evtEnd)) return true;
  }

  return false;
}

const DECISION_TYPE_LABELS: Record<string, string> = {
  confirm_appointment: "אישור תור",
  override_conflict: "עקיפת התנגשות",
  cancel_appointment: "ביטול תור",
  reschedule_appointment: "דחיית תור",
};

const APPOINTMENT_STATUS_HE: Record<string, string> = {
  pending: "ממתין לאישור",
  confirmed: "מאושר",
};

const EVENT_STATUS_HE: Record<string, string> = {
  pending_readiness: "ממתין לבדיקות",
  confirmed: "מאושר",
};

export function buildSchedulingCapabilities(
  state: CalendarEngineMockState,
  mode: "engine" | "appointments" | "engine-503"
) {
  const orgEnabled =
    state.orgEngineEnabled && (mode === "engine" || mode === "engine-503") && !state.engineDisabled;
  return {
    calendarEngineReadEnabled: orgEnabled,
    calendarEngineWriteEnabled: orgEnabled,
    ownerDecisionQueueEnabled: orgEnabled,
    googleMirrorEnabled: orgEnabled,
    source: orgEnabled ? "enabled" : mode === "engine" && !state.orgEngineEnabled ? "org_disabled" : "global_disabled",
  };
}

export function buildBriefingSnapshot(
  state: CalendarEngineMockState,
  mode: "engine" | "appointments" | "engine-503"
) {
  const engineReadEnabled =
    (mode === "engine" || mode === "engine-503") && !state.engineDisabled && state.orgEngineEnabled;
  const now = Date.now();

  const upcomingFromAppointments = state.legacyAppointments
    .filter((appt) => appt.status !== "cancelled" && new Date(appt.startTime).getTime() >= now)
    .map((appt) => ({
      id: appt.id,
      source: "appointment" as const,
      clientName: MOCK_CLIENT.name,
      startTime: appt.startTime,
      endTime: new Date(new Date(appt.startTime).getTime() + appt.durationMinutes * 60_000).toISOString(),
      durationMinutes: appt.durationMinutes,
      status: appt.status,
      statusLabel: APPOINTMENT_STATUS_HE[appt.status] ?? appt.status,
      pendingOwnerApproval: appt.status === "pending",
    }));

  const upcomingFromEngine = engineReadEnabled
    ? state.events
        .filter(
          (event) =>
            ["pending_readiness", "confirmed"].includes(event.status) &&
            new Date(event.startAt).getTime() >= now
        )
        .map((event) => ({
          id: event.id,
          source: "calendar_event" as const,
          clientName: event.client.name,
          serviceName: event.service?.name,
          startTime: event.startAt,
          endTime: event.endAt,
          durationMinutes: Math.max(
            1,
            Math.round((new Date(event.endAt).getTime() - new Date(event.startAt).getTime()) / 60_000)
          ),
          status: event.status,
          statusLabel: EVENT_STATUS_HE[event.status] ?? event.status,
          pendingOwnerApproval: event.status === "pending_readiness",
        }))
    : [];

  const upcoming = [...upcomingFromAppointments, ...upcomingFromEngine].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const pendingDecisions = engineReadEnabled
    ? state.decisions
        .filter((d) => d.status === "pending")
        .map((d) => ({
          id: d.id,
          type: d.type,
          typeLabel: DECISION_TYPE_LABELS[d.type] ?? "החלטה",
          title: d.title,
          reason: d.reason,
          calendarEventId: d.calendarEventId,
          createdAt: d.createdAt,
          href: `/dashboard/calendar?decisionId=${encodeURIComponent(d.id)}`,
        }))
    : [];

  const todayTerminal = engineReadEnabled
    ? state.events.filter((e) => ["completed", "no_show", "cancelled"].includes(e.status))
    : [];

  return {
    engineReadEnabled,
    upcoming,
    pendingDecisions,
    todaySummary: {
      upcomingCount: upcoming.length,
      pendingDecisionCount: engineReadEnabled
        ? pendingDecisions.length
        : upcomingFromAppointments.filter((a) => a.pendingOwnerApproval).length,
      todayCompletedCount: todayTerminal.filter((e) => e.status === "completed").length,
      todayNoShowCount: todayTerminal.filter((e) => e.status === "no_show").length,
      todayCancelledCount: todayTerminal.filter((e) => e.status === "cancelled").length,
    },
  };
}

function emptyDashboardStats() {
  return {
    moneyToPay: 0,
    moneyToReceive: 0,
    pendingInvoices: 0,
    missingInvoicesCount: 0,
    upcomingPaymentsCount: 0,
    openTasks: 0,
    unreadAlerts: 0,
    businessHealthScore: 100,
    totalInvoices: 0,
    currency: "ILS",
  };
}

export async function injectAuthToken(context: import("@playwright/test").BrowserContext, page?: Page) {
  const script = (token: string) => {
    localStorage.setItem("token", token);
  };
  await context.addInitScript(script, TEST_TOKEN);
  if (page) {
    await page.addInitScript(script, TEST_TOKEN);
  }
}

export async function installCalendarApiMocks(page: Page, state: CalendarEngineMockState, mode: "engine" | "appointments" | "engine-503") {
  await page.route(/\/api\//, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();

    if (path.endsWith("/api/organization/settings")) {
      return json(route, 200, orgSettings());
    }
    if (path.endsWith("/api/services")) {
      return json(route, 200, [MOCK_SERVICE]);
    }
    if (path.endsWith("/api/clients") || path.endsWith("/api/clients/")) {
      return json(route, 200, { clients: [MOCK_CLIENT] });
    }
    if (path.endsWith("/api/integrations/calendar/status")) {
      return json(route, 200, { connected: false });
    }

    if (path.endsWith("/api/scheduling/capabilities") && method === "GET") {
      return json(route, 200, buildSchedulingCapabilities(state, mode));
    }

    if (path.endsWith("/api/scheduling/briefing") && method === "GET") {
      return json(route, 200, buildBriefingSnapshot(state, mode));
    }

    if (path.endsWith("/api/stats")) {
      return json(route, 200, emptyDashboardStats());
    }
    if (path.endsWith("/api/summary/daily")) {
      return json(route, 200, { text: "סיכום יומי לבדיקה" });
    }
    if (path.endsWith("/api/payments") || path.endsWith("/api/reports/missing-invoices")) {
      return json(route, 200, []);
    }
    if (path.endsWith("/api/invoices")) {
      return json(route, 200, { invoices: [] });
    }
    if (path.endsWith("/api/tasks")) {
      return json(route, 200, []);
    }
    if (path.endsWith("/api/alerts")) {
      return json(route, 200, []);
    }
    if (path.includes("/api/document-reviews")) {
      return json(route, 200, []);
    }
    if (path.endsWith("/api/accountant/summary")) {
      return json(route, 200, { connected: false });
    }
    if (path.endsWith("/api/system/health")) {
      return json(route, 200, { ok: true, components: { whatsapp: { connected: false } } });
    }
    if (path.includes("/api/integrations/gmail/status")) {
      return json(route, 200, { googleConfigured: true, connected: true, connectedAt: null });
    }
    if (path.endsWith("/api/automation/scan-status")) {
      return json(route, 200, { logs: [] });
    }

    if (path.endsWith("/api/appointments/availability/slots") && method === "POST") {
      state.appointmentsRequested += 1;
      const body = route.request().postDataJSON() as {
        durationMinutes?: number;
        limit?: number;
      };
      const durationMinutes = body.durationMinutes ?? 30;
      const limit = body.limit ?? 3;
      const base = new Date();
      base.setHours(base.getHours() + 2, 0, 0, 0);
      const slots = [];
      for (let i = 0; i < 24 && slots.length < limit; i++) {
        const candidate = new Date(base.getTime() + i * 60 * 60_000);
        if (!unifiedSlotBlocked(state, candidate.toISOString(), durationMinutes)) {
          slots.push({
            startTime: candidate.toISOString(),
            endTime: new Date(candidate.getTime() + durationMinutes * 60_000).toISOString(),
            label: candidate.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }),
          });
        }
      }
      return json(route, 200, {
        timeZone: "Asia/Jerusalem",
        durationMinutes,
        searchedFrom: base.toISOString(),
        searchedTo: new Date(base.getTime() + 24 * 60 * 60_000).toISOString(),
        slots,
        empty: slots.length === 0,
      });
    }

    if (path.endsWith("/api/appointments/availability/check") && method === "POST") {
      state.appointmentsRequested += 1;
      const body = route.request().postDataJSON() as {
        startTime?: string;
        durationMinutes?: number;
      };
      const durationMinutes = body.durationMinutes ?? 30;
      const startTime = body.startTime ?? new Date().toISOString();
      const blocked = unifiedSlotBlocked(state, startTime, durationMinutes);
      return json(route, 200, {
        available: !blocked,
        reason: blocked ? "time_conflict" : undefined,
        startTime,
        endTime: new Date(new Date(startTime).getTime() + durationMinutes * 60_000).toISOString(),
        durationMinutes,
        timeZone: "Asia/Jerusalem",
      });
    }

    if (path.includes("/api/appointments")) {
      state.appointmentsRequested += 1;
      if (method === "GET") {
        return json(route, 200, state.legacyAppointments);
      }
      if (method === "POST" && path.endsWith("/api/appointments")) {
        const body = route.request().postDataJSON() as {
          startTime: string;
          durationMinutes?: number;
          clientId?: string;
        };
        const appt = {
          id: `appt-e2e-${state.legacyAppointments.length + 1}`,
          startTime: body.startTime,
          durationMinutes: body.durationMinutes ?? 30,
          status: "pending",
          clientId: body.clientId ?? MOCK_CLIENT.id,
        };
        state.legacyAppointments.push(appt);
        return json(route, 201, appt);
      }
      return json(route, 201, {});
    }

    if (path.endsWith("/api/natalie/create-appointment") && method === "POST") {
      state.natalieBookRequests += 1;
      const body = route.request().postDataJSON() as {
        clientName?: string;
        startTime?: string;
        durationMinutes?: number;
      };
      const startTime = body.startTime ?? new Date(Date.now() + 86_400_000).toISOString();
      const durationMinutes = body.durationMinutes ?? 30;

      if (unifiedSlotBlocked(state, startTime, durationMinutes)) {
        return json(route, 409, { error: "conflict", code: "time_conflict" });
      }

      const useEngine = mode === "engine" && !state.engineDisabled;
      if (!useEngine) {
        const appt = {
          id: `appt-natalie-${state.legacyAppointments.length + 1}`,
          startTime,
          durationMinutes,
          status: "pending",
          clientId: MOCK_CLIENT.id,
          client: MOCK_CLIENT,
          service: null,
        };
        state.legacyAppointments.push(appt);
        return json(route, 201, appt);
      }

      const workCaseId = `wc-natalie-${state.events.length + 1}`;
      const endAt = new Date(new Date(startTime).getTime() + durationMinutes * 60_000).toISOString();
      const event: MockEvent = {
        id: nextEventId(state),
        status: "pending_readiness",
        startAt: startTime,
        endAt,
        title: body.clientName ?? MOCK_CLIENT.name,
        clientId: MOCK_CLIENT.id,
        serviceId: null,
        workCaseId,
        prerequisitesJson: [],
        client: MOCK_CLIENT,
        service: null,
        workCase: { id: workCaseId, title: "תיק נטלי", status: "open" },
      };
      state.events.push(event);
      const decision: MockDecision = {
        id: nextDecisionId(state),
        type: "confirm_appointment",
        status: "pending",
        title: event.title,
        reason: null,
        calendarEventId: event.id,
        workCaseId,
        createdAt: new Date().toISOString(),
        calendarEvent: {
          id: event.id,
          status: event.status,
          title: event.title,
          startAt: event.startAt,
          endAt: event.endAt,
        },
        workCase: { id: workCaseId, title: "תיק נטלי" },
      };
      state.decisions.push(decision);
      return json(route, 201, {
        id: event.id,
        status: "pending_readiness",
        startTime,
        durationMinutes,
        pendingApproval: true,
        decisionId: decision.id,
        engineMode: true,
        message: "שלחתי את הבקשה לאישור",
      });
    }

    if (path.endsWith("/api/natalie/cancel-appointment") && method === "POST") {
      state.natalieCancelRequests += 1;
      const body = route.request().postDataJSON() as { appointmentId?: string };
      const itemId = body.appointmentId ?? "";
      const useEngine = mode === "engine" && !state.engineDisabled;

      if (!useEngine) {
        const appt = state.legacyAppointments.find((a) => a.id === itemId);
        if (!appt) return json(route, 404, { code: "appointment_not_found" });
        appt.status = "cancelled";
        return json(route, 200, { ok: true, appointment: appt });
      }

      const event = state.events.find((e) => e.id === itemId);
      if (!event) return json(route, 404, { code: "appointment_not_found" });
      const decision: MockDecision = {
        id: nextDecisionId(state),
        type: "cancel_appointment",
        status: "pending",
        title: event.title,
        reason: "בקשת ביטול",
        calendarEventId: event.id,
        workCaseId: event.workCaseId,
        createdAt: new Date().toISOString(),
        calendarEvent: {
          id: event.id,
          status: event.status,
          title: event.title,
          startAt: event.startAt,
          endAt: event.endAt,
        },
        workCase: event.workCase,
      };
      state.decisions.push(decision);
      return json(route, 200, {
        ok: true,
        pendingApproval: true,
        decisionId: decision.id,
        engineMode: true,
      });
    }

    if (path.endsWith("/api/natalie/reschedule-appointment") && method === "POST") {
      state.natalieRescheduleRequests += 1;
      const body = route.request().postDataJSON() as {
        appointmentId?: string;
        newStartTime?: string;
      };
      const itemId = body.appointmentId ?? "";
      const newStart = body.newStartTime ?? new Date(Date.now() + 172_800_000).toISOString();
      const useEngine = mode === "engine" && !state.engineDisabled;

      if (!useEngine) {
        const appt = state.legacyAppointments.find((a) => a.id === itemId);
        if (!appt) return json(route, 404, { code: "appointment_not_found" });
        appt.startTime = newStart;
        return json(route, 200, { ok: true, appointment: appt });
      }

      const event = state.events.find((e) => e.id === itemId);
      if (!event) return json(route, 404, { code: "appointment_not_found" });
      if (unifiedSlotBlocked(state, newStart, 30, { calendarEventId: event.id })) {
        return json(route, 409, { code: "time_conflict" });
      }
      const decision: MockDecision = {
        id: nextDecisionId(state),
        type: "reschedule_appointment",
        status: "pending",
        title: event.title,
        reason: "בקשת דחייה",
        calendarEventId: event.id,
        workCaseId: event.workCaseId,
        createdAt: new Date().toISOString(),
        preparedPayloadJson: { startAt: newStart, endAt: event.endAt },
        calendarEvent: {
          id: event.id,
          status: event.status,
          title: event.title,
          startAt: event.startAt,
          endAt: event.endAt,
        },
        workCase: event.workCase,
      };
      state.decisions.push(decision);
      return json(route, 200, {
        ok: true,
        pendingApproval: true,
        decisionId: decision.id,
        engineMode: true,
      });
    }

    if (path.includes("/api/calendar/events")) {
      state.calendarEventsRequested += 1;

      if (mode === "engine-503" || state.engineDisabled) {
        return json(route, 503, {
          error: "מנוע היומן אינו פעיל כרגע",
          code: "CALENDAR_ENGINE_DISABLED",
        });
      }

      if (mode === "appointments") {
        return json(route, 503, {
          error: "מנוע היומן אינו פעיל כרגע",
          code: "CALENDAR_ENGINE_DISABLED",
        });
      }

      const eventIdMatch = path.match(/\/api\/calendar\/events\/([^/]+)(?:\/|$)/);
      const eventId = eventIdMatch?.[1];

      if (method === "GET" && !eventId) {
        return json(route, 200, state.events);
      }

      if (method === "GET" && eventId && !path.includes("submit-for-confirmation")) {
        const event = state.events.find((e) => e.id === eventId);
        if (!event) return json(route, 404, { error: "לא נמצא", code: "NOT_FOUND" });
        return json(route, 200, event);
      }

      if (method === "POST" && path.endsWith("/api/calendar/events")) {
        const body = route.request().postDataJSON() as {
          startAt: string;
          endAt: string;
          clientId?: string;
          serviceId?: string | null;
          title?: string | null;
        };
        const workCaseId = `wc-e2e-${state.events.length + 1}`;
        const event: MockEvent = {
          id: nextEventId(state),
          status: "draft",
          startAt: body.startAt,
          endAt: body.endAt,
          title: body.title ?? MOCK_CLIENT.name,
          clientId: body.clientId ?? MOCK_CLIENT.id,
          serviceId: body.serviceId ?? null,
          workCaseId,
          prerequisitesJson: [],
          client: MOCK_CLIENT,
          service: body.serviceId ? MOCK_SERVICE : null,
          workCase: { id: workCaseId, title: "תיק יומן", status: "open" },
        };
        state.events.push(event);
        state.timeline.unshift({
          id: nextTimelineId(state),
          type: "work_case_created",
          summary: "נוצר תיק יומן",
          createdAt: new Date().toISOString(),
        });
        return json(route, 201, event);
      }

      if (method === "POST" && eventId && path.endsWith("/submit-for-confirmation")) {
        const event = state.events.find((e) => e.id === eventId);
        if (!event) return json(route, 404, { error: "לא נמצא", code: "NOT_FOUND" });
        event.status = "pending_readiness";
        const decision: MockDecision = {
          id: nextDecisionId(state),
          type: "confirm_appointment",
          status: "pending",
          title: event.title,
          reason: null,
          calendarEventId: event.id,
          workCaseId: event.workCaseId,
          createdAt: new Date().toISOString(),
          preparedPayloadJson: { targetStatus: "confirmed" },
          calendarEvent: {
            id: event.id,
            status: event.status,
            title: event.title,
            startAt: event.startAt,
            endAt: event.endAt,
          },
          workCase: { id: event.workCaseId, title: event.workCase.title },
        };
        state.decisions.push(decision);
        return json(route, 200, {
          mode: "queued",
          decisionId: decision.id,
          queueType: "confirm_appointment",
        });
      }

      if (method === "POST" && eventId && path.endsWith("/request-cancel")) {
        const event = state.events.find((e) => e.id === eventId);
        if (!event) return json(route, 404, { error: "לא נמצא", code: "NOT_FOUND" });
        const decision: MockDecision = {
          id: nextDecisionId(state),
          type: "cancel_appointment",
          status: "pending",
          title: event.title,
          reason: "נדרש אישור לפני ביטול התור",
          calendarEventId: event.id,
          workCaseId: event.workCaseId,
          createdAt: new Date().toISOString(),
          preparedPayloadJson: { targetStatus: "cancelled" },
          calendarEvent: {
            id: event.id,
            status: event.status,
            title: event.title,
            startAt: event.startAt,
            endAt: event.endAt,
          },
          workCase: { id: event.workCaseId, title: event.workCase.title },
        };
        state.decisions.push(decision);
        return json(route, 200, { decisionId: decision.id, queueType: "cancel_appointment" });
      }

      if (method === "POST" && eventId && path.endsWith("/request-reschedule")) {
        const event = state.events.find((e) => e.id === eventId);
        if (!event) return json(route, 404, { error: "לא נמצא", code: "NOT_FOUND" });
        const body = route.request().postDataJSON() as { startAt: string; endAt: string };
        const decision: MockDecision = {
          id: nextDecisionId(state),
          type: "reschedule_appointment",
          status: "pending",
          title: event.title,
          reason: "נדרש אישור לפני דחיית התור",
          calendarEventId: event.id,
          workCaseId: event.workCaseId,
          createdAt: new Date().toISOString(),
          preparedPayloadJson: { startAt: body.startAt, endAt: body.endAt },
          calendarEvent: {
            id: event.id,
            status: event.status,
            title: event.title,
            startAt: event.startAt,
            endAt: event.endAt,
          },
          workCase: { id: event.workCaseId, title: event.workCase.title },
        };
        state.decisions.push(decision);
        return json(route, 200, { decisionId: decision.id, queueType: "reschedule_appointment" });
      }

      if (method === "POST" && eventId && path.endsWith("/complete")) {
        const event = state.events.find((e) => e.id === eventId);
        if (!event) return json(route, 404, { error: "לא נמצא", code: "NOT_FOUND" });
        const body = route.request().postDataJSON() as {
          completionNotes?: string;
          completionOutcome?: string;
        };
        if (!body.completionNotes?.trim()) {
          return json(route, 400, { error: "completionNotes is required", code: "VALIDATION_FAILED" });
        }
        event.status = "completed";
        (event as MockEvent & { completionNotes?: string; completionOutcome?: string }).completionNotes =
          body.completionNotes;
        (event as MockEvent & { completionNotes?: string; completionOutcome?: string }).completionOutcome =
          body.completionOutcome ?? "completed_success";
        state.timeline.unshift({
          id: nextTimelineId(state),
          type: "event_completed",
          summary: "האירוע הושלם",
          createdAt: new Date().toISOString(),
        });
        return json(route, 200, event);
      }

      if (method === "POST" && eventId && path.endsWith("/no-show")) {
        const event = state.events.find((e) => e.id === eventId);
        if (!event) return json(route, 404, { error: "לא נמצא", code: "NOT_FOUND" });
        const body = route.request().postDataJSON() as { notes?: string };
        if (!body.notes?.trim()) {
          return json(route, 400, { error: "notes are required", code: "VALIDATION_FAILED" });
        }
        event.status = "no_show";
        (event as MockEvent & { completionNotes?: string }).completionNotes = body.notes;
        state.timeline.unshift({
          id: nextTimelineId(state),
          type: "event_no_show",
          summary: "הלקוח לא הגיע",
          createdAt: new Date().toISOString(),
        });
        return json(route, 200, event);
      }
    }

    const decisionMatch = path.match(/\/api\/owner-decisions\/([^/]+)\/(approve|reject)$/);
    if (decisionMatch && method === "POST") {
      const [, decisionId, action] = decisionMatch;
      const decision = state.decisions.find((d) => d.id === decisionId);
      if (!decision) return json(route, 404, { error: "לא נמצא", code: "NOT_FOUND" });
      const event = state.events.find((e) => e.id === decision.calendarEventId);

      if (action === "approve" && event) {
        if (decision.type === "confirm_appointment" || decision.type === "override_conflict") {
          event.status = "confirmed";
          state.timeline.unshift({
            id: nextTimelineId(state),
            type: "approval_granted",
            summary: "האירוע אושר",
            createdAt: new Date().toISOString(),
          });
        } else if (decision.type === "cancel_appointment") {
          event.status = "cancelled";
          state.timeline.unshift({
            id: nextTimelineId(state),
            type: "event_cancelled",
            summary: "האירוע בוטל",
            createdAt: new Date().toISOString(),
          });
        } else if (decision.type === "reschedule_appointment") {
          const payload = decision.preparedPayloadJson ?? {};
          event.status = "rescheduled";
          const newEvent: MockEvent = {
            ...event,
            id: nextEventId(state),
            status: "pending_readiness",
            startAt: String(payload.startAt ?? event.startAt),
            endAt: String(payload.endAt ?? event.endAt),
            workCaseId: event.workCaseId,
            workCase: event.workCase,
          };
          state.events.push(newEvent);
          state.timeline.unshift({
            id: nextTimelineId(state),
            type: "event_rescheduled",
            summary: "האירוע נדחה לזמן אחר",
            createdAt: new Date().toISOString(),
          });
        }
        decision.status = "approved";
        state.decisions = state.decisions.filter((d) => d.id !== decisionId);
      }

      if (action === "reject" && event) {
        decision.status = "rejected";
        state.decisions = state.decisions.filter((d) => d.id !== decisionId);
        state.timeline.unshift({
          id: nextTimelineId(state),
          type: "approval_rejected",
          summary: "ההחלטה נדחתה",
          createdAt: new Date().toISOString(),
        });
      }

      return json(route, 200, { ok: true });
    }

    if (path.includes("/api/owner-decisions")) {
      if (state.engineDisabled || mode === "engine-503") {
        return json(route, 503, {
          error: "מנוע היומן אינו פעיל כרגע",
          code: "CALENDAR_ENGINE_DISABLED",
        });
      }
      const status = url.searchParams.get("status") ?? "pending";
      const items = state.decisions.filter((d) => d.status === status);
      return json(route, 200, items);
    }

    const timelineMatch = path.match(/\/api\/work-cases\/([^/]+)\/timeline$/);
    if (timelineMatch && method === "GET") {
      return json(route, 200, {
        items: state.timeline,
        nextCursor: null,
        hasMore: false,
      });
    }

    return json(route, 200, {});
  });
}

export async function openCalendarPage(page: Page) {
  await page.goto("/dashboard/calendar");
  await page.getByRole("heading", { name: "היומן שלי" }).waitFor({ timeout: 60_000 });
  await page
    .waitForResponse((r) => r.url().includes("/api/scheduling/capabilities") && r.ok(), { timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForResponse((r) => r.url().includes("/api/clients") && r.ok(), { timeout: 15_000 }).catch(() => undefined);
}

export async function openDashboardPage(page: Page) {
  await page.goto("/dashboard");
  await page.getByText("נטלי").first().waitFor({ timeout: 60_000 });
  await page.waitForResponse((r) => r.url().includes("/api/scheduling/briefing") && r.ok(), { timeout: 15_000 }).catch(() => undefined);
}

export async function createEngineEventViaUi(page: Page, options?: { startInPast?: boolean }) {
  await page.getByRole("button", { name: "תור חדש" }).click();
  const clientSelect = page.locator('label').filter({ hasText: "לקוח" }).locator("select");
  await expect(clientSelect.locator(`option[value="${MOCK_CLIENT.id}"]`)).toHaveCount(1, { timeout: 15_000 });
  await clientSelect.selectOption(MOCK_CLIENT.id);
  const eventDate = new Date();
  if (options?.startInPast) {
    eventDate.setDate(eventDate.getDate() - 1);
  }
  const dateValue = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, "0")}-${String(eventDate.getDate()).padStart(2, "0")}`;
  await page.locator('input[type="date"]').fill(dateValue);
  await page.locator('input[type="time"]').fill(options?.startInPast ? "10:00" : "14:00");
  await page.getByRole("button", { name: "שלח לאישור" }).click();
}

export async function createConfirmedEngineEventViaUi(
  page: Page,
  state: CalendarEngineMockState,
  options?: { startInPast?: boolean }
) {
  await createEngineEventViaUi(page, options);
  await expect.poll(() => state.decisions.length).toBe(1);
  await page.getByTestId("decision-approve").first().click();
  await expect.poll(() => state.events[0]?.status).toBe("confirmed");
  const eventStart = state.events[0]?.startAt;
  if (eventStart) {
    await ensureCalendarWeekShowsEvent(page, eventStart);
  } else {
    await waitForCalendarEventsReload(page);
  }
}

export async function openConfirmedEventDrawer(page: Page, state: CalendarEngineMockState) {
  const eventButton = page.locator("button").filter({ hasText: MOCK_CLIENT.name }).first();
  await expect(eventButton).toBeVisible({ timeout: 15_000 });
  await eventButton.click();
  await expect(page.getByTestId("calendar-event-drawer")).toBeVisible();
}
