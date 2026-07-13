/**
 * Calendar Phase 1 — ניהול עובדים ביומן: CRUD, שעות עבודה, חופשות,
 * ואימות הזמנת תור לעובד (שירות מותר, שעות, חופשה, כפילות).
 *
 * תור בלי employeeId הוא היומן של בעל העסק — המסלול הקיים לא עובר כאן בכלל.
 */

import { prisma } from "../../lib/prisma.js";
import {
  decideEmployeeBooking,
  isValidLocalDateKey,
  validateWeeklySchedule,
  type EmployeeBookingDecision,
  type WeeklyScheduleEntry,
} from "./employeeBookingRules.js";

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_EMPLOYEE_COLOR = "#3B82F6";
/** תמונה נשמרת כ-data URI או URL — תקרה כדי לא לנפח את הטבלה. */
const MAX_PHOTO_LENGTH = 300_000;

export type EmployeeDeps = {
  db?: typeof prisma;
};

export type EmployeeInput = {
  name?: unknown;
  phone?: unknown;
  color?: unknown;
  photoUrl?: unknown;
  isActive?: unknown;
};

export type EmployeeValidationError = { ok: false; error: string };

function normalizeEmployeeInput(
  input: EmployeeInput,
  options: { partial: boolean }
):
  | {
      ok: true;
      data: {
        name?: string;
        phone?: string | null;
        color?: string;
        photoUrl?: string | null;
        isActive?: boolean;
      };
    }
  | EmployeeValidationError {
  const data: {
    name?: string;
    phone?: string | null;
    color?: string;
    photoUrl?: string | null;
    isActive?: boolean;
  } = {};

  if (input.name !== undefined) {
    if (typeof input.name !== "string" || !input.name.trim()) {
      return { ok: false, error: "שם העובד הוא שדה חובה" };
    }
    data.name = input.name.trim();
  } else if (!options.partial) {
    return { ok: false, error: "שם העובד הוא שדה חובה" };
  }

  if (input.phone !== undefined) {
    if (input.phone === null) {
      data.phone = null;
    } else if (typeof input.phone === "string") {
      data.phone = input.phone.trim() || null;
    } else {
      return { ok: false, error: "טלפון לא תקין" };
    }
  }

  if (input.color !== undefined) {
    if (typeof input.color !== "string" || !HEX_COLOR_PATTERN.test(input.color.trim())) {
      return { ok: false, error: "צבע חייב להיות בפורמט ‎#RRGGBB" };
    }
    data.color = input.color.trim();
  }

  if (input.photoUrl !== undefined) {
    if (input.photoUrl === null) {
      data.photoUrl = null;
    } else if (typeof input.photoUrl === "string") {
      const trimmed = input.photoUrl.trim();
      if (trimmed.length > MAX_PHOTO_LENGTH) {
        return { ok: false, error: "התמונה גדולה מדי — עד ‎300KB" };
      }
      data.photoUrl = trimmed || null;
    } else {
      return { ok: false, error: "תמונה לא תקינה" };
    }
  }

  if (input.isActive !== undefined) {
    data.isActive = Boolean(input.isActive);
  }

  return { ok: true, data };
}

export const EMPLOYEE_LIST_INCLUDE = {
  workingHours: { orderBy: { dayOfWeek: "asc" as const } },
  vacations: { orderBy: { startDate: "asc" as const } },
  serviceLinks: { select: { serviceId: true } },
} as const;

