import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { createGoogleCalendarEventForAppointment } from "./google.js";

export const APPOINTMENT_INCLUDE = {
  client: { select: { id: true, name: true, whatsappNumber: true, color: true } },
  service: { select: { id: true, name: true, color: true, durationMinutes: true } },
} as const;

export type AppointmentWithRelations = Prisma.AppointmentGetPayload<{
  include: typeof APPOINTMENT_INCLUDE;
}>;

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
  const newStart = params.startTime;
  const newEnd = new Date(newStart.getTime() + params.durationMinutes * 60_000);
  const queryFrom = new Date(newStart.getTime() - 24 * 60 * 60 * 1000);

  const existingAppointments = await prisma.appointment.findMany({
    where: {
      organizationId: params.organizationId,
      status: { not: "cancelled" },
      startTime: { gte: queryFrom, lt: newEnd },
      ...(params.excludeAppointmentId ? { id: { not: params.excludeAppointmentId } } : {}),
    },
    select: {
      id: true,
      startTime: true,
      durationMinutes: true,
      status: true,
      client: { select: { name: true } },
    },
  });

  for (const existing of existingAppointments) {
    const existingStart = existing.startTime;
    const existingEnd = new Date(existingStart.getTime() + existing.durationMinutes * 60_000);
    if (newStart < existingEnd && newEnd > existingStart) {
      return { hasConflict: true, conflictingAppointment: existing };
    }
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
