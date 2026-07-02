import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertCalendarEngineRead, assertCalendarEngineWrite } from "./calendarEngineFlags.js";
import {
  applyCalendarEventStatusTransition,
  type CalendarEventActor,
} from "./calendarEventMutations.js";
import { checkCalendarEventConflict } from "./calendarEventConflict.js";
import type { CalendarEventStatus, DecisionQueueType } from "./enums.js";
import {
  validateDecisionQueueApprove,
  validateDecisionQueueReject,
  validateDecisionQueueSupersede,
} from "./decisionQueueLifecycle.js";
import { LifecycleError } from "./lifecycleErrors.js";
import { setWorkCaseInvoiceDraftRequested } from "./workCaseService.js";
import { CalendarEngineServiceError, notFound } from "./serviceErrors.js";
import { appendWorkCaseTimelineEntry } from "./timelineWriter.js";
import {
  summaryApprovalGranted,
  summaryApprovalRejected,
  summaryApprovalRequested,
  summaryFollowUpMessageStub,
  summaryInvoiceRequested,
} from "./timelineSummaries.js";
import { scheduleDecisionGoogleMirrorSideEffects } from "./calendarGoogleMirrorService.js";
import { recordCalendarAudit } from "./calendarAudit.js";

const DECISION_INCLUDE = {
  workCase: { select: { id: true, title: true } },
  calendarEvent: {
    select: {
      id: true,
      status: true,
      title: true,
      startAt: true,
      endAt: true,
      assignedUserId: true,
    },
  },
} as const;

export type DecisionQueueItemWithRelations = Prisma.OwnerDecisionQueueItemGetPayload<{
  include: typeof DECISION_INCLUDE;
}>;

export type CreatePendingDecisionInput = {
  organizationId: string;
  workCaseId: string;
  calendarEventId?: string | null;
  type: DecisionQueueType;
  title: string;
  reason?: string | null;
  preparedPayloadJson?: Prisma.InputJsonValue;
  source: "manual" | "natalie_command" | "system";
  actor: CalendarEventActor;
  tx?: Prisma.TransactionClient;
};

async function requireDecision(
  organizationId: string,
  decisionId: string,
  tx?: Prisma.TransactionClient
): Promise<DecisionQueueItemWithRelations> {
  const client = tx ?? prisma;
  const item = await client.ownerDecisionQueueItem.findFirst({
    where: { id: decisionId, organizationId },
    include: DECISION_INCLUDE,
  });
  if (!item) throw notFound("OwnerDecisionQueueItem");
  return item;
}

