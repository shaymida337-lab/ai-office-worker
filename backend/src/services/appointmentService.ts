import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  createGoogleCalendarEventForAppointment,
  deleteGoogleCalendarEventForAppointment,
  updateGoogleCalendarEventForAppointment,
} from "./google.js";
import { loadAppointmentBusyBlocks } from "./calendar/blocks.js";
import { appointmentEnd, checkConflict } from "./calendar/engine.js";

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
}): Promise<{ hasConflict: boolean; conflictingAppointment?: ConflictAppointment }> {
  const candidate = {
    start: params.startTime,
    end: appointmentEnd(params.startTime, params.durationMinutes),
  };

  const busyBlocks = await loadAppointmentBusyBlocks(params.organizationId, candidate, {
    excludeAppointmentId: params.excludeAppointmentId,
  });

  const result = checkConflict(candidate, busyBlocks, {
    excludeId: params.excludeAppointmentId,
    allowBackToBack: true,
  });

  if (!result.available && result.conflict) {
    const block = result.conflict;
    return {
      hasConflict: true,
      conflictingAppointment: {
        id: block.id,
        startTime: block.start,
        durationMinutes: block.durationMinutes ?? Math.round((block.end.getTime() - block.start.getTime()) / 60_000),
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
  const query = params.query.trim();
  if (!query) return [];

  return prisma.client.findMany({
    where: {
      organizationId: params.organizationId,
      isActive: true,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { whatsappNumber: { contains: query } },
      ],
    },
    select: { id: true, name: true, whatsappNumber: true },
    take: 5,
    orderBy: { name: "asc" },
  });
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

  const client = await prisma.client.findFirst({
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

  const appointment = await prisma.appointment.create({
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

  try {
    const googleEventId = await createGoogleCalendarEventForAppointment(appointment);
    if (googleEventId) {
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { googleEventId },
      });
      appointment.googleEventId = googleEventId;
    }
  } catch (syncErr) {
    console.error("Failed to sync appointment to Google Calendar:", syncErr);
  }

  return appointment;
}

export async function updateAppointmentForOrganization(params: {
  organizationId: string;
  appointmentId: string;
  startTime?: Date;
  durationMinutes?: number;
  status?: string;
  notes?: string | null;
  serviceId?: string | null;
}): Promise<AppointmentWithRelations> {
  const existing = await prisma.appointment.findFirst({
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

  let appointment = await prisma.appointment.update({
    where: { id: existing.id },
    data,
    include: APPOINTMENT_INCLUDE,
  });

  try {
    if (appointment.status === "cancelled") {
      if (appointment.googleEventId) {
        await deleteGoogleCalendarEventForAppointment(
          params.organizationId,
          appointment.googleEventId
        );
        appointment = await prisma.appointment.update({
          where: { id: appointment.id },
          data: { googleEventId: null },
          include: APPOINTMENT_INCLUDE,
        });
      }
    } else if (appointment.googleEventId) {
      await updateGoogleCalendarEventForAppointment({
        id: appointment.id,
        organizationId: appointment.organizationId,
        startTime: appointment.startTime,
        durationMinutes: appointment.durationMinutes,
        notes: appointment.notes,
        client: appointment.client,
        service: appointment.service,
        googleEventId: appointment.googleEventId,
      });
    } else {
      const googleEventId = await createGoogleCalendarEventForAppointment(appointment);
      if (googleEventId) {
        appointment = await prisma.appointment.update({
          where: { id: appointment.id },
          data: { googleEventId },
          include: APPOINTMENT_INCLUDE,
        });
      }
    }
  } catch (syncErr) {
    console.error("Failed to sync appointment update to Google Calendar:", syncErr);
  }

  return appointment;
}

export async function deleteAppointmentForOrganization(
  organizationId: string,
  appointmentId: string
): Promise<{ ok: true }> {
  const existing = await prisma.appointment.findFirst({
    where: { id: appointmentId, organizationId },
  });
  if (!existing) {
    throw new Error("Appointment not found");
  }

  if (existing.googleEventId) {
    try {
      await deleteGoogleCalendarEventForAppointment(organizationId, existing.googleEventId);
    } catch (syncErr) {
      console.error("Failed to delete appointment from Google Calendar:", syncErr);
    }
  }

  await prisma.appointment.delete({ where: { id: appointmentId } });
  return { ok: true };
}
