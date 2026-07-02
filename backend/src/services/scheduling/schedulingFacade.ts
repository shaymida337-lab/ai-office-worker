import { prisma } from "../../lib/prisma.js";
import {
  AppointmentConflictError,
  createAppointmentForOrganization,
  findClientByNameOrPhone,
  findUpcomingAppointmentsForClient,
  resolveAppointmentDateTime,
  updateAppointmentForOrganization,
  type AppointmentWithRelations,
} from "../appointmentService.js";
import { appointmentEnd } from "../calendar/engine.js";
import {
  checkSlotAvailability,
  findAvailableSlotsForOrganization,
  resolveDurationMinutes,
} from "../calendar/availability.js";
import type {
  CheckSlotAvailabilityResult,
  FindAvailableSlotsResult,
} from "../calendar/types.js";
import { resolveCalendarEngineFlags } from "../calendar/calendarEngineFlags.js";
import {
  createDraftCalendarEvent,
  requestCalendarEventCancel,
  requestCalendarEventReschedule,
  submitCalendarEventForConfirmation,
  type SubmitConfirmationResult,
} from "../calendar/calendarEventService.js";
import { createPendingDecision } from "../calendar/decisionQueueService.js";
import type { CalendarEventActor } from "../calendar/calendarEventMutations.js";
import { CalendarEngineServiceError } from "../calendar/serviceErrors.js";
import { getCalendarRulesForOrganization } from "../calendar/rules.js";
import { recordCalendarAudit } from "../calendar/calendarAudit.js";

export type UpcomingSchedulingItem = {
  id: string;
  startTime: Date;
  durationMinutes: number;
  clientName: string;
  serviceName?: string;
};

