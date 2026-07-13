import { prisma } from "../../lib/prisma.js";
import {
  APPOINTMENT_INCLUDE,
  AppointmentConflictError,
  type AppointmentWithRelations,
} from "../appointmentService.js";
import { appointmentEnd } from "./engine.js";
import { CalendarEngine } from "./calendarEngineFacade.js";
import { buildApiEngineContext, throwSchedulingFacadeFromEngineFailure } from "./calendarEngineRouting.js";
import type { CalendarEngineFailure } from "./calendarEngineTypes.js";
import type { CalendarEventWithRelations } from "./calendarEventService.js";

function mapCalendarEventToAppointment(
  event: CalendarEventWithRelations,
  params: { durationMinutes: number; notes?: string | null }
): AppointmentWithRelations {
  const durationMinutes = Math.max(
    1,
    Math.round((event.endAt.getTime() - event.startAt.getTime()) / 60_000) || params.durationMinutes
  );

  return {
    id: event.id,
    organizationId: event.organizationId,
    clientId: event.clientId ?? "",
    serviceId: event.serviceId,
    startTime: event.startAt,
    durationMinutes,
    status: event.status === "cancelled" ? "cancelled" : event.status === "confirmed" ? "confirmed" : "pending",
    source: event.source,
    // מנוע היומן עדיין לא מכיר עובדים (Calendar Phase 1) — תמיד בעל העסק
    employeeId: null,
    employee: null,
    notes: params.notes?.trim() || null,
    googleEventId: null,
    googleSyncStatus: "disabled",
    lastGoogleSyncError: null,
    lastGoogleSyncAt: null,
    googleSyncAttemptCount: 0,
    nextGoogleSyncRetryAt: null,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    client: event.client
      ? {
          id: event.client.id,
          name: event.client.name,
          whatsappNumber: null,
          color: null,
        }
      : { id: "", name: "לקוח", whatsappNumber: null, color: null },
    service: event.service
      ? {
          id: event.service.id,
          name: event.service.name,
          color: null,
          durationMinutes: event.service.durationMinutes,
        }
      : null,
  };
}

function throwBridgeFailure(failure: CalendarEngineFailure): never {
  if (failure.code === "TIME_CONFLICT") {
    throw new AppointmentConflictError();
  }
  throwSchedulingFacadeFromEngineFailure(failure);
}

export async function createAppointmentViaCalendarEngine(params: {
  organizationId: string;
  userId: string;
  clientId: string;
  serviceId?: string | null;
  startTime: Date;
  durationMinutes: number;
  status?: string;
  notes?: string | null;
  source?: string;
}): Promise<AppointmentWithRelations> {
  const client = await prisma.client.findFirst({
    where: { id: params.clientId, organizationId: params.organizationId, isActive: true },
  });
  if (!client) {
    throw new Error("Client not found");
  }

  const ctx = buildApiEngineContext({
    organizationId: params.organizationId,
    userId: params.userId,
    sourceRoute: "POST /api/appointments",
  });
  const endAt = appointmentEnd(params.startTime, params.durationMinutes);
  const result = await CalendarEngine.createEvent(ctx, {
    title: client.name,
    startAt: params.startTime,
    endAt,
    clientId: params.clientId,
    serviceId: params.serviceId ?? null,
    source: params.source === "natalie" ? "ai_chat" : "manual",
    createdByUserId: params.userId,
    workCaseTitle: `תיק יומן — ${client.name}`,
  });

  if (!result.ok) {
    throwBridgeFailure(result);
  }

  return mapCalendarEventToAppointment(result.data, {
    durationMinutes: params.durationMinutes,
    notes: params.notes,
  });
}

