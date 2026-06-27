import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { CalendarEventStatus, CompletionOutcome, EventSource } from "./enums.js";
import {
  validateCalendarEventTransition,
  isCalendarEventTerminal,
} from "./calendarEventLifecycle.js";
import { appendCalendarEventAudit } from "./auditWriter.js";
import { appendWorkCaseTimelineEntry } from "./timelineWriter.js";
import {
  summaryEventStatusChanged,
  summaryPrerequisitePassed,
  summaryTaskSpawned,
} from "./timelineSummaries.js";
import { parseCalendarAutonomyJson } from "./calendarAutonomy.js";
import { markPrerequisitePassed, parsePrerequisites } from "./prerequisites.js";
import { notFound } from "./serviceErrors.js";
import { LifecycleError } from "./lifecycleErrors.js";
import type { WorkCaseActor } from "./workCaseService.js";

export type CalendarEventActor = WorkCaseActor;

export type CalendarEventRecord = {
  id: string;
  organizationId: string;
  workCaseId: string;
  status: CalendarEventStatus;
  eventType: string;
  startAt: Date;
  endAt: Date;
  clientId: string | null;
  title: string | null;
  completionNotes: string | null;
  completionOutcome: CompletionOutcome | null;
};

export type TransitionCalendarEventInput = {
  organizationId: string;
  calendarEventId: string;
  toStatus: CalendarEventStatus;
  actor: CalendarEventActor;
  completionNotes?: string | null;
  completionOutcome?: CompletionOutcome | null;
  now?: Date;
  skipFollowUpTask?: boolean;
  tx: Prisma.TransactionClient;
};

export async function requireCalendarEventRecord(
  organizationId: string,
  calendarEventId: string,
  tx: Prisma.TransactionClient
): Promise<CalendarEventRecord> {
  const event = await tx.calendarEvent.findFirst({
    where: { id: calendarEventId, organizationId },
    select: {
      id: true,
      organizationId: true,
      workCaseId: true,
      status: true,
      eventType: true,
      startAt: true,
      endAt: true,
      clientId: true,
      title: true,
      completionNotes: true,
      completionOutcome: true,
    },
  });
  if (!event) throw notFound("CalendarEvent");
  return {
    ...event,
    status: event.status as CalendarEventStatus,
    completionOutcome: event.completionOutcome as CompletionOutcome | null,
  };
}

export async function applyCalendarEventStatusTransition(
  input: TransitionCalendarEventInput
): Promise<CalendarEventRecord> {
  const event = await requireCalendarEventRecord(
    input.organizationId,
    input.calendarEventId,
    input.tx
  );
  const fromStatus = event.status;
  const now = input.now ?? new Date();

  validateCalendarEventTransition(fromStatus, input.toStatus, {
    now,
    startAt: event.startAt,
    workCaseId: event.workCaseId,
    clientId: event.clientId,
    eventType: event.eventType,
    completionNotes: input.completionNotes ?? event.completionNotes,
    completionOutcome: input.completionOutcome ?? event.completionOutcome,
  });

  const updated = await input.tx.calendarEvent.update({
    where: { id: event.id },
    data: {
      status: input.toStatus,
      ...(input.completionNotes !== undefined ? { completionNotes: input.completionNotes } : {}),
      ...(input.completionOutcome !== undefined ? { completionOutcome: input.completionOutcome } : {}),
    },
    select: {
      id: true,
      organizationId: true,
      workCaseId: true,
      status: true,
      eventType: true,
      startAt: true,
      endAt: true,
      clientId: true,
      title: true,
      completionNotes: true,
      completionOutcome: true,
    },
  });

  const record: CalendarEventRecord = {
    ...updated,
    status: updated.status as CalendarEventStatus,
    completionOutcome: updated.completionOutcome as CompletionOutcome | null,
  };

  await appendCalendarEventAudit({
    calendarEventId: record.id,
    organizationId: input.organizationId,
    action: "status_changed",
    actorType: input.actor.actorType,
    actorUserId: input.actor.actorUserId,
    fromStatus,
    toStatus: input.toStatus,
    tx: input.tx,
  });

  const timelineType =
    input.toStatus === "completed"
      ? "event_completed"
      : input.toStatus === "cancelled"
        ? "event_cancelled"
        : input.toStatus === "no_show"
          ? "event_no_show"
          : input.toStatus === "rescheduled"
            ? "event_rescheduled"
            : "status_changed";

  await appendWorkCaseTimelineEntry({
    organizationId: input.organizationId,
    workCaseId: record.workCaseId,
    calendarEventId: record.id,
    type: timelineType,
    summary: summaryEventStatusChanged(fromStatus, input.toStatus),
    actor: input.actor,
    metaJson: { fromStatus, toStatus: input.toStatus },
    tx: input.tx,
  });

  if (input.toStatus === "completed" && !input.skipFollowUpTask) {
    await maybeSpawnFollowUpTask({
      organizationId: input.organizationId,
      event: record,
      actor: input.actor,
      tx: input.tx,
    });
  }

  return record;
}

