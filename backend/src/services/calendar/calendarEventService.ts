import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { checkCalendarEventConflict } from "./calendarEventConflict.js";
import { parseCalendarAutonomyJson } from "./calendarAutonomy.js";
import { assertCalendarEngineRead, assertCalendarEngineWrite } from "./calendarEngineFlags.js";
import {
  applyCalendarEventStatusTransition,
  applyPrerequisitePassed,
  spawnFollowUpTaskForCompletedEventIfEnabled,
  type CalendarEventActor,
} from "./calendarEventMutations.js";
import { appendCalendarEventAudit } from "./auditWriter.js";
import { appendWorkCaseTimelineEntry } from "./timelineWriter.js";
import { createPendingDecision } from "./decisionQueueService.js";
import type { CalendarEventStatus, CompletionOutcome, DecisionQueueType, EventSource } from "./enums.js";
import {
  allRequiredPrerequisitesPassed,
  failedRequiredPrerequisites,
} from "./prerequisites.js";
import { CalendarEngineServiceError, notFound } from "./serviceErrors.js";
import { summaryConflictDetected, summaryEventCreated, summaryWorkCaseCreated } from "./timelineSummaries.js";
import { LifecycleError } from "./lifecycleErrors.js";
import { scheduleCalendarEventGoogleMirrorOnConfirmed } from "./calendarGoogleMirrorService.js";
import { scheduleCalendarEventGoogleUpdateIfConfirmed } from "./calendarGoogleMirrorService.js";
import { withOrganizationSchedulingLock } from "./schedulingLock.js";

export type { CalendarEventConflictResult } from "./calendarEventConflict.js";
export { checkCalendarEventConflict } from "./calendarEventConflict.js";

const BLOCKING_SCHEDULING_STATUSES: CalendarEventStatus[] = ["pending_readiness", "confirmed"];

const CALENDAR_EVENT_INCLUDE = {
  client: { select: { id: true, name: true } },
  service: { select: { id: true, name: true, durationMinutes: true } },
  workCase: { select: { id: true, title: true, status: true } },
} as const;

export type CalendarEventWithRelations = Prisma.CalendarEventGetPayload<{
  include: typeof CALENDAR_EVENT_INCLUDE;
}>;

async function requireCalendarEvent(
  organizationId: string,
  calendarEventId: string,
  tx?: Prisma.TransactionClient
): Promise<CalendarEventWithRelations> {
  const client = tx ?? prisma;
  const event = await client.calendarEvent.findFirst({
    where: { id: calendarEventId, organizationId },
    include: CALENDAR_EVENT_INCLUDE,
  });
  if (!event) throw notFound("CalendarEvent");
  return event;
}

async function getOrganizationAutonomy(organizationId: string) {
  const org = await prisma.organization.findFirst({
    where: { id: organizationId },
    select: { calendarAutonomyJson: true },
  });
  return parseCalendarAutonomyJson(org?.calendarAutonomyJson);
}

export async function createDraftCalendarEvent(
  organizationId: string,
  input: {
    title?: string | null;
    startAt: Date;
    endAt: Date;
    timezone?: string;
    workCaseId?: string;
    workCaseTitle?: string;
    clientId?: string | null;
    leadId?: string | null;
    assignedUserId?: string | null;
    serviceId?: string | null;
    source: EventSource;
    createdByUserId?: string | null;
    address?: string | null;
    prerequisitesJson?: Prisma.InputJsonValue;
  },
  actor: CalendarEventActor,
  options?: { tx?: Prisma.TransactionClient }
): Promise<CalendarEventWithRelations> {
  await assertCalendarEngineWrite(organizationId);

  const run = async (tx: Prisma.TransactionClient) => {
    let workCaseId = input.workCaseId;
    if (!workCaseId) {
      const workCase = await tx.workCase.create({
        data: {
          organizationId,
          title: (input.workCaseTitle ?? input.title ?? "תיק יומן").trim(),
          clientId: input.clientId ?? null,
          leadId: input.leadId ?? null,
          assignedUserId: input.assignedUserId ?? null,
          source: "calendar",
        },
      });
      workCaseId = workCase.id;

      await appendWorkCaseTimelineEntry({
        organizationId,
        workCaseId,
        type: "work_case_created",
        summary: summaryWorkCaseCreated(workCase.title),
        actor,
        tx,
      });
    } else {
      const existing = await tx.workCase.findFirst({
        where: { id: workCaseId, organizationId },
        select: { id: true },
      });
      if (!existing) throw notFound("WorkCase");
    }

    const event = await tx.calendarEvent.create({
      data: {
        organizationId,
        workCaseId,
        title: input.title ?? null,
        startAt: input.startAt,
        endAt: input.endAt,
        timezone: input.timezone ?? "Asia/Jerusalem",
        clientId: input.clientId ?? null,
        leadId: input.leadId ?? null,
        assignedUserId: input.assignedUserId ?? null,
        serviceId: input.serviceId ?? null,
        source: input.source,
        createdByUserId: input.createdByUserId ?? null,
        status: "draft",
        address: input.address ?? null,
        prerequisitesJson: input.prerequisitesJson ?? [],
      },
      include: CALENDAR_EVENT_INCLUDE,
    });

    await appendCalendarEventAudit({
      calendarEventId: event.id,
      organizationId,
      action: "created",
      actorType: actor.actorType,
      actorUserId: actor.actorUserId,
      toStatus: "draft",
      changesJson: { source: input.source },
      tx,
    });

    await appendWorkCaseTimelineEntry({
      organizationId,
      workCaseId,
      calendarEventId: event.id,
      type: "event_created",
      summary: summaryEventCreated(event.title),
      actor,
      tx,
    });

    return event;
  };

  if (options?.tx) return run(options.tx);
  return prisma.$transaction(run);
}

