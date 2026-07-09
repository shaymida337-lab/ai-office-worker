import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertAttendanceTransition } from "./stateMachine.js";
import { renderReminderTemplate, resolveTemplateLocale } from "./templates.js";
import { WhatsAppReminderProvider } from "./whatsappProvider.js";
import { interpretReminderReply } from "./responseInterpreter.js";
import type { AttendanceState } from "./types.js";

const provider = new WhatsAppReminderProvider();
const LEASE_MS = 30_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];
const DEFAULT_MAX_ATTEMPTS = 4;

type ReminderSettings = {
  enabled: boolean;
  timezone: string;
  language: string;
  reminder24hEnabled: boolean;
  sameDayEnabled: boolean;
  sameDayOffsetMinutes: number;
};

function toSettings(organization: { timezone: string; language: string; calendarAutonomyJson: unknown }): ReminderSettings {
  const json = organization.calendarAutonomyJson && typeof organization.calendarAutonomyJson === "object"
    ? (organization.calendarAutonomyJson as Record<string, unknown>)
    : {};
  const reminders = json.reminders && typeof json.reminders === "object"
    ? (json.reminders as Record<string, unknown>)
    : {};
  return {
    enabled: reminders.enabled === true,
    timezone: typeof reminders.timezone === "string" ? reminders.timezone : organization.timezone,
    language: typeof reminders.language === "string" ? reminders.language : organization.language,
    reminder24hEnabled: reminders.reminder24hEnabled !== false,
    sameDayEnabled: reminders.sameDayEnabled !== false,
    sameDayOffsetMinutes:
      typeof reminders.sameDayOffsetMinutes === "number" && reminders.sameDayOffsetMinutes > 0
        ? reminders.sameDayOffsetMinutes
        : 180,
  };
}

function touchpointIdempotencyKey(input: {
  appointmentId: string;
  touchpoint: "reminder_24h" | "reminder_same_day";
  scheduledForUtc: Date;
  channel: string;
}): string {
  return createHash("sha256")
    .update(`${input.appointmentId}|${input.touchpoint}|${input.scheduledForUtc.toISOString()}|${input.channel}`)
    .digest("hex");
}

function retryNextAttempt(attemptCount: number): Date | null {
  const idx = Math.max(0, attemptCount - 1);
  const delay = RETRY_DELAYS_MS[idx];
  if (!delay) return null;
  return new Date(Date.now() + delay);
}

async function emitReminderEvent(input: {
  organizationId: string;
  appointmentId: string;
  reminderJobId?: string | null;
  eventType: string;
  eventSource: string;
  payloadJsonSanitized?: Record<string, unknown> | null;
  provider?: string | null;
  providerMessageId?: string | null;
  providerEventId?: string | null;
  dedupeKey?: string | null;
}) {
  try {
    await prisma.appointmentReminderEvent.create({
      data: {
        organizationId: input.organizationId,
        appointmentId: input.appointmentId,
        reminderJobId: input.reminderJobId ?? null,
        eventType: input.eventType,
        eventSource: input.eventSource,
        payloadJsonSanitized: (input.payloadJsonSanitized ?? undefined) as Prisma.InputJsonValue | undefined,
        provider: input.provider ?? null,
        providerMessageId: input.providerMessageId ?? null,
        providerEventId: input.providerEventId ?? null,
        dedupeKey: input.dedupeKey ?? null,
        occurredAtUtc: new Date(),
      },
    });
  } catch {
    // best effort audit write
  }
}

export async function isReminderFeatureEnabled(organizationId: string): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true, language: true, calendarAutonomyJson: true },
  });
  if (!org) return false;
  return toSettings(org).enabled;
}

