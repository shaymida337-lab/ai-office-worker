import { prisma } from "../../lib/prisma.js";
import {
  AppointmentConflictError,
  resolveAppointmentDateTime,
  updateAppointmentForOrganization,
  type AppointmentWithRelations,
} from "../appointmentService.js";
import { runAppointmentGoogleSync } from "../appointmentGoogleSync.js";
import {
  checkSlotAvailability,
  findAvailableSlotsForOrganization,
  resolveDurationMinutes,
} from "../calendar/availability.js";
import { resolveSlotTime } from "../calendar/datetime.js";
import type {
  CheckSlotAvailabilityResult,
  FindAvailableSlotsResult,
} from "../calendar/types.js";
import { resolveCalendarEngineFlags } from "../calendar/calendarEngineFlags.js";
import { CalendarEngine } from "../calendar/calendarEngineFacade.js";
import {
  buildApiEngineContext,
  buildNatalieEngineContext,
  checkSlotViaCalendarEngine,
  mapEngineFailureToSchedulingError,
} from "../calendar/calendarEngineRouting.js";
import type { SubmitConfirmationResult } from "../calendar/calendarEventService.js";
import { getCalendarRulesForOrganization } from "../calendar/rules.js";
import { appointmentEnd, isInPast } from "../calendar/engine.js";
import { recordCalendarAudit } from "../calendar/calendarAudit.js";
import { scheduleNatalieAppointmentAtomic } from "./schedulingBookWorkflow.js";
import {
  formatAmbiguousCustomerMessage,
  resolveSchedulingCustomerMatches,
} from "./schedulingCustomer.js";
import {
  getUpcomingSchedulingForClient,
  getUpcomingSchedulingForOrganizationDetailed,
} from "./schedulingReadRepository.js";
import { SchedulingFacadeError } from "./schedulingErrors.js";

export { SchedulingFacadeError } from "./schedulingErrors.js";

export type UpcomingSchedulingItem = {
  id: string;
  startTime: Date;
  durationMinutes: number;
  clientName: string;
  serviceName?: string;
  /** Present for Google read-through rows (`gcal:…`). Cancel/reschedule must ignore these. */
  source?: "appointment" | "calendar_event" | "google_calendar";
};

export type UpcomingSchedulingOrgResult = {
  items: Array<UpcomingSchedulingItem & { clientId: string }>;
  googleReadWarningHe?: string;
  googleReadStatus: "full" | "partial" | "local_only" | "unavailable";
  googleReadDegraded: boolean;
  googleReadReason?: string;
  googleReadStatusCode?: number;
};

export type NatalieBookInput = {
  organizationId: string;
  userId: string;
  clientName: string;
  clientId?: string;
  clientPhone?: string | null;
  clientEmail?: string | null;
  address?: string | null;
  dayReference?: string;
  time?: string;
  startTime?: string;
  durationMinutes?: number;
  serviceName?: string;
  notes?: string;
  /** Calendar Phase 1: תור לעובד ספציפי; חסר = היומן של בעל העסק */
  employeeId?: string;
};

export type NatalieBookResult =
  | { engine: false; appointment: AppointmentWithRelations }
  | {
      engine: true;
      calendarEventId: string;
      workCaseId: string;
      status: string;
      startTime: string;
      durationMinutes: number;
      clientId: string;
      pendingApproval: boolean;
      decisionId?: string;
      queueType?: string;
      message: string;
    };

export type NatalieCancelResult =
  | { engine: false; ok: true; appointment: AppointmentWithRelations }
  | { engine: true; ok: true; pendingApproval: true; decisionId: string; queueType: string; message: string };

export type NatalieRescheduleResult =
  | { engine: false; ok: true; appointment: AppointmentWithRelations }
  | { engine: true; ok: true; pendingApproval: true; decisionId: string; queueType: string; message: string };

export async function usesCalendarEngineScheduling(organizationId: string): Promise<boolean> {
  const flags = await resolveCalendarEngineFlags(organizationId);
  return flags.writeEnabled;
}