export async function createPendingDecision(
  input: CreatePendingDecisionInput
): Promise<DecisionQueueItemWithRelations> {
  await assertCalendarEngineWrite(input.organizationId);

  const write = async (tx: Prisma.TransactionClient) => {
    const workCase = await tx.workCase.findFirst({
      where: { id: input.workCaseId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!workCase) throw notFound("WorkCase");

    if (input.calendarEventId) {
      const event = await tx.calendarEvent.findFirst({
        where: {
          id: input.calendarEventId,
          organizationId: input.organizationId,
          workCaseId: input.workCaseId,
        },
        select: { id: true },
      });
      if (!event) throw notFound("CalendarEvent");
    }

    const item = await tx.ownerDecisionQueueItem.create({
      data: {
        organizationId: input.organizationId,
        workCaseId: input.workCaseId,
        calendarEventId: input.calendarEventId ?? null,
        type: input.type,
        status: "pending",
        title: input.title,
        reason: input.reason ?? null,
        preparedPayloadJson: input.preparedPayloadJson ?? undefined,
        source: input.source,
      },
      include: DECISION_INCLUDE,
    });

    await appendWorkCaseTimelineEntry({
      organizationId: input.organizationId,
      workCaseId: input.workCaseId,
      calendarEventId: input.calendarEventId ?? null,
      type: "approval_requested",
      summary: summaryApprovalRequested(input.type, input.title),
      actor: input.actor,
      metaJson: { decisionId: item.id, decisionType: input.type },
      tx,
    });

    recordCalendarAudit({
      organizationId: input.organizationId,
      entityType: "decision_queue",
      entityId: item.id,
      action: "calendar_decision_created",
      actor: {
        actorType: input.actor.actorType === "user" ? "user" : input.actor.actorType === "natalie" ? "natalie" : "system",
        actorUserId: input.actor.actorUserId ?? null,
      },
      sourceModule: "calendar-decision-queue",
      metadata: {
        decisionId: item.id,
        decisionType: item.type,
        calendarEventId: item.calendarEventId,
      },
    });
    return item;
  };

  if (input.tx) return write(input.tx);
  return prisma.$transaction(write);
}

export async function getDecisionQueueItemById(
  organizationId: string,
  decisionId: string
): Promise<DecisionQueueItemWithRelations> {
  await assertCalendarEngineRead(organizationId);
  return requireDecision(organizationId, decisionId);
}

type ExecutionResult = {
  decisionId: string;
  type: DecisionQueueType;
  executed: boolean;
  result?: Record<string, unknown>;
};

async function executeApprovedDecision(
  item: DecisionQueueItemWithRelations,
  actor: CalendarEventActor,
  tx: Prisma.TransactionClient
): Promise<Record<string, unknown>> {
  const payload = (item.preparedPayloadJson ?? {}) as Record<string, unknown>;

  switch (item.type) {
    case "confirm_appointment":
    case "override_conflict": {
      if (!item.calendarEventId) {
        throw new CalendarEngineServiceError("VALIDATION_FAILED", "Decision is missing calendarEventId");
      }

      const overrideConflict = item.type === "override_conflict" || payload.overrideConflict === true;
      if (!overrideConflict) {
        const event = await tx.calendarEvent.findFirst({
          where: { id: item.calendarEventId, organizationId: item.organizationId },
          select: { startAt: true, endAt: true, assignedUserId: true },
        });
        if (!event) throw notFound("CalendarEvent");

        const conflict = await checkCalendarEventConflict({
          organizationId: item.organizationId,
          startAt: event.startAt,
          endAt: event.endAt,
          excludeCalendarEventId: item.calendarEventId,
          assignedUserId: event.assignedUserId,
        });
        if (conflict.hasConflict) {
          throw new CalendarEngineServiceError("TIME_CONFLICT", "Time conflict still exists", {
            conflict: conflict.conflict,
          });
        }
      }

      await applyCalendarEventStatusTransition({
        organizationId: item.organizationId,
        calendarEventId: item.calendarEventId,
        toStatus: "confirmed",
        actor,
        tx,
      });

      return { calendarEventId: item.calendarEventId, status: "confirmed" };
    }

    case "cancel_appointment": {
      if (!item.calendarEventId) {
        throw new CalendarEngineServiceError("VALIDATION_FAILED", "Decision is missing calendarEventId");
      }
      await applyCalendarEventStatusTransition({
        organizationId: item.organizationId,
        calendarEventId: item.calendarEventId,
        toStatus: "cancelled",
        actor,
        tx,
      });
      return { calendarEventId: item.calendarEventId, status: "cancelled" };
    }

    case "reschedule_appointment": {
      if (!item.calendarEventId) {
        throw new CalendarEngineServiceError("VALIDATION_FAILED", "Decision is missing calendarEventId");
      }
      const startAt = payload.startAt ? new Date(String(payload.startAt)) : null;
      const endAt = payload.endAt ? new Date(String(payload.endAt)) : null;
      if (!startAt || !endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        throw new CalendarEngineServiceError("VALIDATION_FAILED", "Reschedule payload requires startAt and endAt");
      }

      const existing = await tx.calendarEvent.findFirst({
        where: { id: item.calendarEventId, organizationId: item.organizationId },
        select: {
          id: true,
          organizationId: true,
          workCaseId: true,
          eventType: true,
          title: true,
          timezone: true,
          clientId: true,
          leadId: true,
          assignedUserId: true,
          serviceId: true,
          source: true,
          createdByUserId: true,
        },
      });
      if (!existing) throw notFound("CalendarEvent");

      const conflict = await checkCalendarEventConflict({
        organizationId: item.organizationId,
        startAt,
        endAt,
        excludeCalendarEventId: existing.id,
        assignedUserId: existing.assignedUserId,
      });
      if (conflict.hasConflict) {
        throw new CalendarEngineServiceError("TIME_CONFLICT", "Time conflict still exists", {
          conflict: conflict.conflict,
        });
      }

      await applyCalendarEventStatusTransition({
        organizationId: item.organizationId,
        calendarEventId: existing.id,
        toStatus: "rescheduled",
        actor,
        tx,
      });

      const successor = await tx.calendarEvent.create({
        data: {
          organizationId: existing.organizationId,
          workCaseId: existing.workCaseId,
          eventType: existing.eventType,
          title: existing.title,
          startAt,
          endAt,
          timezone: existing.timezone,
          clientId: existing.clientId,
          leadId: existing.leadId,
          assignedUserId: existing.assignedUserId,
          serviceId: existing.serviceId,
          source: existing.source,
          createdByUserId: existing.createdByUserId,
          status: "pending_readiness",
          rescheduledFromId: existing.id,
        },
      });

      return { oldCalendarEventId: existing.id, newCalendarEventId: successor.id };
    }

    case "create_invoice_placeholder": {
      await setWorkCaseInvoiceDraftRequested(item.organizationId, item.workCaseId, actor, tx);
      await appendWorkCaseTimelineEntry({
        organizationId: item.organizationId,
        workCaseId: item.workCaseId,
        calendarEventId: item.calendarEventId,
        type: "invoice_requested",
        summary: summaryInvoiceRequested(),
        actor,
        metaJson: { decisionId: item.id },
        tx,
      });
      return { invoiceDraftRequested: true };
    }

    case "send_follow_up_message": {
      await appendWorkCaseTimelineEntry({
        organizationId: item.organizationId,
        workCaseId: item.workCaseId,
        calendarEventId: item.calendarEventId,
        type: "note_added",
        summary: summaryFollowUpMessageStub(),
        actor,
        metaJson: {
          decisionId: item.id,
          messageDraft: payload.messageDraft ?? null,
          stub: true,
        },
        tx,
      });
      return { stub: true, messageDraft: payload.messageDraft ?? null };
    }

    default:
      throw new CalendarEngineServiceError("VALIDATION_FAILED", `Unsupported decision type: ${item.type}`);
  }
}

export async function approveDecisionQueueItem(
  organizationId: string,
  decisionId: string,
  actor: CalendarEventActor,
  options?: { resolvedByUserId?: string | null; resolutionNote?: string | null }
): Promise<ExecutionResult> {
  await assertCalendarEngineWrite(organizationId);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`calendar-engine:${organizationId}`}))`;
    const item = await requireDecision(organizationId, decisionId, tx);

    if (item.status === "approved") {
      return {
        decisionId: item.id,
        type: item.type,
        executed: false,
        result: (item.metaJson as Record<string, unknown> | null)?.executionResult as
          | Record<string, unknown>
          | undefined,
      };
    }

    validateDecisionQueueApprove(item.status, {
      calendarEventStatus: item.calendarEvent?.status as CalendarEventStatus | undefined,
    });

    let executionResult: Record<string, unknown>;
    try {
      executionResult = await executeApprovedDecision(item, actor, tx);
    } catch (err) {
      recordCalendarAudit({
        organizationId,
        entityType: "decision_queue",
        entityId: item.id,
        action: "calendar_decision_execution_failed",
        actor: { actorType: actor.actorType, actorUserId: actor.actorUserId ?? null },
        sourceModule: "calendar-decision-queue",
        reason: err instanceof Error ? err.message : String(err),
        metadata: {
          decisionId: item.id,
          decisionType: item.type,
          calendarEventId: item.calendarEventId,
        },
      });
      throw err;
    }

    await tx.ownerDecisionQueueItem.update({
      where: { id: item.id },
      data: {
        status: "approved",
        resolvedAt: new Date(),
        resolvedByUserId: options?.resolvedByUserId ?? actor.actorUserId ?? null,
        resolutionNote: options?.resolutionNote ?? null,
        executionIdempotencyKey: item.executionIdempotencyKey ?? item.id,
        metaJson: {
          ...(typeof item.metaJson === "object" && item.metaJson ? (item.metaJson as object) : {}),
          executionResult,
        } as Prisma.InputJsonValue,
      },
    });

    await appendWorkCaseTimelineEntry({
      organizationId,
      workCaseId: item.workCaseId,
      calendarEventId: item.calendarEventId,
      type: "approval_granted",
      summary: summaryApprovalGranted(item.type),
      actor,
      metaJson: {
        decisionId: item.id,
        decisionType: item.type,
        executionResult,
      } as Prisma.InputJsonValue,
      tx,
    });

    const response = {
      decisionId: item.id,
      type: item.type,
      executed: true,
      result: executionResult,
    };
    recordCalendarAudit({
      organizationId,
      entityType: "decision_queue",
      entityId: item.id,
      action: "calendar_decision_approved",
      actor: { actorType: actor.actorType, actorUserId: actor.actorUserId ?? null },
      sourceModule: "calendar-decision-queue",
      metadata: {
        decisionId: item.id,
        decisionType: item.type,
        executed: true,
      },
    });
    return response;
  });

  scheduleDecisionGoogleMirrorSideEffects({
    organizationId,
    decisionType: result.type,
    executed: result.executed,
    result: result.result,
    actor,
  });

  return result;
}

export async function rejectDecisionQueueItem(
  organizationId: string,
  decisionId: string,
  actor: CalendarEventActor,
  options?: { resolvedByUserId?: string | null; resolutionNote?: string | null }
): Promise<DecisionQueueItemWithRelations> {
  await assertCalendarEngineWrite(organizationId);

  return prisma.$transaction(async (tx) => {
    const item = await requireDecision(organizationId, decisionId, tx);
    validateDecisionQueueReject(item.status);

    const updated = await tx.ownerDecisionQueueItem.update({
      where: { id: item.id },
      data: {
        status: "rejected",
        resolvedAt: new Date(),
        resolvedByUserId: options?.resolvedByUserId ?? actor.actorUserId ?? null,
        resolutionNote: options?.resolutionNote ?? null,
      },
      include: DECISION_INCLUDE,
    });

    await appendWorkCaseTimelineEntry({
      organizationId,
      workCaseId: item.workCaseId,
      calendarEventId: item.calendarEventId,
      type: "approval_rejected",
      summary: summaryApprovalRejected(item.type, options?.resolutionNote),
      actor,
      metaJson: { decisionId: item.id, decisionType: item.type },
      tx,
    });

    recordCalendarAudit({
      organizationId,
      entityType: "decision_queue",
      entityId: item.id,
      action: "calendar_decision_rejected",
      actor: { actorType: actor.actorType, actorUserId: actor.actorUserId ?? null },
      sourceModule: "calendar-decision-queue",
      reason: options?.resolutionNote ?? null,
      metadata: {
        decisionId: item.id,
        decisionType: item.type,
      },
    });
    return updated;
  });
}

export async function supersedeDecisionQueueItem(
  organizationId: string,
  decisionId: string,
  actor: CalendarEventActor
): Promise<DecisionQueueItemWithRelations> {
  await assertCalendarEngineWrite(organizationId);

  return prisma.$transaction(async (tx) => {
    const item = await requireDecision(organizationId, decisionId, tx);
    validateDecisionQueueSupersede(item.status);

    const updated = await tx.ownerDecisionQueueItem.update({
      where: { id: item.id },
      data: { status: "superseded", resolvedAt: new Date() },
      include: DECISION_INCLUDE,
    });
    recordCalendarAudit({
      organizationId,
      entityType: "decision_queue",
      entityId: item.id,
      action: "calendar_decision_expired",
      actor: { actorType: actor.actorType, actorUserId: actor.actorUserId ?? null },
      sourceModule: "calendar-decision-queue",
      metadata: {
        decisionId: item.id,
        decisionType: item.type,
      },
    });
    return updated;
  });
}

export { LifecycleError };