export async function updateReminderSettingsForOrganization(
  organizationId: string,
  input: Partial<ReminderSettings>
) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { calendarAutonomyJson: true },
  });
  if (!org) throw new Error("Organization not found");
  const root =
    org.calendarAutonomyJson && typeof org.calendarAutonomyJson === "object"
      ? ({ ...(org.calendarAutonomyJson as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const existing =
    root.reminders && typeof root.reminders === "object"
      ? ({ ...(root.reminders as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  root.reminders = {
    ...existing,
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.timezone ? { timezone: input.timezone } : {}),
    ...(input.language ? { language: input.language } : {}),
    ...(input.reminder24hEnabled !== undefined ? { reminder24hEnabled: input.reminder24hEnabled } : {}),
    ...(input.sameDayEnabled !== undefined ? { sameDayEnabled: input.sameDayEnabled } : {}),
    ...(input.sameDayOffsetMinutes !== undefined ? { sameDayOffsetMinutes: input.sameDayOffsetMinutes } : {}),
  };
  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data: { calendarAutonomyJson: root as Prisma.InputJsonValue },
    select: { id: true, timezone: true, language: true, calendarAutonomyJson: true },
  });
  return { organizationId: updated.id, reminders: toSettings(updated) };
}

export async function ensureAppointmentReminderArtifacts(appointmentId: string): Promise<void> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      organization: { select: { id: true, timezone: true, language: true, calendarAutonomyJson: true, name: true } },
      client: { select: { id: true, name: true, whatsappNumber: true } },
      service: { select: { name: true } },
    },
  });
  if (!appointment) return;
  const settings = toSettings(appointment.organization);
  if (!settings.enabled) return;
  if (!appointment.client.whatsappNumber) return;
  if (["cancelled", "completed", "no_show"].includes(appointment.status)) return;

  const now = new Date();
  const start = new Date(appointment.startTime);
  const candidates: Array<{ touchpoint: "reminder_24h" | "reminder_same_day"; when: Date }> = [];
  if (settings.reminder24hEnabled) {
    candidates.push({ touchpoint: "reminder_24h", when: new Date(start.getTime() - 24 * 60 * 60 * 1000) });
  }
  if (settings.sameDayEnabled) {
    candidates.push({
      touchpoint: "reminder_same_day",
      when: new Date(start.getTime() - settings.sameDayOffsetMinutes * 60 * 1000),
    });
  }

  await prisma.appointmentAttendanceProjection.upsert({
    where: { appointmentId: appointment.id },
    update: {
      reminderState: "reminder_pending",
      attendanceState: appointment.status === "confirmed" ? "confirmed" : "scheduled",
      nextReminderAt: candidates.map((item) => item.when).sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
      lastTransitionAt: now,
    },
    create: {
      appointmentId: appointment.id,
      organizationId: appointment.organizationId,
      attendanceState: appointment.status === "confirmed" ? "confirmed" : "scheduled",
      reminderState: "reminder_pending",
      confirmationStatus: "unknown",
      nextReminderAt: candidates.map((item) => item.when).sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
      lastTransitionAt: now,
    },
  });

  for (const candidate of candidates) {
    if (candidate.when <= now) continue;
    const idempotencyKey = touchpointIdempotencyKey({
      appointmentId: appointment.id,
      touchpoint: candidate.touchpoint,
      scheduledForUtc: candidate.when,
      channel: "whatsapp",
    });
    await prisma.appointmentReminderJob.upsert({
      where: { idempotencyKey },
      create: {
        organizationId: appointment.organizationId,
        appointmentId: appointment.id,
        channel: "whatsapp",
        touchpoint: candidate.touchpoint,
        templateKey: candidate.touchpoint,
        locale: resolveTemplateLocale(settings.language),
        status: "pending",
        scheduledForUtc: candidate.when,
        timezone: settings.timezone,
        idempotencyKey,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        timeoutAt: new Date(start.getTime() + 6 * 60 * 60 * 1000),
      },
      update: {},
    });
  }

  await emitReminderEvent({
    organizationId: appointment.organizationId,
    appointmentId: appointment.id,
    eventType: "queued",
    eventSource: "system",
    payloadJsonSanitized: { reminderJobsPlanned: candidates.length },
  });
}

export async function syncAppointmentAttendanceFromStatus(input: {
  organizationId: string;
  appointmentId: string;
  appointmentStatus: string;
}) {
  const target =
    input.appointmentStatus === "cancelled"
      ? "cancelled"
      : input.appointmentStatus === "completed"
        ? "arrived"
        : input.appointmentStatus === "no_show"
          ? "no_show"
          : input.appointmentStatus === "confirmed"
            ? "confirmed"
            : "scheduled";
  const projection = await prisma.appointmentAttendanceProjection.findUnique({
    where: { appointmentId: input.appointmentId },
  });
  if (!projection) {
    await prisma.appointmentAttendanceProjection.create({
      data: {
        appointmentId: input.appointmentId,
        organizationId: input.organizationId,
        attendanceState: target,
        reminderState: target === "scheduled" ? "reminder_pending" : target,
        confirmationStatus: target === "confirmed" ? "confirmed" : "unknown",
        lastTransitionAt: new Date(),
      },
    });
    return;
  }
  const from = projection.attendanceState as AttendanceState;
  const to = target as AttendanceState;
  if (from !== to) {
    try {
      assertAttendanceTransition(from, to);
    } catch {
      // keep existing state if transition is not valid
      return;
    }
  }
  await prisma.appointmentAttendanceProjection.update({
    where: { appointmentId: input.appointmentId },
    data: {
      attendanceState: to,
      reminderState: to,
      confirmationStatus: to === "confirmed" ? "confirmed" : projection.confirmationStatus,
      lastTransitionAt: new Date(),
      version: { increment: 1 },
    },
  });
}