export async function getCalendarEventById(
  organizationId: string,
  calendarEventId: string
): Promise<CalendarEventWithRelations> {
  await assertCalendarEngineRead(organizationId);
  return requireCalendarEvent(organizationId, calendarEventId);
}

export async function updateCalendarEventFields(
  organizationId: string,
  calendarEventId: string,
  input: {
    title?: string | null;
    startAt?: Date;
    endAt?: Date;
    clientId?: string | null;
    assignedUserId?: string | null;
    serviceId?: string | null;
    internalNotes?: string | null;
    locationType?: string | null;
    address?: string | null;
    remoteLink?: string | null;
  },
  actor: CalendarEventActor
): Promise<CalendarEventWithRelations> {
  await assertCalendarEngineWrite(organizationId);
  const existing = await requireCalendarEvent(organizationId, calendarEventId);

  const nextStartAt = input.startAt ?? existing.startAt;
  const nextEndAt = input.endAt ?? existing.endAt;
  const timeChanged =
    (input.startAt !== undefined && input.startAt.getTime() !== existing.startAt.getTime()) ||
    (input.endAt !== undefined && input.endAt.getTime() !== existing.endAt.getTime());
  const blocksAvailability = BLOCKING_SCHEDULING_STATUSES.includes(existing.status as CalendarEventStatus);

  const runUpdate = async (tx: Prisma.TransactionClient) => {
    if (timeChanged && blocksAvailability) {
      const conflict = await checkCalendarEventConflict({
        organizationId,
        startAt: nextStartAt,
        endAt: nextEndAt,
        excludeCalendarEventId: calendarEventId,
        assignedUserId: input.assignedUserId ?? existing.assignedUserId,
      });
      if (conflict.hasConflict) {
        throw new CalendarEngineServiceError("TIME_CONFLICT", "Time conflict", {
          conflict: conflict.conflict,
        });
      }
    }

    const event = await tx.calendarEvent.update({
      where: { id: calendarEventId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
        ...(input.endAt !== undefined ? { endAt: input.endAt } : {}),
        ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
        ...(input.assignedUserId !== undefined ? { assignedUserId: input.assignedUserId } : {}),
        ...(input.serviceId !== undefined ? { serviceId: input.serviceId } : {}),
        ...(input.internalNotes !== undefined ? { internalNotes: input.internalNotes } : {}),
        ...(input.locationType !== undefined ? { locationType: input.locationType } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.remoteLink !== undefined ? { remoteLink: input.remoteLink } : {}),
      },
      include: CALENDAR_EVENT_INCLUDE,
    });

    await appendCalendarEventAudit({
      calendarEventId: event.id,
      organizationId,
      action: "updated",
      actorType: actor.actorType,
      actorUserId: actor.actorUserId,
      fromStatus: existing.status as CalendarEventStatus,
      toStatus: existing.status as CalendarEventStatus,
      changesJson: input as Prisma.InputJsonValue,
      tx,
    });

    return event;
  };

  const updated =
    timeChanged && blocksAvailability
      ? await withOrganizationSchedulingLock(organizationId, runUpdate)
      : await prisma.$transaction(runUpdate);

  scheduleCalendarEventGoogleUpdateIfConfirmed({
    organizationId,
    calendarEventId: updated.id,
    status: updated.status,
    actor,
  });

  return updated;
}