export { checkSlotAvailability, findAvailableSlotsForOrganization };

function natalieEngineContext(organizationId: string, userId: string) {
  return buildNatalieEngineContext({ organizationId, userId });
}

function formatBookMessage(result: SubmitConfirmationResult): string {
  if (result.mode === "queued") {
    return "שלחתי את הבקשה לאישור — התור ממתין לאישורך לפני שייקבע.";
  }
  return "התור אושר ונקבע.";
}

export async function findUpcomingSchedulingForOrganization(params: {
  organizationId: string;
  limit?: number;
}): Promise<Array<UpcomingSchedulingItem & { clientId: string }>> {
  const result = await findUpcomingSchedulingForOrganizationDetailed(params);
  return result.items;
}

export async function findUpcomingSchedulingForOrganizationDetailed(params: {
  organizationId: string;
  limit?: number;
  /** Read window start (defaults to now). Used by calendar read engine for in-progress lookups. */
  now?: Date;
}): Promise<UpcomingSchedulingOrgResult> {
  // Single source of truth: always merge legacy Appointment + CalendarEvent so
  // Natalie finds bookings regardless of which table (or engine flag) stored them.
  // Also merges Google Calendar read-through when connected (deduped).
  const detailed = await getUpcomingSchedulingForOrganizationDetailed({
    organizationId: params.organizationId,
    limit: params.limit ?? 50,
    now: params.now,
  });
  return {
    items: detailed.items.map((item) => ({
      id: item.id,
      startTime: item.startTime,
      durationMinutes: item.durationMinutes,
      clientName: item.clientName,
      serviceName: item.serviceName,
      clientId: item.clientId ?? "",
      source: item.source,
    })),
    googleReadWarningHe: detailed.googleReadWarningHe,
    googleReadStatus: detailed.googleReadStatus,
    googleReadDegraded: detailed.googleReadDegraded,
    googleReadReason: detailed.googleReadReason,
    googleReadStatusCode: detailed.googleReadStatusCode,
  };
}

export async function findUpcomingSchedulingForClient(params: {
  organizationId: string;
  clientId: string;
  limit?: number;
}): Promise<UpcomingSchedulingItem[]> {
  const items = await getUpcomingSchedulingForClient({
    organizationId: params.organizationId,
    clientId: params.clientId,
    limit: params.limit ?? 10,
  });
  return items.map((item) => ({
    id: item.id,
    startTime: item.startTime,
    durationMinutes: item.durationMinutes,
    clientName: item.clientName,
    serviceName: item.serviceName,
  }));
}

async function resolveNatalieSchedulingSlot(input: NatalieBookInput) {
  const organizationId = input.organizationId;
  const clientName = input.clientName.trim();
  if (!clientName) {
    throw new SchedulingFacadeError("VALIDATION_FAILED", "שם לקוח נדרש");
  }

  const timeZone = (await getCalendarRulesForOrganization(organizationId)).timeZone;
  const startTime = resolveAppointmentDateTime({
    dayReference: input.dayReference,
    time: input.time,
    explicitStartTime: input.startTime,
    timeZone,
  });

  if (!startTime) {
    throw new SchedulingFacadeError(
      "bad_datetime",
      "לא הצלחתי להבין את מועד התור, אפשר לנסות שוב עם יום ושעה ברורים"
    );
  }

  let serviceId: string | null = null;
  let durationMinutes = input.durationMinutes;

  const serviceName = input.serviceName?.trim() ?? "";
  if (serviceName) {
    const service = await prisma.service.findFirst({
      where: {
        organizationId,
        isActive: true,
        name: { contains: serviceName, mode: "insensitive" },
      },
    });
    if (service) {
      serviceId = service.id;
      if (durationMinutes === undefined) {
        durationMinutes = service.durationMinutes;
      }
    }
  }

  if (durationMinutes === undefined) {
    durationMinutes = await resolveDurationMinutes({
      organizationId,
      serviceId,
      defaultDurationMinutes: 30,
    });
  }

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new SchedulingFacadeError("VALIDATION_FAILED", "משך התור חייב להיות מספר חיובי");
  }

  if (Number.isNaN(startTime.getTime())) {
    throw new SchedulingFacadeError("VALIDATION_FAILED", "זמן התור לא תקין");
  }

  if (startTime.getTime() < Date.now()) {
    throw new SchedulingFacadeError("VALIDATION_FAILED", "זמן התור חייב להיות בהווה או בעתיד");
  }

  return {
    organizationId,
    clientName,
    startTime,
    durationMinutes,
    serviceId,
    notes: input.notes?.trim() || null,
    timeZone,
  };
}