export async function leaseDueReminderJobs(workerId: string, limit = 25) {
  const now = new Date();
  const candidates = await prisma.appointmentReminderJob.findMany({
    where: {
      status: { in: ["pending", "failed"] },
      AND: [
        { OR: [{ nextAttemptAt: null, scheduledForUtc: { lte: now } }, { nextAttemptAt: { lte: now } }] },
        { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
      ],
      attemptCount: { lt: DEFAULT_MAX_ATTEMPTS },
    },
    orderBy: { scheduledForUtc: "asc" },
    take: limit,
  });

  const leased: typeof candidates = [];
  for (const job of candidates) {
    const updated = await prisma.appointmentReminderJob.updateMany({
      where: {
        id: job.id,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: {
        status: "leased",
        leaseOwner: workerId,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      },
    });
    if (updated.count > 0) leased.push(job);
  }
  return leased;
}

export async function processDueReminderJobs(workerId = "scheduler") {
  const jobs = await leaseDueReminderJobs(workerId, 50);
  for (const leasedJob of jobs) {
    const job = await prisma.appointmentReminderJob.findUnique({
      where: { id: leasedJob.id },
      include: {
        appointment: {
          include: {
            organization: { select: { id: true, timezone: true, language: true, calendarAutonomyJson: true, name: true } },
            client: { select: { name: true, whatsappNumber: true } },
            service: { select: { name: true } },
          },
        },
      },
    });
    if (!job?.appointment) continue;
    const settings = toSettings(job.appointment.organization);
    if (!settings.enabled) {
      await prisma.appointmentReminderJob.update({ where: { id: job.id }, data: { status: "cancelled", leaseOwner: null, leaseExpiresAt: null } });
      continue;
    }
    if (!job.appointment.client.whatsappNumber) {
      await prisma.appointmentReminderJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          leaseOwner: null,
          leaseExpiresAt: null,
          attemptCount: { increment: 1 },
          lastErrorCode: "missing_phone",
          lastErrorMessage: "Client WhatsApp number is missing",
        },
      });
      continue;
    }
    const dateLabel = new Date(job.appointment.startTime).toLocaleDateString(
      resolveTemplateLocale(settings.language) === "he" ? "he-IL" : "en-US",
      { dateStyle: "medium" }
    );
    const timeLabel = new Date(job.appointment.startTime).toLocaleTimeString(
      resolveTemplateLocale(settings.language) === "he" ? "he-IL" : "en-US",
      { hour: "2-digit", minute: "2-digit", hour12: false }
    );
    const template = renderReminderTemplate({
      key: job.templateKey as "reminder_24h" | "reminder_same_day",
      locale: settings.language,
      context: {
        clientName: job.appointment.client.name,
        businessName: job.appointment.organization.name,
        appointmentDate: dateLabel,
        appointmentTime: timeLabel,
        service: job.appointment.service?.name ?? "Service",
        staffName: "Natalie",
      },
    });
    const sendResult = await provider.sendReminder({
      organizationId: job.organizationId,
      appointmentId: job.appointmentId,
      clientPhone: job.appointment.client.whatsappNumber,
      locale: template.locale,
      body: template.body,
      idempotencyKey: job.idempotencyKey,
    });
    if (sendResult.ok) {
      await prisma.$transaction([
        prisma.appointmentReminderJob.update({
          where: { id: job.id },
          data: {
            status: "sent",
            provider: sendResult.provider,
            providerMessageId: sendResult.providerMessageId,
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        }),
        prisma.appointmentAttendanceProjection.upsert({
          where: { appointmentId: job.appointmentId },
          create: {
            appointmentId: job.appointmentId,
            organizationId: job.organizationId,
            attendanceState: "reminder_sent",
            reminderState: "reminder_sent",
            confirmationStatus: "unknown",
            lastReminderSentAt: new Date(),
            lastTransitionAt: new Date(),
          },
          update: {
            attendanceState: "reminder_sent",
            reminderState: "reminder_sent",
            lastReminderSentAt: new Date(),
            lastTransitionAt: new Date(),
            version: { increment: 1 },
          },
        }),
      ]);
      await emitReminderEvent({
        organizationId: job.organizationId,
        appointmentId: job.appointmentId,
        reminderJobId: job.id,
        eventType: "sent",
        eventSource: "system",
        provider: sendResult.provider,
        providerMessageId: sendResult.providerMessageId,
      });
    } else {
      const attemptCount = job.attemptCount + 1;
      const nextAttempt = sendResult.retryable ? retryNextAttempt(attemptCount) : null;
      const deadLetter = !sendResult.retryable || !nextAttempt || attemptCount >= job.maxAttempts;
      await prisma.appointmentReminderJob.update({
        where: { id: job.id },
        data: {
          status: deadLetter ? "dead_letter" : "failed",
          leaseOwner: null,
          leaseExpiresAt: null,
          attemptCount,
          nextAttemptAt: deadLetter ? null : nextAttempt,
          lastErrorCode: sendResult.errorCode,
          lastErrorMessage: sendResult.errorMessage.slice(0, 1000),
        },
      });
      await prisma.appointmentAttendanceProjection.upsert({
        where: { appointmentId: job.appointmentId },
        create: {
          appointmentId: job.appointmentId,
          organizationId: job.organizationId,
          attendanceState: "reminder_pending",
          reminderState: "reminder_failed",
          confirmationStatus: "unknown",
          lastTransitionAt: new Date(),
          lastTransitionReason: sendResult.errorCode,
        },
        update: {
          reminderState: "reminder_failed",
          lastTransitionAt: new Date(),
          lastTransitionReason: sendResult.errorCode,
          version: { increment: 1 },
        },
      });
      await emitReminderEvent({
        organizationId: job.organizationId,
        appointmentId: job.appointmentId,
        reminderJobId: job.id,
        eventType: deadLetter ? "dead_letter" : "failed",
        eventSource: "system",
        payloadJsonSanitized: {
          errorCode: sendResult.errorCode,
          retryable: sendResult.retryable,
          attemptCount,
        },
      });
    }
  }
}