export async function listEmployees(organizationId: string, deps: EmployeeDeps = {}) {
  const db = deps.db ?? prisma;
  return db.employee.findMany({
    where: { organizationId },
    include: EMPLOYEE_LIST_INCLUDE,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

export async function createEmployee(
  organizationId: string,
  input: EmployeeInput,
  deps: EmployeeDeps = {}
) {
  const db = deps.db ?? prisma;
  const normalized = normalizeEmployeeInput(input, { partial: false });
  if (!normalized.ok) return normalized;
  const employee = await db.employee.create({
    data: {
      organizationId,
      name: normalized.data.name!,
      phone: normalized.data.phone ?? null,
      color: normalized.data.color ?? DEFAULT_EMPLOYEE_COLOR,
      photoUrl: normalized.data.photoUrl ?? null,
      isActive: normalized.data.isActive ?? true,
    },
    include: EMPLOYEE_LIST_INCLUDE,
  });
  return { ok: true as const, employee };
}

export async function updateEmployee(
  organizationId: string,
  employeeId: string,
  input: EmployeeInput,
  deps: EmployeeDeps = {}
) {
  const db = deps.db ?? prisma;
  const existing = await db.employee.findFirst({ where: { id: employeeId, organizationId } });
  if (!existing) return { ok: false as const, error: "העובד לא נמצא", notFound: true as const };
  const normalized = normalizeEmployeeInput(input, { partial: true });
  if (!normalized.ok) return normalized;
  const employee = await db.employee.update({
    where: { id: existing.id },
    data: normalized.data,
    include: EMPLOYEE_LIST_INCLUDE,
  });
  return { ok: true as const, employee };
}

/**
 * מחיקת עובד. אם יש לו תורים עתידיים שלא בוטלו — חוסמים ומציעים השבתה,
 * כדי שתורים קיימים לא "יקפצו" בשקט ליומן של בעל העסק.
 */
export async function deleteEmployee(
  organizationId: string,
  employeeId: string,
  deps: EmployeeDeps = {}
) {
  const db = deps.db ?? prisma;
  const existing = await db.employee.findFirst({ where: { id: employeeId, organizationId } });
  if (!existing) return { ok: false as const, error: "העובד לא נמצא", notFound: true as const };
  const futureAppointments = await db.appointment.count({
    where: {
      organizationId,
      employeeId,
      status: { not: "cancelled" },
      startTime: { gte: new Date() },
    },
  });
  if (futureAppointments > 0) {
    return {
      ok: false as const,
      error: `לעובד יש ${futureAppointments} תורים עתידיים — יש לבטל או להעביר אותם, או להשבית את העובד במקום למחוק`,
      conflict: true as const,
    };
  }
  await db.employee.delete({ where: { id: existing.id } });
  return { ok: true as const };
}

/** החלפת הלוח השבועי כולו בפעולה אחת (idempotent). */
export async function setEmployeeWorkingHours(
  organizationId: string,
  employeeId: string,
  rawSchedule: unknown,
  deps: EmployeeDeps = {}
) {
  const db = deps.db ?? prisma;
  const existing = await db.employee.findFirst({ where: { id: employeeId, organizationId } });
  if (!existing) return { ok: false as const, error: "העובד לא נמצא", notFound: true as const };
  const validated = validateWeeklySchedule(rawSchedule);
  if (!validated.ok) return { ok: false as const, error: validated.error };
  await db.$transaction([
    db.employeeWorkingHours.deleteMany({ where: { employeeId } }),
    ...(validated.entries.length
      ? [
          db.employeeWorkingHours.createMany({
            data: validated.entries.map((entry) => ({
              employeeId,
              dayOfWeek: entry.dayOfWeek,
              startTime: entry.startTime,
              endTime: entry.endTime,
              breaksJson: entry.breaks,
            })),
          }),
        ]
      : []),
  ]);
  return { ok: true as const, entries: validated.entries };
}

export async function addEmployeeVacation(
  organizationId: string,
  employeeId: string,
  input: { startDate?: unknown; endDate?: unknown; note?: unknown },
  deps: EmployeeDeps = {}
) {
  const db = deps.db ?? prisma;
  const existing = await db.employee.findFirst({ where: { id: employeeId, organizationId } });
  if (!existing) return { ok: false as const, error: "העובד לא נמצא", notFound: true as const };
  const startDate = typeof input.startDate === "string" ? input.startDate.trim() : "";
  const endDate = typeof input.endDate === "string" ? input.endDate.trim() : startDate;
  if (!isValidLocalDateKey(startDate) || !isValidLocalDateKey(endDate) || startDate > endDate) {
    return { ok: false as const, error: "טווח חופשה לא תקין — תאריכים בפורמט YYYY-MM-DD" };
  }
  const vacation = await db.employeeVacation.create({
    data: {
      organizationId,
      employeeId,
      startDate,
      endDate,
      note: typeof input.note === "string" ? input.note.trim() || null : null,
    },
  });
  return { ok: true as const, vacation };
}

export async function removeEmployeeVacation(
  organizationId: string,
  vacationId: string,
  deps: EmployeeDeps = {}
) {
  const db = deps.db ?? prisma;
  const deleted = await db.employeeVacation.deleteMany({
    where: { id: vacationId, organizationId },
  });
  if (deleted.count === 0) return { ok: false as const, error: "החופשה לא נמצאה", notFound: true as const };
  return { ok: true as const };
}

/** קישורי שירות⇄עובדים: מחליף את רשימת העובדים המורשים לשירות. */
export async function setServiceEmployees(
  organizationId: string,
  serviceId: string,
  employeeIds: unknown,
  deps: EmployeeDeps = {}
) {
  const db = deps.db ?? prisma;
  if (!Array.isArray(employeeIds) || employeeIds.some((id) => typeof id !== "string")) {
    return { ok: false as const, error: "employeeIds must be an array of ids" };
  }
  const uniqueIds = [...new Set(employeeIds as string[])];
  if (uniqueIds.length > 0) {
    const owned = await db.employee.count({
      where: { id: { in: uniqueIds }, organizationId },
    });
    if (owned !== uniqueIds.length) {
      return { ok: false as const, error: "אחד העובדים לא נמצא" };
    }
  }
  await db.$transaction([
    db.serviceEmployee.deleteMany({ where: { serviceId } }),
    ...(uniqueIds.length
      ? [db.serviceEmployee.createMany({ data: uniqueIds.map((employeeId) => ({ serviceId, employeeId })) })]
      : []),
  ]);
  return { ok: true as const, employeeIds: uniqueIds };
}

export type EmployeeBookingValidation =
  | { ok: true }
  | {
      ok: false;
      code:
        | "employee_not_found"
        | "employee_inactive"
        | "service_not_allowed"
        | EmployeeBookingRejectionCode;
      message: string;
    };

type EmployeeBookingRejectionCode = "outside_working_hours" | "on_vacation" | "time_conflict";

/**
 * אימות מלא של תור לעובד: קיום ופעילות, הרשאת שירות, שעות עבודה,
 * חופשה וכפילות מול תורים קיימים של אותו עובד בלבד.
 */
export async function validateEmployeeBooking(params: {
  organizationId: string;
  employeeId: string;
  serviceId?: string | null;
  startTime: Date;
  durationMinutes: number;
  timeZone: string;
  excludeAppointmentId?: string;
  deps?: EmployeeDeps;
}): Promise<EmployeeBookingValidation> {
  const db = params.deps?.db ?? prisma;
  const employee = await db.employee.findFirst({
    where: { id: params.employeeId, organizationId: params.organizationId },
    include: {
      workingHours: true,
      vacations: true,
      serviceLinks: { select: { serviceId: true } },
    },
  });
  if (!employee) {
    return { ok: false, code: "employee_not_found", message: "העובד לא נמצא" };
  }
  if (!employee.isActive) {
    return { ok: false, code: "employee_inactive", message: "העובד מושבת — אי אפשר לקבוע לו תורים" };
  }

  if (params.serviceId) {
    const linkedServiceIds = await db.serviceEmployee.findMany({
      where: { serviceId: params.serviceId },
      select: { employeeId: true },
    });
    // שירות בלי קישורים = כל העובדים מבצעים אותו; עם קישורים — רק המקושרים.
    if (linkedServiceIds.length > 0 && !linkedServiceIds.some((link) => link.employeeId === params.employeeId)) {
      return { ok: false, code: "service_not_allowed", message: "העובד לא מבצע את השירות הזה" };
    }
  }

  const interval = {
    start: params.startTime,
    end: new Date(params.startTime.getTime() + params.durationMinutes * 60_000),
  };

  const existing = await db.appointment.findMany({
    where: {
      organizationId: params.organizationId,
      employeeId: params.employeeId,
      status: { not: "cancelled" },
      startTime: { lt: interval.end },
      ...(params.excludeAppointmentId ? { id: { not: params.excludeAppointmentId } } : {}),
    },
    select: { id: true, startTime: true, durationMinutes: true },
  });

  const decision: EmployeeBookingDecision = decideEmployeeBooking({
    interval,
    timeZone: params.timeZone,
    schedule: employee.workingHours.map((row) => ({
      dayOfWeek: row.dayOfWeek,
      startTime: row.startTime,
      endTime: row.endTime,
      breaks: Array.isArray(row.breaksJson)
        ? (row.breaksJson as Array<{ start: string; end: string }>)
        : [],
    })) satisfies WeeklyScheduleEntry[],
    vacations: employee.vacations.map((row) => ({ startDate: row.startDate, endDate: row.endDate })),
    existingBookings: existing.map((row) => ({
      id: row.id,
      start: row.startTime,
      end: new Date(row.startTime.getTime() + row.durationMinutes * 60_000),
    })),
    excludeBookingId: params.excludeAppointmentId,
  });

  return decision;
}
