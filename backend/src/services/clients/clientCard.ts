/**
 * כרטיס לקוח — בסיס: התור העתידי הקרוב והערות ללקוח.
 *
 * כל שאילתה כאן תמיד תחומה ב-clientId + organizationId ביחד — לעולם לא
 * lookup לפי clientId בלבד. שכבת ה-route מוסיפה מעליה את checkClientOwnership.
 */

import { prisma } from "../../lib/prisma.js";
import {
  findClientByRealEmail,
  normalizeClientEmailInput,
} from "../clientContact.js";
import { normalizeWhatsAppNumber } from "../whatsapp.js";

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
  /** מחיר השירות מכרטיס השירות; null אם אין שירות או אין מחיר */
  price: number | null;
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
      service: { select: { name: true, price: true } },
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
    price: appointment.service?.price ?? null,
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

export type ClientProfileUpdateInput = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  whatsappNumber?: string | null;
  address?: string | null;
  color?: string;
  invoiceSheetUrl?: string | null;
  taskSheetUrl?: string | null;
  driveFolderUrl?: string | null;
};

export type UpdateClientProfileResult =
  | { ok: true; client: Awaited<ReturnType<typeof prisma.client.update>> }
  | { ok: false; status: 400 | 403 | 409; error: string };

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseSheetId(url?: string | null): string | null {
  return url?.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? null;
}

function parseFolderId(url?: string | null): string | null {
  return url?.match(/\/folders\/([a-zA-Z0-9-_]+)/)?.[1] ?? null;
}

/**
 * Same update path as `PUT /api/clients/:clientId` (client edit form).
 * Always scopes by organizationId + clientId together.
 */
export async function updateClientProfile(
  params: { organizationId: string; clientId: string; patch: ClientProfileUpdateInput },
  deps: ClientCardDeps = {}
): Promise<UpdateClientProfileResult> {
  const db = deps.db ?? prisma;
  const client = await db.client.findFirst({
    where: { id: params.clientId, organizationId: params.organizationId, isActive: true },
  });
  if (!client) {
    return { ok: false, status: 403, error: "Client access denied" };
  }

  const body = params.patch;
  if (body.email !== undefined) {
    const trimmed = typeof body.email === "string" ? body.email.trim() : "";
    const normalized = trimmed ? normalizeClientEmailInput(body.email) : null;
    if (trimmed && !normalized) {
      return { ok: false, status: 400, error: "Invalid email" };
    }
    if (normalized && !isValidEmail(normalized)) {
      return { ok: false, status: 400, error: "Invalid email" };
    }
    if (normalized) {
      const duplicate = await findClientByRealEmail(db, {
        organizationId: params.organizationId,
        email: normalized,
        excludeClientId: client.id,
      });
      if (duplicate) {
        return { ok: false, status: 409, error: "Another customer already uses this email" };
      }
    }
  }

  const updateData: Record<string, unknown> = {
    ...(body.name && { name: body.name.trim() }),
    ...(body.whatsappNumber !== undefined && {
      whatsappNumber: body.whatsappNumber?.trim() ? normalizeWhatsAppNumber(body.whatsappNumber) : null,
    }),
    ...(body.phone !== undefined && { phone: body.phone?.trim() || null }),
    ...(body.address !== undefined && { address: body.address?.trim() || null }),
    ...(body.color && { color: body.color }),
    ...(body.invoiceSheetUrl !== undefined && {
      invoiceSheetUrl: body.invoiceSheetUrl?.trim() || null,
      invoiceSheetId: parseSheetId(body.invoiceSheetUrl),
    }),
    ...(body.taskSheetUrl !== undefined && {
      taskSheetUrl: body.taskSheetUrl?.trim() || null,
      taskSheetId: parseSheetId(body.taskSheetUrl),
    }),
    ...(body.driveFolderUrl !== undefined && {
      driveFolderUrl: body.driveFolderUrl?.trim() || null,
      driveFolderId: parseFolderId(body.driveFolderUrl),
    }),
  };

  if (body.email !== undefined) {
    const trimmed = typeof body.email === "string" ? body.email.trim() : "";
    const normalized = trimmed ? normalizeClientEmailInput(body.email) : null;
    updateData.email = normalized;
    updateData.emailIsPlaceholder = false;
  }

  const updated = await db.client.update({
    where: { id: client.id },
    data: updateData,
  });
  return { ok: true, client: updated };
}