export async function bookAppointmentViaNatalie(input: NatalieBookInput): Promise<NatalieBookResult> {
  recordCalendarAudit({
    organizationId: input.organizationId,
    entityType: "natalie_calendar",
    entityId: input.userId,
    action: "natalie_appointment_create_requested",
    actor: { actorType: "AI", actorUserId: input.userId },
    sourceModule: "scheduling-facade",
    metadata: { source: "natalie", customerName: input.clientName },
  });
  let slot;
  try {
    slot = await resolveNatalieSchedulingSlot(input);
    const ambiguous = await resolveSchedulingCustomerMatches({
      organizationId: input.organizationId,
      name: slot.clientName,
      clientId: input.clientId,
      phone: input.clientPhone,
      email: input.clientEmail,
    });
    if (ambiguous.length > 1) {
      throw new SchedulingFacadeError(
        "multiple_clients",
        formatAmbiguousCustomerMessage(slot.clientName, ambiguous),
        { clients: ambiguous }
      );
    }
  } catch (err) {
    recordCalendarAudit({
      organizationId: input.organizationId,
      entityType: "natalie_calendar",
      entityId: input.userId,
      action: "natalie_calendar_action_failed",
      actor: { actorType: "AI", actorUserId: input.userId },
      sourceModule: "scheduling-facade",
      reason: err instanceof Error ? err.message : String(err),
      metadata: { action: "create", source: "natalie", customerName: input.clientName },
    });
    throw err;
  }

  const engineEnabled = await usesCalendarEngineScheduling(input.organizationId);
  const employeeId = input.employeeId?.trim() || null;
  if (employeeId && engineEnabled) {
    // Phase 1: מנוע היומן החדש עדיין לא מכיר עובדים — כמו במסלול ה-API הישיר
    throw new SchedulingFacadeError("VALIDATION_FAILED", "שיוך עובד לתור עדיין לא נתמך ביומן החדש");
  }

  if (employeeId) {
    // תור לעובד: הבדיקות הן מול היומן של העובד (שעות עבודה, חופשות,
    // כפילות מול תורים של אותו עובד בלבד) — לא מול יומן בעל העסק.
    const { validateEmployeeBooking } = await import("../employees/employeeService.js");
    const employeeCheck = await validateEmployeeBooking({
      organizationId: input.organizationId,
      employeeId,
      serviceId: slot.serviceId,
      startTime: slot.startTime,
      durationMinutes: slot.durationMinutes,
      timeZone: slot.timeZone,
    });
    if (!employeeCheck.ok) {
      if (employeeCheck.code === "time_conflict") {
        throw new AppointmentConflictError(employeeCheck.message);
      }
      throw new SchedulingFacadeError(
        employeeCheck.code === "outside_working_hours" ? "outside_working_hours" : "VALIDATION_FAILED",
        employeeCheck.message
      );
    }
    if (isInPast(slot.startTime, new Date())) {
      throw new SchedulingFacadeError("past", "זמן התור חייב להיות בהווה או בעתיד");
    }
  } else {
    let availability;
    if (engineEnabled) {
      availability = await checkSlotViaCalendarEngine(natalieEngineContext(input.organizationId, input.userId), {
        organizationId: slot.organizationId,
        startTime: slot.startTime,
        durationMinutes: slot.durationMinutes,
        serviceId: slot.serviceId,
      });
    } else {
      availability = await checkSlotAvailability({
        organizationId: slot.organizationId,
        startTime: slot.startTime,
        durationMinutes: slot.durationMinutes,
        serviceId: slot.serviceId,
      });
    }

    if (!availability.available) {
      if (availability.reason === "time_conflict") {
        throw new AppointmentConflictError();
      }
      throw new SchedulingFacadeError(
        availability.reason ?? "VALIDATION_FAILED",
        availability.reason === "past"
          ? "זמן התור חייב להיות בהווה או בעתיד"
          : availability.reason === "outside_working_hours"
            ? "השעה מחוץ לשעות הפעילות"
            : "לא ניתן לקבוע תור בזמן הזה"
      );
    }
  }

  let booked;
  try {
    booked = await scheduleNatalieAppointmentAtomic({
      organizationId: input.organizationId,
      userId: input.userId,
      slot: {
        organizationId: slot.organizationId,
        startTime: slot.startTime,
        durationMinutes: slot.durationMinutes,
        serviceId: slot.serviceId,
        timeZone: slot.timeZone,
      },
      customer: {
        clientName: slot.clientName,
        clientId: input.clientId,
        clientPhone: input.clientPhone,
        clientEmail: input.clientEmail,
        notes: slot.notes,
        address: input.address,
      },
      employeeId,
      engineEnabled,
    });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "multiple_clients"
    ) {
      throw new SchedulingFacadeError(
        "multiple_clients",
        err instanceof Error ? err.message : "נמצאו כמה לקוחות",
        (err as { details?: Record<string, unknown> }).details
      );
    }
    throw err;
  }

  if (!booked.engine) {
    void runAppointmentGoogleSync(booked.appointment.id, { reason: "create" }).catch((syncErr) => {
      console.error("Failed to sync appointment to Google Calendar:", syncErr);
    });
    recordCalendarAudit({
      organizationId: input.organizationId,
      entityType: "appointment",
      entityId: booked.appointment.id,
      action: "natalie_appointment_created",
      actor: { actorType: "AI", actorUserId: input.userId },
      sourceModule: "scheduling-facade",
      metadata: {
        appointmentId: booked.appointment.id,
        customerName: booked.appointment.client.name,
        clientCreated: booked.clientCreated,
        newStartTime: booked.appointment.startTime.toISOString(),
        durationMinutes: booked.appointment.durationMinutes,
      },
    });
    return { engine: false, appointment: booked.appointment };
  }

  const confirmation = booked.confirmation;
  const output = {
    engine: true as const,
    calendarEventId: booked.calendarEventId,
    workCaseId: booked.workCaseId,
    status: booked.status,
    startTime: booked.startTime,
    durationMinutes: booked.durationMinutes,
    clientId: booked.clientId,
    pendingApproval: confirmation.mode === "queued",
    decisionId: confirmation.mode === "queued" ? confirmation.decisionId : undefined,
    queueType: confirmation.mode === "queued" ? confirmation.queueType : undefined,
    message: formatBookMessage(confirmation),
  };
  recordCalendarAudit({
    organizationId: input.organizationId,
    entityType: "calendar_event",
    entityId: booked.calendarEventId,
    action: "natalie_appointment_created",
    actor: { actorType: "AI", actorUserId: input.userId },
    sourceModule: "scheduling-facade",
    metadata: {
      calendarEventId: booked.calendarEventId,
      decisionId: output.decisionId ?? null,
      clientCreated: booked.clientCreated,
      newStartTime: booked.startTime,
      durationMinutes: booked.durationMinutes,
    },
  });
  return output;
}

