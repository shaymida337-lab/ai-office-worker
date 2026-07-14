/**
 * כרטיס לקוח — בסיס: התור העתידי הקרוב והערות ללקוח.
 *
 * כל שאילתה כאן תמיד תחומה ב-clientId + organizationId ביחד — לעולם לא
 * lookup לפי clientId בלבד. שכבת ה-route מוסיפה מעליה את checkClientOwnership.
 */

import { prisma } from "../../lib/prisma.js";

export type ClientCardDeps = {
  db?: typeof prisma;
  now?: Date;
};

export type NextAppointment = {
  id: string;
  startTime: Date;
  durationMinutes: number;
  status: string;
  serviceName: string | null;
  employeeName: string | null;
};

/** התור העתידי הקרוב ביותר שאינו מבוטל — מנתוני היומן האמיתיים. */
export async function findNextAppointmentForClient(
  params: { organizationId: string; clientId: string },
  deps: ClientCardDeps = {}
): Promise<NextAppointment | null> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  const appointment = await db.appointment.findFirst({
    where: {
      organizationId: params.organizationId,
      clientId: params.clientId,
      status: { not: "cancelled" },
      startTime: { gte: now },
    },
    orderBy: { startTime: "asc" },
    select: {
      id: true,
      startTime: true,
      durationMinutes: true,
      status: true,
      service: { select: { name: true } },
      employee: { select: { name: true } },
    },
  });
  if (!appointment) return null;
  return {
    id: appointment.id,
    startTime: appointment.startTime,
    durationMinutes: appointment.durationMinutes,
    status: appointment.status,
    serviceName: appointment.service?.name ?? null,
    employeeName: appointment.employee?.name ?? null,
  };
}

export type ClientAppointmentListItem = {
  id: string;
  clientId: string;
  startTime: Date;
  durationMinutes: number;
  status: string;
  notes: string | null;
  serviceName: string | null;
  employeeName: string | null;
};

/**
 * כל התורים של הלקוח (עתידיים, קודמים ומבוטלים) מהיומן האמיתי — ממוינים
 * מהחדש לישן, כך שתורים עתידיים מופיעים ראשונים באופן טבעי.
 */
export async function listClientAppointments(
  params: { organizationId: string; clientId: string; limit?: number },
  deps: ClientCardDeps = {}
): Promise<ClientAppointmentListItem[]> {
  const db = deps.db ?? prisma;
  const appointments = await db.appointment.findMany({
    where: { organizationId: params.organizationId, clientId: params.clientId },
    orderBy: { startTime: "desc" },
    take: params.limit ?? 200,
    select: {
      id: true,
      clientId: true,
      startTime: true,
      durationMinutes: true,
      status: true,
      notes: true,
      service: { select: { name: true } },
      employee: { select: { name: true } },
    },
  });
  return appointments.map((appointment) => ({
    id: appointment.id,
    clientId: appointment.clientId,
    startTime: appointment.startTime,
    durationMinutes: appointment.durationMinutes,
    status: appointment.status,
    notes: appointment.notes ?? null,
    serviceName: appointment.service?.name ?? null,
    employeeName: appointment.employee?.name ?? null,
  }));
}

const MAX_NOTE_LENGTH = 2000;

export async function addClientNote(
  params: { organizationId: string; clientId: string; body: unknown },
  deps: ClientCardDeps = {}
) {
  const db = deps.db ?? prisma;
  const body = typeof params.body === "string" ? params.body.trim() : "";
  if (!body) {
    return { ok: false as const, error: "הערה ריקה — יש לכתוב תוכן" };
  }
  if (body.length > MAX_NOTE_LENGTH) {
    return { ok: false as const, error: "ההערה ארוכה מדי — עד 2000 תווים" };
  }
  const note = await db.clientNote.create({
    data: {
      organizationId: params.organizationId,
      clientId: params.clientId,
      body,
    },
  });
  return { ok: true as const, note };
}

export async function listClientNotes(
  params: { organizationId: string; clientId: string; limit?: number },
  deps: ClientCardDeps = {}
) {
  const db = deps.db ?? prisma;
  return db.clientNote.findMany({
    where: { organizationId: params.organizationId, clientId: params.clientId },
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 20,
  });
}
