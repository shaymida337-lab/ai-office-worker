import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { searchSchedulingCustomers } from "./scheduling/schedulingCustomer.js";
import { runAppointmentGoogleSync } from "./appointmentGoogleSync.js";
import { resolveCalendarEngineFlags } from "./calendar/calendarEngineFlags.js";
import {
  checkAppointmentConflictViaCalendarEngine,
  createAppointmentViaCalendarEngine,
  deleteAppointmentViaCalendarEngine,
  updateAppointmentViaCalendarEngine,
} from "./calendar/calendarEngineAppointmentBridge.js";
import {
  checkUnifiedSchedulingConflictByDuration,
} from "./calendar/schedulingConflict.js";
import { withOrganizationSchedulingLock } from "./calendar/schedulingLock.js";

export { resolveAppointmentDateTime } from "./calendar/datetime.js";

export const APPOINTMENT_INCLUDE = {
  client: { select: { id: true, name: true, whatsappNumber: true, color: true } },
  service: { select: { id: true, name: true, color: true, durationMinutes: true } },
} as const;

export type AppointmentWithRelations = Prisma.AppointmentGetPayload<{
  include: typeof APPOINTMENT_INCLUDE;
}>;

export class AppointmentConflictError extends Error {
  readonly code = "time_conflict" as const;

  constructor(message = "השעה הזו כבר תפוסה, אפשר לבחור זמן אחר") {
    super(message);
    this.name = "AppointmentConflictError";
  }
}

type ConflictAppointment = {
  id: string;
  startTime: Date;
  durationMinutes: number;
  status: string;
  client: { name: string };
};

export async function checkAppointmentConflict(params: {
  organizationId: string;
  startTime: Date;
  durationMinutes: number;
  excludeAppointmentId?: string;
  userId?: string;
}): Promise<{ hasConflict: boolean; conflictingAppointment?: ConflictAppointment }> {
  const flags = await resolveCalendarEngineFlags(params.organizationId);
  if (flags.writeEnabled && params.userId) {
    return checkAppointmentConflictViaCalendarEngine({
      organizationId: params.organizationId,
      userId: params.userId,
      startTime: params.startTime,
      durationMinutes: params.durationMinutes,
      excludeAppointmentId: params.excludeAppointmentId,
    });
  }

  const result = await checkUnifiedSchedulingConflictByDuration({
    organizationId: params.organizationId,
    startTime: params.startTime,
    durationMinutes: params.durationMinutes,
    excludeAppointmentId: params.excludeAppointmentId,
  });

  if (result.hasConflict && result.conflict) {
    const block = result.conflict;
    return {
      hasConflict: true,
      conflictingAppointment: {
        id: block.id,
        startTime: block.startTime,
        durationMinutes: block.durationMinutes ?? 60,
        status: "confirmed",
        client: { name: block.clientName ?? "לקוח" },
      },
    };
  }

  return { hasConflict: false };
}

export async function findClientByNameOrPhone(params: {
  organizationId: string;
  query: string;
}): Promise<Array<{ id: string; name: string; whatsappNumber: string | null }>> {
  const matches = await searchSchedulingCustomers(params);
  return matches.map((match) => ({
    id: match.id,
    name: match.name,
    whatsappNumber: match.whatsappNumber,
  }));
}

export async function findUpcomingAppointmentsForClient(params: {
  organizationId: string;
  clientId: string;
  limit?: number;
}): Promise<AppointmentWithRelations[]> {
  return prisma.appointment.findMany({
    where: {
      organizationId: params.organizationId,
      clientId: params.clientId,
      status: { not: "cancelled" },
      startTime: { gte: new Date() },
    },
    include: APPOINTMENT_INCLUDE,
    orderBy: { startTime: "asc" },
    take: params.limit ?? 10,
  });
}

