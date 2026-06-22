import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  createGoogleCalendarEventForAppointment,
  deleteGoogleCalendarEventForAppointment,
  updateGoogleCalendarEventForAppointment,
} from "./google.js";

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

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
};

const HEBREW_WEEKDAY_TARGETS: Array<{ day: number; patterns: string[] }> = [
  { day: 0, patterns: ["יום ראשון", "ראשון"] },
  { day: 1, patterns: ["יום שני", "שני"] },
  { day: 2, patterns: ["יום שלישי", "שלישי"] },
  { day: 3, patterns: ["יום רביעי", "רביעי"] },
  { day: 4, patterns: ["יום חמישי", "חמישי"] },
  { day: 5, patterns: ["יום שישי", "שישי"] },
  { day: 6, patterns: ["יום שבת", "שבת"] },
];

export function resolveAppointmentDateTime(params: {
  dayReference?: string;
  time?: string;
  explicitStartTime?: string;
  timeZone: string;
  now?: Date;
}): Date | null {
  const timeZone = params.timeZone.trim() || "Asia/Jerusalem";
  const now = params.now ?? new Date();

  const explicit = params.explicitStartTime?.trim();
  if (explicit) {
    const parsedExplicit = parseExplicitStartTime(explicit, timeZone);
    if (parsedExplicit) return parsedExplicit;
  }

  const dayReference = params.dayReference?.trim();
  const time = params.time?.trim();
  if (!dayReference || !time) return null;

  const localParts = resolveDayReference(dayReference, now, timeZone);
  const parsedTime = parseAppointmentTime(time);
  if (!localParts || !parsedTime) return null;

  return wallClockToDate(
    localParts.year,
    localParts.month,
    localParts.day,
    parsedTime.hours,
    parsedTime.minutes,
    timeZone
  );
}

function parseExplicitStartTime(value: string, timeZone: string): Date | null {
  if (/[zZ]$/.test(value) || /[+-]\d{2}:\d{2}$/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (isoMatch) {
    return wallClockToDate(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
      Number(isoMatch[4]),
      Number(isoMatch[5]),
      timeZone
    );
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveDayReference(dayReference: string, now: Date, timeZone: string): LocalDateParts | null {
  const normalized = dayReference.trim().replace(/\s+/g, " ");
  const today = getLocalDateParts(now, timeZone);

  if (/^היום$/u.test(normalized)) {
    return today;
  }
  if (/^מחר$/u.test(normalized)) {
    return addCalendarDays(today, 1);
  }
  if (/^מחרתיים$/u.test(normalized)) {
    return addCalendarDays(today, 2);
  }

  for (const weekday of HEBREW_WEEKDAY_TARGETS) {
    if (weekday.patterns.some((pattern) => normalized.includes(pattern))) {
      const currentWeekday = getWeekdayInTimezone(now, timeZone);
      const daysToAdd =
        currentWeekday === weekday.day ? 7 : ((weekday.day - currentWeekday + 7) % 7) || 7;
      return addCalendarDays(today, daysToAdd);
    }
  }

  const explicitDate = parseExplicitCalendarDate(normalized, today.year);
  if (explicitDate) return explicitDate;

  return null;
}

function parseExplicitCalendarDate(value: string, defaultYear: number): LocalDateParts | null {
  const match = value.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3] ? Number(match[3]) : defaultYear;
  if (year < 100) year += 2000;

  if (!isValidCalendarDate(year, month, day)) return null;
  return { year, month, day };
}

function parseAppointmentTime(value: string): { hours: number; minutes: number } | null {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = match[2] !== undefined ? Number(match[2]) : 0;
  if (!Number.isInteger(hours) || hours < 0 || hours > 23) return null;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

function getLocalDateParts(date: Date, timeZone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

function getWeekdayInTimezone(date: Date, timeZone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[weekday] ?? 0;
}

function addCalendarDays(parts: LocalDateParts, daysToAdd: number): LocalDateParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + daysToAdd));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
  );
}

function wallClockToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date | null {
  if (!isValidCalendarDate(year, month, day)) return null;

  const localDateTime = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  const provisional = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = getTimezoneOffsetForDate(provisional, timeZone);
  const parsed = new Date(`${localDateTime}${offset}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getTimezoneOffsetForDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const getNumber = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtcMs = Date.UTC(
    getNumber("year"),
    getNumber("month") - 1,
    getNumber("day"),
    getNumber("hour"),
    getNumber("minute"),
    getNumber("second")
  );
  const offsetMinutes = Math.round((asUtcMs - date.getTime()) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minutes = String(absoluteMinutes % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}