export async function markCalendarEventPrerequisitePassed(
  organizationId: string,
  calendarEventId: string,
  prerequisiteId: string,
  actor: CalendarEventActor
): Promise<CalendarEventWithRelations> {
  await assertCalendarEngineWrite(organizationId);

  await prisma.$transaction(async (tx) => {
    await applyPrerequisitePassed({
      organizationId,
      calendarEventId,
      prerequisiteId,
      actor,
      tx,
    });
  });

  return requireCalendarEvent(organizationId, calendarEventId);
}

export async function transitionCalendarEventStatus(
  organizationId: string,
  calendarEventId: string,
  toStatus: CalendarEventStatus,
  actor: CalendarEventActor,
  options?: {
    completionNotes?: string | null;
    completionOutcome?: CompletionOutcome | null;
    now?: Date;
    skipFollowUpTask?: boolean;
    skipConflictCheck?: boolean;
  }
): Promise<CalendarEventWithRelations> {
  await assertCalendarEngineWrite(organizationId);

  const entersBlockingSchedule = BLOCKING_SCHEDULING_STATUSES.includes(toStatus);

  const runTransition = async (tx: Prisma.TransactionClient) => {
    if (entersBlockingSchedule && !options?.skipConflictCheck) {
      const event = await tx.calendarEvent.findFirst({
        where: { id: calendarEventId, organizationId },
        select: { id: true, startAt: true, endAt: true, assignedUserId: true },
      });
      if (!event) throw notFound("CalendarEvent");

      const conflict = await checkCalendarEventConflict({
        organizationId,
        startAt: event.startAt,
        endAt: event.endAt,
        excludeCalendarEventId: event.id,
        assignedUserId: event.assignedUserId,
      });
      if (conflict.hasConflict) {
        throw new CalendarEngineServiceError("TIME_CONFLICT", "Time conflict", {
          conflict: conflict.conflict,
        });
      }
    }

    return applyCalendarEventStatusTransition({
      organizationId,
      calendarEventId,
      toStatus,
      actor,
      completionNotes: options?.completionNotes,
      completionOutcome: options?.completionOutcome,
      now: options?.now,
      skipFollowUpTask: options?.skipFollowUpTask,
      tx,
    });
  };

  const record = entersBlockingSchedule
    ? await withOrganizationSchedulingLock(organizationId, runTransition)
    : await prisma.$transaction(runTransition);

  if (record.status === "confirmed") {
    scheduleCalendarEventGoogleMirrorOnConfirmed({
      organizationId,
      calendarEventId: record.id,
      actor,
    });
  }

  return requireCalendarEvent(organizationId, calendarEventId);
}

export type SubmitConfirmationResult =
  | { mode: "confirmed"; event: CalendarEventWithRelations }
  | { mode: "queued"; decisionId: string; queueType: "confirm_appointment" | "override_conflict" };