export async function markNoResponseDueAppointments(now = new Date()) {
  const due = await prisma.appointment.findMany({
    where: { startTime: { lte: now }, status: { in: ["pending", "confirmed"] } },
    select: { id: true, organizationId: true },
  });
  for (const appt of due) {
    const projection = await prisma.appointmentAttendanceProjection.findUnique({ where: { appointmentId: appt.id } });
    if (!projection) continue;
    if (projection.attendanceState === "reminder_sent") {
      assertAttendanceTransition("reminder_sent", "no_response");
      await prisma.appointmentAttendanceProjection.update({
        where: { appointmentId: appt.id },
        data: {
          attendanceState: "no_response",
          reminderState: "no_response",
          confirmationStatus: "no_response",
          lastTransitionAt: now,
          lastTransitionReason: "appointment_started_without_reply",
          version: { increment: 1 },
        },
      });
      await emitReminderEvent({
        organizationId: appt.organizationId,
        appointmentId: appt.id,
        eventType: "no_response",
        eventSource: "system",
      });
    }
  }
}

export async function handleReminderInboundReply(input: {
  organizationId: string;
  appointmentId: string;
  messageSid: string;
  text?: string | null;
  buttonPayload?: string | null;
}) {
  const dedupeKey = `wa_inbound:${input.messageSid}`;
  const action = interpretReminderReply({ text: input.text, buttonPayload: input.buttonPayload });
  if (action === "unknown") {
    await emitReminderEvent({
      organizationId: input.organizationId,
      appointmentId: input.appointmentId,
      eventType: "reply_unknown",
      eventSource: "provider_webhook",
      dedupeKey,
      payloadJsonSanitized: { text: input.text?.slice(0, 240) ?? null },
    });
    return { applied: false, action };
  }
  const projection = await prisma.appointmentAttendanceProjection.findUnique({ where: { appointmentId: input.appointmentId } });
  if (!projection) return { applied: false, action };
  const fromState = projection.attendanceState as AttendanceState;
  const toState: AttendanceState =
    action === "confirm" ? "confirmed" : action === "decline" ? "declined" : "reschedule_requested";
  if (fromState !== toState) {
    assertAttendanceTransition(fromState, toState);
  }
  await prisma.appointmentAttendanceProjection.update({
    where: { appointmentId: input.appointmentId },
    data: {
      attendanceState: toState,
      reminderState: toState,
      confirmationStatus: toState,
      responseChannel: "whatsapp",
      responseLocale: resolveTemplateLocale(undefined),
      lastResponseAt: new Date(),
      lastTransitionAt: new Date(),
      version: { increment: 1 },
    },
  });
  await emitReminderEvent({
    organizationId: input.organizationId,
    appointmentId: input.appointmentId,
    eventType: toState,
    eventSource: "provider_webhook",
    dedupeKey,
    provider: "whatsapp",
    providerEventId: input.messageSid,
    payloadJsonSanitized: { text: input.text?.slice(0, 240) ?? null, action },
  });
  return { applied: true, action };
}