async function requireSchedulingItem(
  organizationId: string,
  schedulingItemId: string
): Promise<
  | { kind: "appointment"; appointment: AppointmentWithRelations }
  | {
      kind: "calendar_event";
      id: string;
      status: string;
      workCaseId: string;
      title: string | null;
    }
> {
  // Table-agnostic lookup: a scheduling item resolved via the unified read
  // repository may live in EITHER table, so try both and route execution by the
  // table it actually lives in (not by the engine flag). Org scope is always
  // enforced, preserving organization isolation.
  const appointment = await prisma.appointment.findFirst({
    where: { id: schedulingItemId, organizationId },
    include: {
      client: { select: { id: true, name: true, whatsappNumber: true, color: true } },
      service: { select: { id: true, name: true, color: true, durationMinutes: true } },
      employee: { select: { id: true, name: true, color: true, isActive: true } },
    },
  });
  if (appointment) {
    return { kind: "appointment", appointment };
  }

  const event = await prisma.calendarEvent.findFirst({
    where: { id: schedulingItemId, organizationId },
    select: {
      id: true,
      status: true,
      workCaseId: true,
      title: true,
    },
  });
  if (!event) {
    throw new SchedulingFacadeError("appointment_not_found", "התור לא נמצא");
  }
  return { kind: "calendar_event", ...event };
}