export async function spawnFollowUpTaskForCompletedEventIfEnabled(params: {
  organizationId: string;
  calendarEventId: string;
  actor: CalendarEventActor;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const event = await requireCalendarEventRecord(
      params.organizationId,
      params.calendarEventId,
      tx
    );
    if (event.status !== "completed") {
      return;
    }
    await maybeSpawnFollowUpTask({
      organizationId: params.organizationId,
      event,
      actor: params.actor,
      tx,
    });
  });
}

async function maybeSpawnFollowUpTask(params: {
  organizationId: string;
  event: CalendarEventRecord;
  actor: CalendarEventActor;
  tx: Prisma.TransactionClient;
}) {
  const org = await params.tx.organization.findFirst({
    where: { id: params.organizationId },
    select: { calendarAutonomyJson: true },
  });
  const autonomy = parseCalendarAutonomyJson(org?.calendarAutonomyJson);
  if (!autonomy.autoCreateFollowUpTask) return;

  const title = params.event.title?.trim()
    ? `מעקב לאחר ${params.event.title.trim()}`
    : "מעקב לאחר אירוע";

  const task = await params.tx.task.create({
    data: {
      organizationId: params.organizationId,
      clientId: params.event.clientId,
      workCaseId: params.event.workCaseId,
      calendarEventId: params.event.id,
      title,
      source: "post_event",
      status: "open",
      priority: "medium",
    },
  });

  await appendWorkCaseTimelineEntry({
    organizationId: params.organizationId,
    workCaseId: params.event.workCaseId,
    calendarEventId: params.event.id,
    type: "task_spawned",
    summary: summaryTaskSpawned(task.title),
    actor: params.actor,
    metaJson: { taskId: task.id },
    tx: params.tx,
  });
}

export async function applyPrerequisitePassed(params: {
  organizationId: string;
  calendarEventId: string;
  prerequisiteId: string;
  actor: CalendarEventActor;
  tx: Prisma.TransactionClient;
}) {
  const event = await params.tx.calendarEvent.findFirst({
    where: { id: params.calendarEventId, organizationId: params.organizationId },
    select: { id: true, workCaseId: true, prerequisitesJson: true },
  });
  if (!event) throw notFound("CalendarEvent");

  const next = markPrerequisitePassed(event.prerequisitesJson, params.prerequisiteId);
  const passedItem = parsePrerequisites(next).find((item) => item.id === params.prerequisiteId);

  await params.tx.calendarEvent.update({
    where: { id: event.id },
    data: { prerequisitesJson: next },
  });

  await appendCalendarEventAudit({
    calendarEventId: event.id,
    organizationId: params.organizationId,
    action: "prerequisite_passed",
    actorType: params.actor.actorType,
    actorUserId: params.actor.actorUserId,
    changesJson: { prerequisiteId: params.prerequisiteId },
    tx: params.tx,
  });

  await appendWorkCaseTimelineEntry({
    organizationId: params.organizationId,
    workCaseId: event.workCaseId,
    calendarEventId: event.id,
    type: "prerequisite_passed",
    summary: summaryPrerequisitePassed(passedItem?.label ?? params.prerequisiteId),
    actor: params.actor,
    metaJson: { prerequisiteId: params.prerequisiteId },
    tx: params.tx,
  });
}

export { isCalendarEventTerminal, LifecycleError };