export async function getAppointmentReminderStatus(organizationId: string, appointmentId: string) {
  const [projection, nextReminder] = await Promise.all([
    prisma.appointmentAttendanceProjection.findFirst({ where: { appointmentId, organizationId } }),
    prisma.appointmentReminderJob.findFirst({
      where: { appointmentId, organizationId, status: { in: ["pending", "failed", "leased"] } },
      orderBy: { scheduledForUtc: "asc" },
    }),
  ]);
  return {
    appointmentId,
    attendance: projection
      ? {
          attendanceState: projection.attendanceState,
          reminderState: projection.reminderState,
          confirmationStatus: projection.confirmationStatus,
          lastReminderSentAt: projection.lastReminderSentAt,
          lastResponseAt: projection.lastResponseAt,
          version: projection.version,
        }
      : null,
    nextReminder: nextReminder
      ? {
          jobId: nextReminder.id,
          touchpoint: nextReminder.touchpoint,
          channel: nextReminder.channel,
          scheduledForUtc: nextReminder.scheduledForUtc,
          timezone: nextReminder.timezone,
        }
      : null,
    featureEnabled: await isReminderFeatureEnabled(organizationId),
  };
}

export async function listAppointmentReminderEvents(organizationId: string, appointmentId: string, limit = 50) {
  return prisma.appointmentReminderEvent.findMany({
    where: { organizationId, appointmentId },
    orderBy: { occurredAtUtc: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
}

export async function manualSendAppointmentReminder(input: {
  organizationId: string;
  appointmentId: string;
  userId: string;
  locale?: string;
}) {
  const appt = await prisma.appointment.findFirst({
    where: { id: input.appointmentId, organizationId: input.organizationId },
    include: {
      organization: { select: { id: true, timezone: true, language: true, calendarAutonomyJson: true, name: true } },
      client: { select: { name: true, whatsappNumber: true } },
      service: { select: { name: true } },
    },
  });
  if (!appt) throw new Error("Appointment not found");
  if (!appt.client.whatsappNumber) throw new Error("Client WhatsApp number is missing");
  const locale = input.locale ?? appt.organization.language;
  const dateLabel = new Date(appt.startTime).toLocaleDateString(resolveTemplateLocale(locale) === "he" ? "he-IL" : "en-US");
  const timeLabel = new Date(appt.startTime).toLocaleTimeString(resolveTemplateLocale(locale) === "he" ? "he-IL" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const template = renderReminderTemplate({
    key: "reminder_same_day",
    locale,
    context: {
      clientName: appt.client.name,
      businessName: appt.organization.name,
      appointmentDate: dateLabel,
      appointmentTime: timeLabel,
      service: appt.service?.name ?? "Service",
      staffName: "Natalie",
    },
  });
  const now = new Date();
  const idempotencyKey = createHash("sha256")
    .update(`manual|${appt.id}|${now.toISOString().slice(0, 16)}`)
    .digest("hex");
  const job = await prisma.appointmentReminderJob.create({
    data: {
      organizationId: appt.organizationId,
      appointmentId: appt.id,
      channel: "whatsapp",
      touchpoint: "manual",
      templateKey: template.templateKey,
      templateVersion: template.version,
      locale: template.locale,
      status: "pending",
      scheduledForUtc: now,
      timezone: appt.organization.timezone,
      idempotencyKey,
    },
  });
  await emitReminderEvent({
    organizationId: appt.organizationId,
    appointmentId: appt.id,
    reminderJobId: job.id,
    eventType: "created",
    eventSource: "operator",
    payloadJsonSanitized: { actorUserId: input.userId },
  });
  return { jobId: job.id, status: job.status };
}