export async function cancelAppointmentViaNatalie(params: {
  organizationId: string;
  userId: string;
  schedulingItemId: string;
}): Promise<NatalieCancelResult> {
  recordCalendarAudit({
    organizationId: params.organizationId,
    entityType: "natalie_calendar",
    entityId: params.schedulingItemId,
    action: "natalie_appointment_cancel_requested",
    actor: { actorType: "AI", actorUserId: params.userId },
    sourceModule: "scheduling-facade",
    metadata: { source: "natalie", appointmentId: params.schedulingItemId },
  });
  let item;
  try {
    item = await requireSchedulingItem(params.organizationId, params.schedulingItemId);
  } catch (err) {
    recordCalendarAudit({
      organizationId: params.organizationId,
      entityType: "natalie_calendar",
      entityId: params.schedulingItemId,
      action: "natalie_calendar_action_failed",
      actor: { actorType: "AI", actorUserId: params.userId },
      sourceModule: "scheduling-facade",
      reason: err instanceof Error ? err.message : String(err),
      metadata: { action: "cancel", source: "natalie", appointmentId: params.schedulingItemId },
    });
    throw err;
  }

  if (item.kind === "appointment") {
    const appointment = await updateAppointmentForOrganization({
      organizationId: params.organizationId,
      appointmentId: item.appointment.id,
      status: "cancelled",
    });
    recordCalendarAudit({
      organizationId: params.organizationId,
      entityType: "appointment",
      entityId: appointment.id,
      action: "natalie_appointment_cancelled",
      actor: { actorType: "AI", actorUserId: params.userId },
      sourceModule: "scheduling-facade",
      metadata: { appointmentId: appointment.id },
    });
    return { engine: false, ok: true, appointment };
  }

  const ctx = natalieEngineContext(params.organizationId, params.userId);
  const cancelResult = await CalendarEngine.cancelEvent(ctx, item.id, {
    reason: "בקשת ביטול דרך נטלי",
    queueNonConfirmed: item.status === "draft" || item.status === "pending_readiness",
    nonConfirmedDecisionSource: "natalie_command",
    nonConfirmedReason: "בקשת ביטול דרך נטלי",
  });
  if (!cancelResult.ok) {
    throw mapEngineFailureToSchedulingError(cancelResult);
  }
  if (!cancelResult.data.decisionId) {
    throw new SchedulingFacadeError("INVALID_TRANSITION", "לא ניתן לבטל תור במצב הנוכחי");
  }
  const output = {
    engine: true as const,
    ok: true as const,
    pendingApproval: true as const,
    decisionId: cancelResult.data.decisionId,
    queueType: cancelResult.data.queueType ?? "cancel_appointment",
    message: "שלחתי בקשת ביטול לאישור — התור יבוטל רק אחרי שתאשר.",
  };
  recordCalendarAudit({
    organizationId: params.organizationId,
    entityType: "calendar_event",
    entityId: item.id,
    action: "natalie_appointment_cancelled",
    actor: { actorType: "AI", actorUserId: params.userId },
    sourceModule: "scheduling-facade",
    metadata: { calendarEventId: item.id, decisionId: output.decisionId, engineSource: "natalie_ai" },
  });
  return output;
}