export async function submitCalendarEventForConfirmation(
  organizationId: string,
  calendarEventId: string,
  actor: CalendarEventActor,
  options?: { now?: Date; skipConflictCheck?: boolean; tx?: Prisma.TransactionClient }
): Promise<SubmitConfirmationResult> {
  await assertCalendarEngineWrite(organizationId);

  const autonomy = await getOrganizationAutonomy(organizationId);

  const run = async (tx: Prisma.TransactionClient): Promise<SubmitConfirmationResult> => {
    let event = await requireCalendarEvent(organizationId, calendarEventId, tx);

    if (event.status === "draft") {
      if (!allRequiredPrerequisitesPassed(event.prerequisitesJson)) {
        const failed = failedRequiredPrerequisites(event.prerequisitesJson);
        throw new CalendarEngineServiceError("VALIDATION_FAILED", "Required prerequisites are not complete", {
          failedPrerequisites: failed.map((item) => item.id),
        });
      }

      if (!options?.skipConflictCheck) {
        const conflict = await checkCalendarEventConflict({
          organizationId,
          startAt: event.startAt,
          endAt: event.endAt,
          excludeCalendarEventId: event.id,
          assignedUserId: event.assignedUserId,
        });

        if (conflict.hasConflict) {
          const decision = await createPendingDecision({
            organizationId,
            workCaseId: event.workCaseId,
            calendarEventId: event.id,
            type: "override_conflict",
            title: event.title ?? "אירוע יומן",
            reason: summaryConflictDetected(conflict.conflict?.clientName),
            preparedPayloadJson: {
              targetStatus: "confirmed",
              overrideConflict: true,
              conflict: conflict.conflict,
            },
            source: "system",
            actor,
            tx,
          });

          return { mode: "queued", decisionId: decision.id, queueType: "override_conflict" };
        }
      }

      await applyCalendarEventStatusTransition({
        organizationId,
        calendarEventId,
        toStatus: "pending_readiness",
        actor,
        now: options?.now,
        tx,
      });
      event = await requireCalendarEvent(organizationId, calendarEventId, tx);
    } else if (event.status !== "pending_readiness") {
      throw new CalendarEngineServiceError(
        "INVALID_TRANSITION",
        `Cannot submit event in status ${event.status} for confirmation`
      );
    }

    if (!allRequiredPrerequisitesPassed(event.prerequisitesJson)) {
      const failed = failedRequiredPrerequisites(event.prerequisitesJson);
      throw new CalendarEngineServiceError("VALIDATION_FAILED", "Required prerequisites are not complete", {
        failedPrerequisites: failed.map((item) => item.id),
      });
    }

    if (!options?.skipConflictCheck) {
      const conflict = await checkCalendarEventConflict({
        organizationId,
        startAt: event.startAt,
        endAt: event.endAt,
        excludeCalendarEventId: event.id,
        assignedUserId: event.assignedUserId,
      });

      if (conflict.hasConflict) {
        const decision = await createPendingDecision({
          organizationId,
          workCaseId: event.workCaseId,
          calendarEventId: event.id,
          type: "override_conflict",
          title: event.title ?? "אירוע יומן",
          reason: summaryConflictDetected(conflict.conflict?.clientName),
          preparedPayloadJson: {
            targetStatus: "confirmed",
            overrideConflict: true,
            conflict: conflict.conflict,
          },
          source: "system",
          actor,
          tx,
        });

        return { mode: "queued", decisionId: decision.id, queueType: "override_conflict" };
      }
    }

    if (autonomy.autoConfirmWhenFullyReady) {
      await applyCalendarEventStatusTransition({
        organizationId,
        calendarEventId,
        toStatus: "confirmed",
        actor,
        now: options?.now,
        tx,
      });
      const confirmed = await requireCalendarEvent(organizationId, calendarEventId, tx);
      return { mode: "confirmed", event: confirmed };
    }

    const decision = await createPendingDecision({
      organizationId,
      workCaseId: event.workCaseId,
      calendarEventId: event.id,
      type: "confirm_appointment",
      title: event.title ?? "אירוע יומן",
      reason: "נדרש אישור לפני אישור סופי של האירוע",
      preparedPayloadJson: { targetStatus: "confirmed" },
      source: "manual",
      actor,
      tx,
    });

    return { mode: "queued", decisionId: decision.id, queueType: "confirm_appointment" };
  };

  if (options?.tx) return run(options.tx);
  return withOrganizationSchedulingLock(organizationId, run);
}

async function assertNoPendingDecisionForEvent(
  organizationId: string,
  calendarEventId: string,
  types: DecisionQueueType[]
): Promise<void> {
  const pending = await prisma.ownerDecisionQueueItem.findFirst({
    where: {
      organizationId,
      calendarEventId,
      status: "pending",
      type: { in: types },
    },
    select: { id: true, type: true },
  });
  if (pending) {
    throw new CalendarEngineServiceError("VALIDATION_FAILED", "Pending decision already exists for this event", {
      pendingDecisionId: pending.id,
      pendingDecisionType: pending.type,
    });
  }
}

export type RequestDecisionResult = {
  decisionId: string;
  queueType: "cancel_appointment" | "reschedule_appointment";
};

export async function requestCalendarEventCancel(
  organizationId: string,
  calendarEventId: string,
  actor: CalendarEventActor,
  options?: { reason?: string | null }
): Promise<RequestDecisionResult> {
  await assertCalendarEngineWrite(organizationId);

  const event = await requireCalendarEvent(organizationId, calendarEventId);
  if (event.status !== "confirmed") {
    throw new CalendarEngineServiceError(
      "INVALID_TRANSITION",
      "Only confirmed events can request cancel approval",
      { status: event.status }
    );
  }

  await assertNoPendingDecisionForEvent(organizationId, calendarEventId, [
    "cancel_appointment",
    "reschedule_appointment",
  ]);

  const decision = await createPendingDecision({
    organizationId,
    workCaseId: event.workCaseId,
    calendarEventId: event.id,
    type: "cancel_appointment",
    title: event.title ?? "ביטול תור",
    reason: options?.reason?.trim() || "נדרש אישור לפני ביטול התור",
    preparedPayloadJson: { targetStatus: "cancelled" },
    source: "manual",
    actor,
  });

  return { decisionId: decision.id, queueType: "cancel_appointment" };
}