export async function updateAppointmentViaCalendarEngine(params: {
  organizationId: string;
  userId: string;
  appointmentId: string;
  startTime?: Date;
  durationMinutes?: number;
  status?: string;
  notes?: string | null;
  serviceId?: string | null;
}): Promise<AppointmentWithRelations> {
  const existing = await prisma.calendarEvent.findFirst({
    where: { id: params.appointmentId, organizationId: params.organizationId },
    include: {
      client: { select: { id: true, name: true } },
      service: { select: { id: true, name: true, durationMinutes: true } },
    },
  });
  if (!existing) {
    throw new Error("Appointment not found");
  }

  const ctx = buildApiEngineContext({
    organizationId: params.organizationId,
    userId: params.userId,
    sourceRoute: "PATCH /api/appointments",
  });

  if (params.status === "cancelled") {
    const cancelResult = await CalendarEngine.cancelEvent(ctx, existing.id);
    if (!cancelResult.ok) {
      throwBridgeFailure(cancelResult);
    }
    const refreshed = await prisma.calendarEvent.findFirst({
      where: { id: existing.id, organizationId: params.organizationId },
      include: {
        client: { select: { id: true, name: true } },
        service: { select: { id: true, name: true, durationMinutes: true } },
      },
    });
    if (!refreshed) {
      throw new Error("Appointment not found");
    }
    return mapCalendarEventToAppointment(refreshed as CalendarEventWithRelations, {
      durationMinutes: params.durationMinutes ?? Math.round((existing.endAt.getTime() - existing.startAt.getTime()) / 60_000),
      notes: params.notes ?? null,
    });
  }

  const nextStart = params.startTime ?? existing.startAt;
  const nextDuration =
    params.durationMinutes ??
    Math.max(1, Math.round((existing.endAt.getTime() - existing.startAt.getTime()) / 60_000));
  const nextEnd = appointmentEnd(nextStart, nextDuration);
  const timeChanged =
    params.startTime !== undefined ||
    params.durationMinutes !== undefined ||
    nextStart.getTime() !== existing.startAt.getTime() ||
    nextEnd.getTime() !== existing.endAt.getTime();

  let event = existing as CalendarEventWithRelations;

  if (timeChanged) {
    const moveResult = await CalendarEngine.moveEvent(ctx, existing.id, {
      startAt: nextStart,
      endAt: nextEnd,
    });
    if (!moveResult.ok) {
      throwBridgeFailure(moveResult);
    }
    event = moveResult.data;
  }

  const patch: Record<string, unknown> = {};
  if (params.serviceId !== undefined) patch.serviceId = params.serviceId;
  if (Object.keys(patch).length > 0) {
    const updateResult = await CalendarEngine.updateEvent(ctx, existing.id, patch);
    if (!updateResult.ok) {
      throwBridgeFailure(updateResult);
    }
    event = updateResult.data;
  }

  return mapCalendarEventToAppointment(event, {
    durationMinutes: nextDuration,
    notes: params.notes,
  });
}

export async function deleteAppointmentViaCalendarEngine(params: {
  organizationId: string;
  userId: string;
  appointmentId: string;
}): Promise<{ ok: true }> {
  const ctx = buildApiEngineContext({
    organizationId: params.organizationId,
    userId: params.userId,
    sourceRoute: "DELETE /api/appointments",
  });
  const result = await CalendarEngine.deleteEvent(ctx, params.appointmentId);
  if (!result.ok) {
    throwBridgeFailure(result);
  }
  return { ok: true };
}

export async function checkAppointmentConflictViaCalendarEngine(params: {
  organizationId: string;
  userId: string;
  startTime: Date;
  durationMinutes: number;
  excludeAppointmentId?: string;
}): Promise<{ hasConflict: boolean; conflictingAppointment?: { id: string; startTime: Date; durationMinutes: number; status: string; client: { name: string } } }> {
  const ctx = buildApiEngineContext({
    organizationId: params.organizationId,
    userId: params.userId,
    sourceRoute: "appointment conflict check",
  });
  const endAt = appointmentEnd(params.startTime, params.durationMinutes);
  const result = await CalendarEngine.detectConflicts(
    ctx,
    { startAt: params.startTime, endAt, clientId: null, assignedUserId: null, serviceId: null },
    { excludeAppointmentId: params.excludeAppointmentId, excludeCalendarEventId: params.excludeAppointmentId }
  );
  if (!result.ok) {
    throwBridgeFailure(result);
  }
  if (!result.data.hasConflict) {
    return { hasConflict: false };
  }
  const first = result.data.conflicts[0];
  return {
    hasConflict: true,
    conflictingAppointment: {
      id: first?.conflictId ?? "unknown",
      startTime: new Date(first?.startTime ?? params.startTime.toISOString()),
      durationMinutes: params.durationMinutes,
      status: "confirmed",
      client: { name: first?.clientName ?? "לקוח" },
    },
  };
}