export async function rescheduleAppointmentViaNatalie(params: {
  organizationId: string;
  userId: string;
  schedulingItemId: string;
  newDayReference?: string;
  newTime?: string;
  newStartTime?: string;
}): Promise<NatalieRescheduleResult> {
  recordCalendarAudit({
    organizationId: params.organizationId,
    entityType: "natalie_calendar",
    entityId: params.schedulingItemId,
    action: "natalie_appointment_reschedule_requested",
    actor: { actorType: "AI", actorUserId: params.userId },
    sourceModule: "scheduling-facade",
    metadata: { source: "natalie", appointmentId: params.schedulingItemId },
  });
  const item = await requireSchedulingItem(params.organizationId, params.schedulingItemId);

  const timeZone = (await getCalendarRulesForOrganization(params.organizationId)).timeZone;
  const startTime = resolveAppointmentDateTime({
    dayReference: params.newDayReference,
    time: params.newTime,
    explicitStartTime: params.newStartTime,
    timeZone,
  });

  if (!startTime) {
    throw new SchedulingFacadeError(
      "bad_datetime",
      "לא הצלחתי להבין את מועד התור החדש, אפשר לנסות שוב עם יום ושעה ברורים"
    );
  }

  if (item.kind === "appointment") {
    const appointment = await updateAppointmentForOrganization({
      organizationId: params.organizationId,
      appointmentId: item.appointment.id,
      startTime,
    });
    recordCalendarAudit({
      organizationId: params.organizationId,
      entityType: "appointment",
      entityId: appointment.id,
      action: "natalie_appointment_rescheduled",
      actor: { actorType: "AI", actorUserId: params.userId },
      sourceModule: "scheduling-facade",
      metadata: {
        appointmentId: appointment.id,
        newStartTime: appointment.startTime.toISOString(),
      },
    });
    return { engine: false, ok: true, appointment };
  }

  if (item.status !== "confirmed") {
    throw new SchedulingFacadeError(
      "INVALID_TRANSITION",
      "אפשר לדחות תור רק אחרי שהוא מאושר — התור עדיין ממתין לאישור"
    );
  }

  const existing = await prisma.calendarEvent.findFirst({
    where: { id: item.id, organizationId: params.organizationId },
    select: { endAt: true, startAt: true, serviceId: true, assignedUserId: true },
  });
  if (!existing) {
    throw new SchedulingFacadeError("appointment_not_found", "התור לא נמצא");
  }

  const durationMinutes = Math.max(
    1,
    Math.round((existing.endAt.getTime() - existing.startAt.getTime()) / 60_000)
  );

  const engineEnabled = await usesCalendarEngineScheduling(params.organizationId);
  let availability;
  if (engineEnabled) {
    availability = await checkSlotViaCalendarEngine(natalieEngineContext(params.organizationId, params.userId), {
      organizationId: params.organizationId,
      startTime,
      durationMinutes,
      serviceId: existing.serviceId,
      assignedUserId: existing.assignedUserId,
      excludeCalendarEventId: item.id,
    });
  } else {
    availability = await checkSlotAvailability({
      organizationId: params.organizationId,
      startTime,
      durationMinutes,
      serviceId: existing.serviceId,
      excludeCalendarEventId: item.id,
      assignedUserId: existing.assignedUserId,
    });
  }

  if (!availability.available) {
    if (availability.reason === "time_conflict") {
      throw new AppointmentConflictError("קיים תור אחר בזמן הזה");
    }
    throw new SchedulingFacadeError(
      availability.reason ?? "VALIDATION_FAILED",
      "לא ניתן לדחות לזמן הזה"
    );
  }

  const endAt = appointmentEnd(startTime, durationMinutes);
  const moveResult = await CalendarEngine.moveEvent(
    natalieEngineContext(params.organizationId, params.userId),
    item.id,
    { startAt: startTime, endAt }
  );
  if (!moveResult.ok) {
    throw mapEngineFailureToSchedulingError(moveResult);
  }
  if (!moveResult.data.decisionId) {
    throw new SchedulingFacadeError("INVALID_TRANSITION", "לא ניתן לדחות תור במצב הנוכחי");
  }

  const output = {
    engine: true as const,
    ok: true as const,
    pendingApproval: true as const,
    decisionId: moveResult.data.decisionId,
    queueType: moveResult.data.queueType ?? "reschedule_appointment",
    message: "שלחתי בקשת דחייה לאישור — המועד החדש ייקבע רק אחרי שתאשר.",
  };
  recordCalendarAudit({
    organizationId: params.organizationId,
    entityType: "calendar_event",
    entityId: item.id,
    action: "natalie_appointment_rescheduled",
    actor: { actorType: "AI", actorUserId: params.userId },
    sourceModule: "scheduling-facade",
    metadata: {
      calendarEventId: item.id,
      decisionId: output.decisionId,
      newStartTime: startTime.toISOString(),
      durationMinutes,
      engineSource: "natalie_ai",
    },
  });
  return output;
}