export type NatalieBookInput = {
  organizationId: string;
  userId: string;
  clientName: string;
  dayReference?: string;
  time?: string;
  startTime?: string;
  durationMinutes?: number;
  serviceName?: string;
  notes?: string;
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

function natalieActor(userId: string): CalendarEventActor {
  return { actorType: "user", actorUserId: userId };
}

function formatBookMessage(result: SubmitConfirmationResult): string {
  if (result.mode === "queued") {
    return "שלחתי את הבקשה לאישור — התור ממתין לאישורך לפני שייקבע.";
  }
  return "התור אושר ונקבע.";
}

export async function findUpcomingSchedulingForClient(params: {
  organizationId: string;
  clientId: string;
  limit?: number;
}): Promise<UpcomingSchedulingItem[]> {
  if (!(await usesCalendarEngineScheduling(params.organizationId))) {
    const appointments = await findUpcomingAppointmentsForClient(params);
    return appointments.map((appointment) => ({
      id: appointment.id,
      startTime: appointment.startTime,
      durationMinutes: appointment.durationMinutes,
      clientName: appointment.client.name,
      serviceName: appointment.service?.name ?? undefined,
    }));
  }

  const events = await prisma.calendarEvent.findMany({
    where: {
      organizationId: params.organizationId,
      clientId: params.clientId,
      status: { in: ["pending_readiness", "confirmed"] },
      startAt: { gte: new Date() },
    },
    include: {
      client: { select: { name: true } },
      service: { select: { name: true, durationMinutes: true } },
    },
    orderBy: { startAt: "asc" },
    take: params.limit ?? 10,
  });

  return events.map((event) => ({
    id: event.id,
    startTime: event.startAt,
    durationMinutes: Math.max(
      1,
      Math.round((event.endAt.getTime() - event.startAt.getTime()) / 60_000) ||
        event.service?.durationMinutes ||
        30
    ),
    clientName: event.client?.name ?? "לקוח",
    serviceName: event.service?.name ?? undefined,
  }));
}

async function resolveNatalieBookingContext(input: NatalieBookInput) {
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

  const clients = await findClientByNameOrPhone({ organizationId, query: clientName });
  if (clients.length === 0) {
    throw new SchedulingFacadeError("client_not_found", "לא נמצא לקוח בשם הזה");
  }
  if (clients.length > 1) {
    throw new SchedulingFacadeError("multiple_clients", "נמצאו כמה לקוחות, צריך לדייק", { clients });
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
    clientId: clients[0].id,
    clientName: clients[0].name,
    startTime,
    durationMinutes,
    serviceId,
    notes: input.notes?.trim() || null,
    timeZone,
  };
}

export class SchedulingFacadeError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SchedulingFacadeError";
    this.code = code;
    this.details = details;
  }
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
  let ctx;
  try {
    ctx = await resolveNatalieBookingContext(input);
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

  const availability = await checkSlotAvailability({
    organizationId: ctx.organizationId,
    startTime: ctx.startTime,
    durationMinutes: ctx.durationMinutes,
    serviceId: ctx.serviceId,
  });

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

  if (!(await usesCalendarEngineScheduling(input.organizationId))) {
    const appointment = await createAppointmentForOrganization({
      organizationId: ctx.organizationId,
      clientId: ctx.clientId,
      serviceId: ctx.serviceId,
      startTime: ctx.startTime,
      durationMinutes: ctx.durationMinutes,
      source: "natalie",
      notes: ctx.notes,
    });
    recordCalendarAudit({
      organizationId: input.organizationId,
      entityType: "appointment",
      entityId: appointment.id,
      action: "natalie_appointment_created",
      actor: { actorType: "AI", actorUserId: input.userId },
      sourceModule: "scheduling-facade",
      metadata: {
        appointmentId: appointment.id,
        customerName: appointment.client.name,
        newStartTime: appointment.startTime.toISOString(),
        durationMinutes: appointment.durationMinutes,
      },
    });
    return { engine: false, appointment };
  }

  const endAt = appointmentEnd(ctx.startTime, ctx.durationMinutes);
  const actor = natalieActor(input.userId);

  const event = await createDraftCalendarEvent(
    ctx.organizationId,
    {
      title: ctx.clientName,
      startAt: ctx.startTime,
      endAt,
      timezone: ctx.timeZone,
      clientId: ctx.clientId,
      serviceId: ctx.serviceId,
      source: "ai_chat",
      createdByUserId: input.userId,
      workCaseTitle: `תיק יומן — ${ctx.clientName}`,
    },
    actor
  );

  const confirmation = await submitCalendarEventForConfirmation(ctx.organizationId, event.id, actor);

  const output = {
    engine: true as const,
    calendarEventId: event.id,
    workCaseId: event.workCaseId,
    status: confirmation.mode === "confirmed" ? confirmation.event.status : "pending_readiness",
    startTime: ctx.startTime.toISOString(),
    durationMinutes: ctx.durationMinutes,
    clientId: ctx.clientId,
    pendingApproval: confirmation.mode === "queued",
    decisionId: confirmation.mode === "queued" ? confirmation.decisionId : undefined,
    queueType: confirmation.mode === "queued" ? confirmation.queueType : undefined,
    message: formatBookMessage(confirmation),
  };
  recordCalendarAudit({
    organizationId: input.organizationId,
    entityType: "calendar_event",
    entityId: event.id,
    action: "natalie_appointment_created",
    actor: { actorType: "AI", actorUserId: input.userId },
    sourceModule: "scheduling-facade",
    metadata: {
      calendarEventId: event.id,
      decisionId: output.decisionId ?? null,
      newStartTime: ctx.startTime.toISOString(),
      durationMinutes: ctx.durationMinutes,
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
  if (!(await usesCalendarEngineScheduling(organizationId))) {
    const appointment = await prisma.appointment.findFirst({
      where: { id: schedulingItemId, organizationId },
      include: {
        client: { select: { id: true, name: true, whatsappNumber: true, color: true } },
        service: { select: { id: true, name: true, color: true, durationMinutes: true } },
      },
    });
    if (!appointment) {
      throw new SchedulingFacadeError("appointment_not_found", "התור לא נמצא");
    }
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

async function assertNoPendingCancelOrReschedule(organizationId: string, calendarEventId: string) {
  const pending = await prisma.ownerDecisionQueueItem.findFirst({
    where: {
      organizationId,
      calendarEventId,
      status: "pending",
      type: { in: ["cancel_appointment", "reschedule_appointment"] },
    },
    select: { id: true },
  });
  if (pending) {
    throw new SchedulingFacadeError("VALIDATION_FAILED", "כבר קיימת בקשה ממתינה לתור הזה");
  }
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

  const actor = natalieActor(params.userId);

  if (item.status === "confirmed") {
    const result = await requestCalendarEventCancel(params.organizationId, item.id, actor);
    const output = {
      engine: true as const,
      ok: true as const,
      pendingApproval: true as const,
      decisionId: result.decisionId,
      queueType: result.queueType,
      message: "שלחתי בקשת ביטול לאישור — התור יבוטל רק אחרי שתאשר.",
    };
    recordCalendarAudit({
      organizationId: params.organizationId,
      entityType: "calendar_event",
      entityId: item.id,
      action: "natalie_appointment_cancelled",
      actor: { actorType: "AI", actorUserId: params.userId },
      sourceModule: "scheduling-facade",
      metadata: { calendarEventId: item.id, decisionId: output.decisionId },
    });
    return output;
  }

  if (item.status === "pending_readiness" || item.status === "draft") {
    await assertNoPendingCancelOrReschedule(params.organizationId, item.id);
    const decision = await createPendingDecision({
      organizationId: params.organizationId,
      workCaseId: item.workCaseId,
      calendarEventId: item.id,
      type: "cancel_appointment",
      title: item.title ?? "ביטול תור",
      reason: "בקשת ביטול דרך נטלי",
      preparedPayloadJson: { targetStatus: "cancelled" },
      source: "natalie_command",
      actor,
    });
    const output = {
      engine: true as const,
      ok: true as const,
      pendingApproval: true as const,
      decisionId: decision.id,
      queueType: "cancel_appointment",
      message: "שלחתי בקשת ביטול לאישור — התור יבוטל רק אחרי שתאשר.",
    };
    recordCalendarAudit({
      organizationId: params.organizationId,
      entityType: "calendar_event",
      entityId: item.id,
      action: "natalie_appointment_cancelled",
      actor: { actorType: "AI", actorUserId: params.userId },
      sourceModule: "scheduling-facade",
      metadata: { calendarEventId: item.id, decisionId: output.decisionId },
    });
    return output;
  }

  throw new SchedulingFacadeError("INVALID_TRANSITION", "לא ניתן לבטל תור במצב הנוכחי");
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

  const availability = await checkSlotAvailability({
    organizationId: params.organizationId,
    startTime,
    durationMinutes,
    serviceId: existing.serviceId,
    excludeCalendarEventId: item.id,
    assignedUserId: existing.assignedUserId,
  });

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
  const actor = natalieActor(params.userId);
  const result = await requestCalendarEventReschedule(
    params.organizationId,
    item.id,
    { startAt: startTime, endAt },
    actor
  );

  const output = {
    engine: true as const,
    ok: true as const,
    pendingApproval: true as const,
    decisionId: result.decisionId,
    queueType: result.queueType,
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
    },
  });
  return output;
}

export type UnifiedAvailabilityParams = Parameters<typeof checkSlotAvailability>[0];
export type UnifiedSlotsParams = Parameters<typeof findAvailableSlotsForOrganization>[0];

export async function checkUnifiedSlotAvailability(
  params: UnifiedAvailabilityParams
): Promise<CheckSlotAvailabilityResult> {
  return checkSlotAvailability(params);
}

export async function findUnifiedAvailableSlots(
  params: UnifiedSlotsParams
): Promise<FindAvailableSlotsResult> {
  return findAvailableSlotsForOrganization(params);
}
