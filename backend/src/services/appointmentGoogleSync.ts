import { prisma } from "../lib/prisma.js";
import {
  deleteGoogleCalendarEventForAppointmentStrict,
  GoogleCalendarSyncError,
  upsertGoogleCalendarEventForAppointmentStrict,
} from "./google.js";
import { recordPlatformAudit, systemAuditContext } from "./auditLog/index.js";

export const APPOINTMENT_GOOGLE_SYNC_STATUSES = ["pending", "synced", "failed", "retrying", "disabled"] as const;
export type AppointmentGoogleSyncStatus = (typeof APPOINTMENT_GOOGLE_SYNC_STATUSES)[number];
export const MAX_APPOINTMENT_GOOGLE_SYNC_ATTEMPTS = 4;

export function calculateGoogleSyncBackoffMs(attemptCount: number): number | null {
  if (attemptCount <= 1) return 5_000;
  if (attemptCount === 2) return 30_000;
  if (attemptCount === 3) return 120_000;
  if (attemptCount === 4) return 600_000;
  return null;
}

export function normalizeGoogleSyncError(err: unknown): string {
  if (err instanceof GoogleCalendarSyncError) {
    const suffix = err.statusCode ? ` (status=${err.statusCode})` : "";
    return `${err.code}: ${err.message}${suffix}`.slice(0, 1000);
  }
  if (err instanceof Error) return err.message.slice(0, 1000);
  return String(err).slice(0, 1000);
}

export function isRetryEligible(input: {
  status: string | null | undefined;
  nextRetryAt: Date | null | undefined;
  attemptCount: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (input.status !== "retrying" && input.status !== "failed") return false;
  if (input.attemptCount >= MAX_APPOINTMENT_GOOGLE_SYNC_ATTEMPTS) return false;
  if (!input.nextRetryAt) return input.status === "failed";
  return input.nextRetryAt.getTime() <= now.getTime();
}

export function resolveGoogleSyncFailurePlan(attemptCount: number, now = new Date()) {
  const backoffMs = calculateGoogleSyncBackoffMs(attemptCount);
  if (!backoffMs) {
    return { status: "failed" as const, nextRetryAt: null };
  }
  return { status: "retrying" as const, nextRetryAt: new Date(now.getTime() + backoffMs) };
}

type SyncAuditAction =
  | "google_sync_started"
  | "google_sync_succeeded"
  | "google_sync_failed"
  | "google_sync_retry_scheduled"
  | "google_sync_retry_started"
  | "google_sync_retry_succeeded"
  | "google_sync_retry_failed"
  | "google_sync_dead_letter";

function auditGoogleSyncEvent(input: {
  organizationId: string;
  appointmentId: string;
  action: SyncAuditAction;
  metadata?: Record<string, unknown>;
  reason?: string;
}) {
  recordPlatformAudit({
    organizationId: input.organizationId,
    entityType: "appointment",
    entityId: input.appointmentId,
    action: input.action,
    ...systemAuditContext("calendar-google-sync"),
    reason: input.reason ?? null,
    metadata: input.metadata ?? null,
  });
}

async function setGoogleSyncDisabled(appointmentId: string, message: string) {
  await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      googleSyncStatus: "disabled",
      lastGoogleSyncError: message,
      nextGoogleSyncRetryAt: null,
    },
  });
}

