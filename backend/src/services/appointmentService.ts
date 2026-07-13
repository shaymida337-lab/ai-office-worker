import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { searchSchedulingCustomers, searchSchedulingCustomersByContact } from "./scheduling/schedulingCustomer.js";
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
  employee: { select: { id: true, name: true, color: true, isActive: true } },
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

/**
 * היסטוריית התורים של ליד מ-CRM: הליד (טבלת Lead) נגזר לכרטיסי הלקוח
 * (טבלת Client) לפי טלפון/אימייל בלבד — התאמה שמרנית שמונעת שיוך שגוי של
 * תורים ללקוח לא נכון. מוחזרים כל התורים (כולל עבר ומבוטלים) לפי הארגון.
 */
export async function findAppointmentsForLead(params: {
  organizationId: string;
  leadId: string;
}): Promise<AppointmentWithRelations[]> {
  const lead = await prisma.lead.findFirst({
    where: { id: params.leadId, organizationId: params.organizationId },
    select: { id: true, phone: true, whatsapp: true, email: true },
  });
  if (!lead) throw new Error("Lead not found");

  const phone = lead.phone ?? lead.whatsapp ?? null;
  const [byPhone, byEmail] = await Promise.all([
    phone
      ? searchSchedulingCustomersByContact({ organizationId: params.organizationId, phone })
      : Promise.resolve([]),
    lead.email
      ? searchSchedulingCustomersByContact({ organizationId: params.organizationId, email: lead.email })
      : Promise.resolve([]),
  ]);

  const clientIds = Array.from(new Set([...byPhone, ...byEmail].map((client) => client.id)));
  if (clientIds.length === 0) return [];

  return prisma.appointment.findMany({
    where: { organizationId: params.organizationId, clientId: { in: clientIds } },
    include: APPOINTMENT_INCLUDE,
    orderBy: { startTime: "asc" },
    take: 200,
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

/**
 * Calendar Phase 1: תור עם employeeId נבדק ונשמר מול היומן של אותו עובד
 * בלבד; תור בלי עובד (בעל העסק) ממשיך במסלול הקיים ללא שינוי.
 */
export async function checkEmployeeAppointmentOverlap(
  tx: Pick<typeof prisma, "appointment">,
  params: {
    organizationId: string;
    employeeId: string;
    startTime: Date;
    durationMinutes: number;
    excludeAppointmentId?: string;
  }
): Promise<boolean> {
  const end = new Date(params.startTime.getTime() + params.durationMinutes * 60_000);
  const existing = await tx.appointment.findMany({
    where: {
      organizationId: params.organizationId,
      employeeId: params.employeeId,
      status: { not: "cancelled" },
      startTime: { lt: end },
      ...(params.excludeAppointmentId ? { id: { not: params.excludeAppointmentId } } : {}),
    },
    select: { startTime: true, durationMinutes: true },
  });
  return existing.some((appointment) => {
    const existingEnd = appointment.startTime.getTime() + appointment.durationMinutes * 60_000;
    return params.startTime.getTime() < existingEnd && end.getTime() > appointment.startTime.getTime();
  });
}

export async function createAppointmentForOrganization(params: {
  organizationId: string;
  userId?: string;
  clientId: string;
  serviceId?: string | null;
  employeeId?: string | null;
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
    if (params.employeeId) {
      // Phase 1 מכוון ליומן הקיים; היומן החדש (מנוע) עדיין לא מכיר עובדים.
      throw new Error("שיוך עובד לתור עדיין לא נתמך ביומן החדש");
    }
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
      if (params.employeeId) {
        // כפילות נבדקת מול תורים של אותו עובד בלבד — בתוך הנעילה (race-safe)
        const hasOverlap = await checkEmployeeAppointmentOverlap(tx, {
          organizationId: params.organizationId,
          employeeId: params.employeeId,
          startTime: params.startTime,
          durationMinutes: params.durationMinutes,
        });
        if (hasOverlap) {
          throw new AppointmentConflictError("לעובד כבר יש תור בשעה הזו");
        }
      } else {
        const conflict = await checkAppointmentConflict({
          organizationId: params.organizationId,
          startTime: params.startTime,
          durationMinutes: params.durationMinutes,
        });
        if (conflict.hasConflict) {
          throw new AppointmentConflictError();
        }
      }
    }

    return tx.appointment.create({
      data: {
        organizationId: params.organizationId,
        clientId: params.clientId,
        serviceId: params.serviceId ?? null,
        employeeId: params.employeeId ?? null,
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
  /** undefined = ללא שינוי; null = החזרה ליומן בעל העסק */
  employeeId?: string | null;
}): Promise<AppointmentWithRelations> {
  const flags = await resolveCalendarEngineFlags(params.organizationId);
  if (flags.writeEnabled) {
    if (params.employeeId) {
      throw new Error("שיוך עובד לתור עדיין לא נתמך ביומן החדש");
    }
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
    const effectiveEmployeeId =
      params.employeeId !== undefined ? params.employeeId : existing.employeeId;
    const timeChanged =
      params.startTime !== undefined ||
      params.durationMinutes !== undefined ||
      params.employeeId !== undefined;

    if (effectiveStatus !== "cancelled" && timeChanged) {
      if (effectiveEmployeeId) {
        const hasOverlap = await checkEmployeeAppointmentOverlap(tx, {
          organizationId: params.organizationId,
          employeeId: effectiveEmployeeId,
          startTime: effectiveStartTime,
          durationMinutes: effectiveDuration,
          excludeAppointmentId: params.appointmentId,
        });
        if (hasOverlap) {
          throw new AppointmentConflictError("לעובד כבר יש תור בשעה הזו");
        }
      } else {
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
    if (params.employeeId !== undefined) {
      if (params.employeeId) {
        data.employee = { connect: { id: params.employeeId } };
      } else {
        data.employee = { disconnect: true };
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