export async function requestCalendarEventReschedule(
  organizationId: string,
  calendarEventId: string,
  input: { startAt: Date; endAt: Date; reason?: string | null },
  actor: CalendarEventActor
): Promise<RequestDecisionResult> {
  await assertCalendarEngineWrite(organizationId);

  if (Number.isNaN(input.startAt.getTime()) || Number.isNaN(input.endAt.getTime())) {
    throw new CalendarEngineServiceError("VALIDATION_FAILED", "Invalid startAt or endAt");
  }
  if (input.endAt <= input.startAt) {
    throw new CalendarEngineServiceError("VALIDATION_FAILED", "endAt must be after startAt");
  }

  const event = await requireCalendarEvent(organizationId, calendarEventId);
  if (event.status !== "confirmed") {
    throw new CalendarEngineServiceError(
      "INVALID_TRANSITION",
      "Only confirmed events can request reschedule approval",
      { status: event.status }
    );
  }

  await assertNoPendingDecisionForEvent(organizationId, calendarEventId, [
    "cancel_appointment",
    "reschedule_appointment",
  ]);

  const decision = await createPendingDecision({
    organizationId,
    workCaseId: event.workCaseId,
    calendarEventId: event.id,
    type: "reschedule_appointment",
    title: event.title ?? "דחיית תור",
    reason: input.reason?.trim() || "נדרש אישור לפני דחיית התור",
    preparedPayloadJson: {
      startAt: input.startAt.toISOString(),
      endAt: input.endAt.toISOString(),
    },
    source: "manual",
    actor,
  });

  return { decisionId: decision.id, queueType: "reschedule_appointment" };
}

export async function completeCalendarEvent(
  organizationId: string,
  calendarEventId: string,
  input: { completionNotes: string; completionOutcome: CompletionOutcome },
  actor: CalendarEventActor,
  options?: { now?: Date }
): Promise<CalendarEventWithRelations> {
  await assertCalendarEngineWrite(organizationId);

  const event = await requireCalendarEvent(organizationId, calendarEventId);
  if (event.status !== "confirmed") {
    throw new CalendarEngineServiceError("INVALID_TRANSITION", "Only confirmed events can be completed", {
      status: event.status,
    });
  }

  const notes = input.completionNotes.trim();
  if (!notes) {
    throw new CalendarEngineServiceError("VALIDATION_FAILED", "completionNotes is required", {
      field: "completionNotes",
    });
  }

  await transitionCalendarEventStatus(organizationId, calendarEventId, "completed", actor, {
    completionNotes: notes,
    completionOutcome: input.completionOutcome,
    now: options?.now,
    skipFollowUpTask: true,
  });

  try {
    await spawnFollowUpTaskForCompletedEventIfEnabled({
      organizationId,
      calendarEventId,
      actor,
    });
  } catch (err) {
    await appendWorkCaseTimelineEntry({
      organizationId,
      workCaseId: event.workCaseId,
      calendarEventId: event.id,
      type: "note_added",
      summary: "יצירת משימת המשך נכשלה",
      actor,
      metaJson: {
        error: err instanceof Error ? err.message : String(err),
        followUpTaskFailed: true,
      },
    });
  }

  return requireCalendarEvent(organizationId, calendarEventId);
}

export async function markCalendarEventNoShow(
  organizationId: string,
  calendarEventId: string,
  input: { notes: string },
  actor: CalendarEventActor,
  options?: { now?: Date }
): Promise<CalendarEventWithRelations> {
  await assertCalendarEngineWrite(organizationId);

  const event = await requireCalendarEvent(organizationId, calendarEventId);
  if (event.status !== "confirmed") {
    throw new CalendarEngineServiceError("INVALID_TRANSITION", "Only confirmed events can be marked no_show", {
      status: event.status,
    });
  }

  const notes = input.notes.trim();
  if (!notes) {
    throw new CalendarEngineServiceError("VALIDATION_FAILED", "notes are required for no-show", {
      field: "notes",
    });
  }

  await transitionCalendarEventStatus(organizationId, calendarEventId, "no_show", actor, {
    completionNotes: notes,
    completionOutcome: "no_show",
    now: options?.now,
    skipFollowUpTask: true,
  });

  return requireCalendarEvent(organizationId, calendarEventId);
}

export { LifecycleError };