export async function runAppointmentGoogleSync(
  appointmentId: string,
  options?: { reason?: "create" | "update" | "cancel" | "retry" | "manual_retry" }
) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      client: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
    },
  });
  if (!appointment) {
    return { ok: false as const, skipped: true as const, reason: "appointment_not_found" as const };
  }

  const nextAttempt = appointment.googleSyncAttemptCount + 1;
  const retryMode = options?.reason === "retry" || options?.reason === "manual_retry";
  auditGoogleSyncEvent({
    organizationId: appointment.organizationId,
    appointmentId: appointment.id,
    action: retryMode ? "google_sync_retry_started" : "google_sync_started",
    metadata: { attempt: nextAttempt, reason: options?.reason ?? "update" },
  });

  await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      googleSyncStatus: retryMode ? "retrying" : "pending",
      googleSyncAttemptCount: nextAttempt,
      nextGoogleSyncRetryAt: null,
    },
  });

  try {
    if (appointment.status === "cancelled") {
      if (appointment.googleEventId) {
        await deleteGoogleCalendarEventForAppointmentStrict(appointment.organizationId, appointment.googleEventId);
      }
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          googleSyncStatus: "synced",
          lastGoogleSyncAt: new Date(),
          lastGoogleSyncError: null,
          nextGoogleSyncRetryAt: null,
        },
      });
      auditGoogleSyncEvent({
        organizationId: appointment.organizationId,
        appointmentId: appointment.id,
        action: retryMode ? "google_sync_retry_succeeded" : "google_sync_succeeded",
        metadata: { mode: "delete", attempt: nextAttempt },
      });
      return { ok: true as const, status: "synced" as const };
    }

    const googleEventId = await upsertGoogleCalendarEventForAppointmentStrict({
      id: appointment.id,
      organizationId: appointment.organizationId,
      startTime: appointment.startTime,
      durationMinutes: appointment.durationMinutes,
      notes: appointment.notes,
      client: appointment.client,
      service: appointment.service,
      googleEventId: appointment.googleEventId,
    });

    await prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        googleEventId,
        googleSyncStatus: "synced",
        lastGoogleSyncAt: new Date(),
        lastGoogleSyncError: null,
        nextGoogleSyncRetryAt: null,
      },
    });
    auditGoogleSyncEvent({
      organizationId: appointment.organizationId,
      appointmentId: appointment.id,
      action: retryMode ? "google_sync_retry_succeeded" : "google_sync_succeeded",
      metadata: { mode: appointment.googleEventId ? "update" : "create", attempt: nextAttempt },
    });
    return { ok: true as const, status: "synced" as const };
  } catch (err) {
    const message = normalizeGoogleSyncError(err);
    if (err instanceof GoogleCalendarSyncError && err.code === "calendar_disabled") {
      await setGoogleSyncDisabled(appointment.id, message);
      auditGoogleSyncEvent({
        organizationId: appointment.organizationId,
        appointmentId: appointment.id,
        action: retryMode ? "google_sync_retry_failed" : "google_sync_failed",
        metadata: { attempt: nextAttempt, status: "disabled", error: message },
      });
      return { ok: false as const, status: "disabled" as const, error: message };
    }

    const plan = resolveGoogleSyncFailurePlan(nextAttempt, new Date());
    const nextRetryAt = plan.nextRetryAt;
    const status: AppointmentGoogleSyncStatus = plan.status;
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        googleSyncStatus: status,
        lastGoogleSyncError: message,
        nextGoogleSyncRetryAt: nextRetryAt,
      },
    });
    auditGoogleSyncEvent({
      organizationId: appointment.organizationId,
      appointmentId: appointment.id,
      action: retryMode ? "google_sync_retry_failed" : "google_sync_failed",
      metadata: { attempt: nextAttempt, status, error: message, nextRetryAt: nextRetryAt?.toISOString() ?? null },
    });
    if (nextRetryAt) {
      auditGoogleSyncEvent({
        organizationId: appointment.organizationId,
        appointmentId: appointment.id,
        action: "google_sync_retry_scheduled",
        metadata: { attempt: nextAttempt, nextRetryAt: nextRetryAt.toISOString() },
      });
    } else {
      auditGoogleSyncEvent({
        organizationId: appointment.organizationId,
        appointmentId: appointment.id,
        action: "google_sync_dead_letter",
        metadata: { attempt: nextAttempt, error: message },
      });
    }
    return { ok: false as const, status, error: message, nextRetryAt };
  }
}

export async function runDueAppointmentGoogleSyncRetries(limit = 50) {
  const now = new Date();
  const due = await prisma.appointment.findMany({
    where: {
      googleSyncStatus: { in: ["failed", "retrying"] },
      OR: [{ nextGoogleSyncRetryAt: null }, { nextGoogleSyncRetryAt: { lte: now } }],
    },
    select: { id: true, googleSyncAttemptCount: true, googleSyncStatus: true, nextGoogleSyncRetryAt: true },
    orderBy: [{ nextGoogleSyncRetryAt: "asc" }, { updatedAt: "asc" }],
    take: limit,
  });

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  for (const row of due) {
    if (!isRetryEligible({
      status: row.googleSyncStatus,
      attemptCount: row.googleSyncAttemptCount,
      nextRetryAt: row.nextGoogleSyncRetryAt,
      now,
    })) {
      continue;
    }
    attempted += 1;
    const result = await runAppointmentGoogleSync(row.id, { reason: "retry" });
    if (result.ok) succeeded += 1;
    else failed += 1;
  }
  return { attempted, succeeded, failed };
}