export async function createAppointmentForOrganization(params: {
  organizationId: string;
  userId?: string;
  clientId: string;
  serviceId?: string | null;
  startTime: Date;
  durationMinutes: number;
  status?: string;
  notes?: string | null;
  source?: string;
}): Promise<AppointmentWithRelations> {
  if (!Number.isFinite(params.durationMinutes) || params.durationMinutes <= 0) {
    throw new Error("durationMinutes must be a positive number");
  }

  const flags = await resolveCalendarEngineFlags(params.organizationId);
  if (flags.writeEnabled) {
    if (!params.userId) {
      throw new Error("userId is required when calendar engine write is enabled");
    }
    return createAppointmentViaCalendarEngine({
      organizationId: params.organizationId,
      userId: params.userId,
      clientId: params.clientId,
      serviceId: params.serviceId,
      startTime: params.startTime,
      durationMinutes: params.durationMinutes,
      status: params.status,
      notes: params.notes,
      source: params.source,
    });
  }

  const appointment = await withOrganizationSchedulingLock(params.organizationId, async (tx) => {
    const client = await tx.client.findFirst({
      where: {
        id: params.clientId,
        organizationId: params.organizationId,
        isActive: true,
      },
    });
    if (!client) {
      throw new Error("Client not found");
    }

    const effectiveStatus = params.status ?? "pending";
    if (effectiveStatus !== "cancelled") {
      const conflict = await checkAppointmentConflict({
        organizationId: params.organizationId,
        startTime: params.startTime,
        durationMinutes: params.durationMinutes,
      });
      if (conflict.hasConflict) {
        throw new AppointmentConflictError();
      }
    }

    return tx.appointment.create({
      data: {
        organizationId: params.organizationId,
        clientId: params.clientId,
        serviceId: params.serviceId ?? null,
        startTime: params.startTime,
        durationMinutes: params.durationMinutes,
        status: params.status ?? "pending",
        source: params.source ?? "manual",
        notes: params.notes?.trim() || null,
      },
      include: APPOINTMENT_INCLUDE,
    });
  });

  void runAppointmentGoogleSync(appointment.id, { reason: "create" }).catch((syncErr) => {
    console.error("Failed to sync appointment to Google Calendar:", syncErr);
  });
  return appointment;
}

export async function updateAppointmentForOrganization(params: {
  organizationId: string;
  userId?: string;
  appointmentId: string;
  startTime?: Date;
  durationMinutes?: number;
  status?: string;
  notes?: string | null;
  serviceId?: string | null;
}): Promise<AppointmentWithRelations> {
  const flags = await resolveCalendarEngineFlags(params.organizationId);
  if (flags.writeEnabled) {
    if (!params.userId) {
      throw new Error("userId is required when calendar engine write is enabled");
    }
    return updateAppointmentViaCalendarEngine({
      organizationId: params.organizationId,
      userId: params.userId,
      appointmentId: params.appointmentId,
      startTime: params.startTime,
      durationMinutes: params.durationMinutes,
      status: params.status,
      notes: params.notes,
      serviceId: params.serviceId,
    });
  }

  const appointment = await withOrganizationSchedulingLock(params.organizationId, async (tx) => {
    const existing = await tx.appointment.findFirst({
      where: { id: params.appointmentId, organizationId: params.organizationId },
    });
    if (!existing) {
      throw new Error("Appointment not found");
    }

    const effectiveStartTime = params.startTime ?? existing.startTime;
    const effectiveDuration = params.durationMinutes ?? existing.durationMinutes;
    const effectiveStatus = params.status ?? existing.status;
    const timeChanged =
      params.startTime !== undefined || params.durationMinutes !== undefined;

    if (effectiveStatus !== "cancelled" && timeChanged) {
      const conflict = await checkAppointmentConflict({
        organizationId: params.organizationId,
        startTime: effectiveStartTime,
        durationMinutes: effectiveDuration,
        excludeAppointmentId: params.appointmentId,
      });
      if (conflict.hasConflict) {
        throw new AppointmentConflictError();
      }
    }

    const data: Prisma.AppointmentUpdateInput = {};
    if (params.startTime !== undefined) data.startTime = params.startTime;
    if (params.durationMinutes !== undefined) data.durationMinutes = params.durationMinutes;
    if (params.status !== undefined) data.status = params.status;
    if (params.notes !== undefined) data.notes = params.notes?.trim() || null;
    if (params.serviceId !== undefined) {
      if (params.serviceId) {
        data.service = { connect: { id: params.serviceId } };
      } else {
        data.service = { disconnect: true };
      }
    }

    return tx.appointment.update({
      where: { id: existing.id },
      data,
      include: APPOINTMENT_INCLUDE,
    });
  });

  void runAppointmentGoogleSync(appointment.id, {
    reason: appointment.status === "cancelled" ? "cancel" : "update",
  }).catch((syncErr) => {
    console.error("Failed to sync appointment update to Google Calendar:", syncErr);
  });
  return appointment;
}

export async function deleteAppointmentForOrganization(
  organizationId: string,
  appointmentId: string,
  userId?: string
): Promise<{ ok: true }> {
  const flags = await resolveCalendarEngineFlags(organizationId);
  if (flags.writeEnabled) {
    if (!userId) {
      throw new Error("userId is required when calendar engine write is enabled");
    }
    return deleteAppointmentViaCalendarEngine({
      organizationId,
      userId,
      appointmentId,
    });
  }

  const existing = await withOrganizationSchedulingLock(organizationId, async (tx) => {
    const row = await tx.appointment.findFirst({
      where: { id: appointmentId, organizationId },
    });
    if (!row) {
      throw new Error("Appointment not found");
    }
    await tx.appointment.delete({ where: { id: appointmentId } });
    return row;
  });

  return { ok: true };
}