export type UnifiedAvailabilityParams = Parameters<typeof checkSlotAvailability>[0] & {
  userId?: string;
};
export type UnifiedSlotsParams = Parameters<typeof findAvailableSlotsForOrganization>[0];

export async function checkUnifiedSlotAvailability(
  params: UnifiedAvailabilityParams
): Promise<CheckSlotAvailabilityResult> {
  if (await usesCalendarEngineScheduling(params.organizationId)) {
    const rules = await getCalendarRulesForOrganization(params.organizationId);
    const now = params.now ?? new Date();
    let startTime = params.startTime ?? null;
    if (!startTime) {
      startTime = resolveSlotTime({
        dayReference: params.dayReference,
        time: params.time,
        timeZone: rules.timeZone,
        now,
      });
    }
    if (!startTime || Number.isNaN(startTime.getTime())) {
      const durationMinutes = await resolveDurationMinutes({
        organizationId: params.organizationId,
        durationMinutes: params.durationMinutes,
        serviceId: params.serviceId,
        defaultDurationMinutes: rules.defaultDurationMinutes,
      });
      return {
        available: false,
        reason: "bad_datetime",
        startTime: "",
        endTime: "",
        durationMinutes,
        timeZone: rules.timeZone,
      };
    }

    const durationMinutes = await resolveDurationMinutes({
      organizationId: params.organizationId,
      durationMinutes: params.durationMinutes,
      serviceId: params.serviceId,
      defaultDurationMinutes: rules.defaultDurationMinutes,
    });

    const ctx = params.userId
      ? buildApiEngineContext({
          organizationId: params.organizationId,
          userId: params.userId,
          sourceRoute: "availability-check",
        })
      : {
          organizationId: params.organizationId,
          source: "api" as const,
          actor: { actorType: "system" as const },
          sourceModule: "scheduling-facade",
        };

    return checkSlotViaCalendarEngine(ctx, {
      organizationId: params.organizationId,
      startTime,
      durationMinutes,
      serviceId: params.serviceId,
      assignedUserId: params.assignedUserId,
      excludeCalendarEventId: params.excludeCalendarEventId,
      excludeAppointmentId: params.excludeAppointmentId,
    });
  }

  return checkSlotAvailability(params);
}

export async function findUnifiedAvailableSlots(
  params: UnifiedSlotsParams
): Promise<FindAvailableSlotsResult> {
  return findAvailableSlotsForOrganization(params);
}
