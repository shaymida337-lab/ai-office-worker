import { prisma } from "../../lib/prisma.js";
import { createPendingDecision } from "./decisionQueueService.js";
import {
  createDraftCalendarEvent,
  getCalendarEventById,
  requestCalendarEventCancel,
  requestCalendarEventReschedule,
  transitionCalendarEventStatus,
  updateCalendarEventFields,
  type CalendarEventWithRelations,
} from "./calendarEventService.js";
import type { CalendarEventActor } from "./calendarEventMutations.js";
import { detectConflicts } from "./calendarEngineConflict.js";
import {
  runCalendarEngineIdempotent,
  toIdempotencyFailure,
} from "./calendarEngineIdempotency.js";
import { classifyCalendarEngineError, runCalendarEngineOperation } from "./calendarEngineReliability.js";
import { validateEvent } from "./calendarEngineValidation.js";
import { scheduleCalendarGoogleSyncViaPort } from "./calendarGoogleSyncPort.js";
import type {
  CalendarEngineCancelResult,
  CalendarEngineCreateResult,
  CalendarEngineDeleteResult,
  CalendarEngineEventInput,
  CalendarEngineFailure,
  CalendarEngineMoveResult,
  CalendarEngineOperationResult,
  CalendarEngineRequestContext,
  CalendarEngineRestoreResult,
  CalendarEngineUpdateResult,
} from "./calendarEngineTypes.js";
import { CalendarEngineServiceError } from "./serviceErrors.js";
import type { CalendarEventStatus } from "./enums.js";

const BLOCKING_SCHEDULING_STATUSES: CalendarEventStatus[] = ["pending_readiness", "confirmed"];

function actorFromEngine(ctx: CalendarEngineRequestContext): CalendarEventActor {
  return {
    actorType: ctx.actor.actorType,
    actorUserId: ctx.actor.actorUserId,
  };
}

function success<T>(
  data: T,
  correlationId: string,
  durationMs: number,
  idempotentReplay?: boolean
): CalendarEngineOperationResult<T> {
  return { ok: true, data, correlationId, durationMs, idempotentReplay };
}

function failure(
  err: unknown,
  correlationId: string,
  durationMs: number,
  extras?: Partial<CalendarEngineFailure>
): CalendarEngineFailure {
  if (err instanceof CalendarEngineServiceError) {
    return {
      ok: false,
      code: err.code,
      message: err.message,
      classification: classifyCalendarEngineError(err),
      correlationId,
      durationMs,
      details: err.details,
      ...extras,
    };
  }
  return {
    ok: false,
    code: "CALENDAR_ENGINE_ERROR",
    message: err instanceof Error ? err.message : String(err),
    classification: classifyCalendarEngineError(err),
    correlationId,
    durationMs,
    ...extras,
  };
}

async function guardValidationAndConflicts(params: {
  ctx: CalendarEngineRequestContext;
  input: CalendarEngineEventInput;
  excludeCalendarEventId?: string;
}): Promise<CalendarEngineFailure | null> {
  const validation = await validateEvent({
    organizationId: params.ctx.organizationId,
    input: params.input,
    excludeCalendarEventId: params.excludeCalendarEventId,
    now: params.ctx.now,
  });
  if (!validation.valid) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: validation.issues[0]?.message ?? "Validation failed",
      classification: "validation",
      correlationId: params.ctx.correlationId ?? "",
      durationMs: 0,
      validation,
    };
  }

  const conflict = await detectConflicts({
    organizationId: params.ctx.organizationId,
    input: params.input,
    excludeCalendarEventId: params.excludeCalendarEventId,
    now: params.ctx.now,
  });
  if (conflict.hasConflict) {
    return {
      ok: false,
      code: "TIME_CONFLICT",
      message: conflict.conflicts[0]?.message ?? "Scheduling conflict detected",
      classification: "conflict",
      correlationId: params.ctx.correlationId ?? "",
      durationMs: 0,
      conflict,
    };
  }

  return null;
}

export async function calendarEngineValidateEvent(
  ctx: CalendarEngineRequestContext,
  input: CalendarEngineEventInput,
  options?: { excludeCalendarEventId?: string }
): Promise<CalendarEngineOperationResult<ReturnType<typeof validateEvent> extends Promise<infer R> ? R : never>> {
  try {
    const { result, correlationId, durationMs } = await runCalendarEngineOperation({
      operation: "validate",
      ctx,
      execute: () =>
        validateEvent({
          organizationId: ctx.organizationId,
          input,
          excludeCalendarEventId: options?.excludeCalendarEventId,
          now: ctx.now,
        }),
    });
    return success(result, correlationId, durationMs);
  } catch (err) {
    return failure(err, ctx.correlationId ?? "", 0);
  }
}

export async function calendarEngineDetectConflicts(
  ctx: CalendarEngineRequestContext,
  input: Pick<CalendarEngineEventInput, "startAt" | "endAt" | "clientId" | "assignedUserId" | "serviceId">,
  options?: { excludeCalendarEventId?: string; excludeAppointmentId?: string }
): Promise<CalendarEngineOperationResult<Awaited<ReturnType<typeof detectConflicts>>>> {
  try {
    const { result, correlationId, durationMs } = await runCalendarEngineOperation({
      operation: "detect_conflicts",
      ctx,
      execute: () =>
        detectConflicts({
          organizationId: ctx.organizationId,
          input,
          excludeCalendarEventId: options?.excludeCalendarEventId,
          excludeAppointmentId: options?.excludeAppointmentId,
          now: ctx.now,
        }),
    });
    return success(result, correlationId, durationMs);
  } catch (err) {
    return failure(err, ctx.correlationId ?? "", 0);
  }
}

export async function calendarEngineCreateEvent(
  ctx: CalendarEngineRequestContext,
  input: CalendarEngineEventInput
): Promise<CalendarEngineOperationResult<CalendarEngineCreateResult>> {
  const guard = await guardValidationAndConflicts({ ctx, input });
  if (guard) return guard;

  try {
    const idempotent = await runCalendarEngineIdempotent({
      organizationId: ctx.organizationId,
      operation: "create",
      idempotencyKey: ctx.idempotencyKey,
      payload: input,
      execute: async () => {
        const { result, correlationId, durationMs } = await runCalendarEngineOperation({
          operation: "create",
          ctx,
          auditAction: "appointment_created",
          execute: async () =>
            createDraftCalendarEvent(ctx.organizationId, input, actorFromEngine(ctx)),
          buildAfterState: (event) => serializeEventSnapshot(event),
        });
        return { event: result, correlationId, durationMs };
      },
    });

    const { event, correlationId, durationMs } = idempotent.result;
    await scheduleCalendarGoogleSyncViaPort({
      organizationId: ctx.organizationId,
      calendarEventId: event.id,
      action: "create",
      actor: actorFromEngine(ctx),
      correlationId,
    });

    return success(event, correlationId, durationMs, idempotent.replay);
  } catch (err) {
    const idempotencyFailure = toIdempotencyFailure(err);
    if (idempotencyFailure) return idempotencyFailure;
    return failure(err, ctx.correlationId ?? "", 0);
  }
}

export async function calendarEngineUpdateEvent(
  ctx: CalendarEngineRequestContext,
  calendarEventId: string,
  patch: Parameters<typeof updateCalendarEventFields>[2]
): Promise<CalendarEngineOperationResult<CalendarEngineUpdateResult>> {
  const existing = await getCalendarEventById(ctx.organizationId, calendarEventId).catch(() => null);
  if (!existing) {
    return failure(new CalendarEngineServiceError("NOT_FOUND", "CalendarEvent not found"), ctx.correlationId ?? "", 0);
  }

  const nextStart = patch.startAt ?? existing.startAt;
  const nextEnd = patch.endAt ?? existing.endAt;
  const timeChanged =
    (patch.startAt && patch.startAt.getTime() !== existing.startAt.getTime()) ||
    (patch.endAt && patch.endAt.getTime() !== existing.endAt.getTime());
  const blocksAvailability = BLOCKING_SCHEDULING_STATUSES.includes(existing.status as CalendarEventStatus);

  if (timeChanged && blocksAvailability) {
    const guard = await guardValidationAndConflicts({
      ctx,
      input: {
        startAt: nextStart,
        endAt: nextEnd,
        clientId: patch.clientId ?? existing.clientId,
        assignedUserId: patch.assignedUserId ?? existing.assignedUserId,
        serviceId: patch.serviceId ?? existing.serviceId,
        source: existing.source,
      },
      excludeCalendarEventId: calendarEventId,
    });
    if (guard) return guard;
  }

  try {
    const { result, correlationId, durationMs } = await runCalendarEngineOperation({
      operation: "update",
      ctx,
      entityId: calendarEventId,
      beforeState: serializeEventSnapshot(existing),
      auditAction: "appointment_updated",
      execute: () => updateCalendarEventFields(ctx.organizationId, calendarEventId, patch, actorFromEngine(ctx)),
      buildAfterState: serializeEventSnapshot,
    });
    return success(result, correlationId, durationMs);
  } catch (err) {
    return failure(err, ctx.correlationId ?? "", 0);
  }
}

export async function calendarEngineMoveEvent(
  ctx: CalendarEngineRequestContext,
  calendarEventId: string,
  input: { startAt: Date; endAt: Date; reason?: string | null }
): Promise<CalendarEngineOperationResult<CalendarEngineMoveResult>> {
  const existing = await getCalendarEventById(ctx.organizationId, calendarEventId).catch(() => null);
  if (!existing) {
    return failure(new CalendarEngineServiceError("NOT_FOUND", "CalendarEvent not found"), ctx.correlationId ?? "", 0);
  }

  const blocksAvailability = BLOCKING_SCHEDULING_STATUSES.includes(existing.status as CalendarEventStatus);
  if (blocksAvailability) {
    const guard = await guardValidationAndConflicts({
      ctx,
      input: {
        startAt: input.startAt,
        endAt: input.endAt,
        clientId: existing.clientId,
        assignedUserId: existing.assignedUserId,
        serviceId: existing.serviceId,
        source: existing.source,
      },
      excludeCalendarEventId: calendarEventId,
    });
    if (guard) return guard;
  }

  try {
    const idempotent = await runCalendarEngineIdempotent({
      organizationId: ctx.organizationId,
      operation: "move",
      idempotencyKey: ctx.idempotencyKey,
      payload: { calendarEventId, ...input },
      execute: async () => {
        if (existing.status === "confirmed") {
          const decision = await requestCalendarEventReschedule(
            ctx.organizationId,
            calendarEventId,
            input,
            actorFromEngine(ctx)
          );
          return {
            event: await getCalendarEventById(ctx.organizationId, calendarEventId),
            decision,
          };
        }

        const { result, correlationId, durationMs } = await runCalendarEngineOperation({
          operation: "move",
          ctx,
          entityId: calendarEventId,
          beforeState: serializeEventSnapshot(existing),
          auditAction: "appointment_rescheduled",
          execute: () =>
            updateCalendarEventFields(
              ctx.organizationId,
              calendarEventId,
              { startAt: input.startAt, endAt: input.endAt },
              actorFromEngine(ctx)
            ),
          buildAfterState: serializeEventSnapshot,
        });
        return { event: result, correlationId, durationMs };
      },
    });

    const { event, correlationId, durationMs } = normalizeMoveResult(idempotent.result);
    const decision =
      "decision" in idempotent.result
        ? (idempotent.result.decision as { decisionId: string; queueType: string })
        : undefined;
    await scheduleCalendarGoogleSyncViaPort({
      organizationId: ctx.organizationId,
      calendarEventId: event.id,
      action: "update",
      actor: actorFromEngine(ctx),
      correlationId,
    });
    return success(
      {
        ...event,
        ...(decision
          ? { decisionId: decision.decisionId, queueType: decision.queueType }
          : {}),
      },
      correlationId,
      durationMs,
      idempotent.replay
    );
  } catch (err) {
    const idempotencyFailure = toIdempotencyFailure(err);
    if (idempotencyFailure) return idempotencyFailure;
    return failure(err, ctx.correlationId ?? "", 0);
  }
}

async function assertNoPendingCancelOrRescheduleDecision(
  organizationId: string,
  calendarEventId: string
): Promise<void> {
  const pending = await prisma.ownerDecisionQueueItem.findFirst({
    where: {
      organizationId,
      calendarEventId,
      status: "pending",
      type: { in: ["cancel_appointment", "reschedule_appointment"] },
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

export async function calendarEngineCancelEvent(
  ctx: CalendarEngineRequestContext,
  calendarEventId: string,
  options?: {
    reason?: string | null;
    queueNonConfirmed?: boolean;
    nonConfirmedDecisionSource?: "manual" | "natalie_command";
    nonConfirmedReason?: string;
  }
): Promise<CalendarEngineOperationResult<CalendarEngineCancelResult>> {
  const existing = await getCalendarEventById(ctx.organizationId, calendarEventId).catch(() => null);
  if (!existing) {
    return failure(new CalendarEngineServiceError("NOT_FOUND", "CalendarEvent not found"), ctx.correlationId ?? "", 0);
  }

  try {
    const idempotent = await runCalendarEngineIdempotent({
      organizationId: ctx.organizationId,
      operation: "cancel",
      idempotencyKey: ctx.idempotencyKey,
      payload: { calendarEventId, reason: options?.reason },
      execute: async () => {
        if (existing.status === "confirmed") {
          const decision = await requestCalendarEventCancel(
            ctx.organizationId,
            calendarEventId,
            actorFromEngine(ctx),
            options
          );
          return { status: existing.status, decisionId: decision.decisionId, queueType: decision.queueType };
        }

        if (
          options?.queueNonConfirmed &&
          (existing.status === "draft" || existing.status === "pending_readiness")
        ) {
          await assertNoPendingCancelOrRescheduleDecision(ctx.organizationId, calendarEventId);
          const decision = await createPendingDecision({
            organizationId: ctx.organizationId,
            workCaseId: existing.workCaseId,
            calendarEventId,
            type: "cancel_appointment",
            title: existing.title ?? "ביטול תור",
            reason:
              options?.reason?.trim() ||
              options?.nonConfirmedReason ||
              "נדרש אישור לפני ביטול התור",
            preparedPayloadJson: { targetStatus: "cancelled" },
            source: options?.nonConfirmedDecisionSource ?? "manual",
            actor: actorFromEngine(ctx),
          });
          return {
            status: existing.status,
            decisionId: decision.id,
            queueType: "cancel_appointment" as const,
          };
        }

        const { result, correlationId, durationMs } = await runCalendarEngineOperation({
          operation: "cancel",
          ctx,
          entityId: calendarEventId,
          beforeState: serializeEventSnapshot(existing),
          auditAction: "appointment_cancelled",
          execute: async () => {
            await transitionCalendarEventStatus(
              ctx.organizationId,
              calendarEventId,
              "cancelled",
              actorFromEngine(ctx)
            );
            return getCalendarEventById(ctx.organizationId, calendarEventId);
          },
          buildAfterState: serializeEventSnapshot,
        });
        return { status: result.status, correlationId, durationMs, event: result };
      },
    });

    const payload = idempotent.result;
    const correlationId = "correlationId" in payload ? (payload.correlationId as string) : (ctx.correlationId ?? "");
    const durationMs = "durationMs" in payload ? (payload.durationMs as number) : 0;

    await scheduleCalendarGoogleSyncViaPort({
      organizationId: ctx.organizationId,
      calendarEventId,
      action: "delete",
      actor: actorFromEngine(ctx),
      correlationId,
    });

    return success(
      {
        status: payload.status,
        decisionId: "decisionId" in payload ? payload.decisionId : undefined,
        queueType: "queueType" in payload ? payload.queueType : undefined,
      },
      correlationId,
      durationMs,
      idempotent.replay
    );
  } catch (err) {
    const idempotencyFailure = toIdempotencyFailure(err);
    if (idempotencyFailure) return idempotencyFailure;
    return failure(err, ctx.correlationId ?? "", 0);
  }
}

export async function calendarEngineDeleteEvent(
  ctx: CalendarEngineRequestContext,
  calendarEventId: string
): Promise<CalendarEngineOperationResult<CalendarEngineDeleteResult>> {
  const existing = await getCalendarEventById(ctx.organizationId, calendarEventId).catch(() => null);
  if (!existing) {
    return failure(new CalendarEngineServiceError("NOT_FOUND", "CalendarEvent not found"), ctx.correlationId ?? "", 0);
  }

  if (existing.status !== "draft") {
    return calendarEngineCancelEvent(ctx, calendarEventId, { reason: "Deleted via calendar engine" }).then((result) => {
      if (!result.ok) return result;
      return success({ calendarEventId, status: result.data.status }, result.correlationId, result.durationMs);
    });
  }

  try {
    const { correlationId, durationMs } = await runCalendarEngineOperation({
      operation: "delete",
      ctx,
      entityId: calendarEventId,
      beforeState: serializeEventSnapshot(existing),
      auditAction: "appointment_cancelled",
      execute: async () => {
        await transitionCalendarEventStatus(
          ctx.organizationId,
          calendarEventId,
          "cancelled",
          actorFromEngine(ctx)
        );
        return { calendarEventId, status: "cancelled" };
      },
    });
    return success({ calendarEventId, status: "cancelled" }, correlationId, durationMs);
  } catch (err) {
    return failure(err, ctx.correlationId ?? "", 0);
  }
}

export async function calendarEngineRestoreEvent(
  ctx: CalendarEngineRequestContext,
  calendarEventId: string
): Promise<CalendarEngineOperationResult<CalendarEngineRestoreResult>> {
  const existing = await getCalendarEventById(ctx.organizationId, calendarEventId).catch(() => null);
  if (!existing) {
    return failure(new CalendarEngineServiceError("NOT_FOUND", "CalendarEvent not found"), ctx.correlationId ?? "", 0);
  }

  if (existing.status !== "cancelled") {
    return {
      ok: false,
      code: "RESTORE_NOT_ALLOWED",
      message: "Only cancelled events can be restored",
      classification: "validation",
      correlationId: ctx.correlationId ?? "",
      durationMs: 0,
      validation: {
        valid: false,
        issues: [
          {
            code: "RESTORE_NOT_ALLOWED",
            message: `Cannot restore event in status ${existing.status}`,
          },
        ],
      },
    };
  }

  const lastAudit = await prisma.calendarEventAudit.findFirst({
    where: { calendarEventId, organizationId: ctx.organizationId, toStatus: "cancelled" },
    orderBy: { createdAt: "desc" },
    select: { fromStatus: true },
  });
  const restoreTarget = lastAudit?.fromStatus === "draft" ? "draft" : "pending_readiness";

  try {
    const { result, correlationId, durationMs } = await runCalendarEngineOperation({
      operation: "restore",
      ctx,
      entityId: calendarEventId,
      beforeState: serializeEventSnapshot(existing),
      auditAction: "appointment_updated",
      execute: async () => {
        const updated = await prisma.calendarEvent.update({
          where: { id: calendarEventId },
          data: { status: restoreTarget },
          include: {
            client: { select: { id: true, name: true } },
            service: { select: { id: true, name: true, durationMinutes: true } },
            workCase: { select: { id: true, title: true, status: true } },
          },
        });
        return updated as CalendarEventWithRelations;
      },
      buildAfterState: serializeEventSnapshot,
    });
    return success(result, correlationId, durationMs);
  } catch (err) {
    return failure(err, ctx.correlationId ?? "", 0);
  }
}

function serializeEventSnapshot(event: CalendarEventWithRelations) {
  return {
    id: event.id,
    status: event.status,
    startAt: event.startAt.toISOString(),
    endAt: event.endAt.toISOString(),
    clientId: event.clientId,
    assignedUserId: event.assignedUserId,
    serviceId: event.serviceId,
    title: event.title,
  };
}

function normalizeMoveResult(result: {
  event: CalendarEventWithRelations;
  correlationId?: string;
  durationMs?: number;
  decision?: { decisionId: string; queueType: string };
}): { event: CalendarEventWithRelations; correlationId: string; durationMs: number } {
  return {
    event: result.event,
    correlationId: result.correlationId ?? "",
    durationMs: result.durationMs ?? 0,
  };
}

/** Unified Calendar Engine — single mutation entry point for all scheduling consumers. */
export const CalendarEngine = {
  validateEvent: calendarEngineValidateEvent,
  detectConflicts: calendarEngineDetectConflicts,
  createEvent: calendarEngineCreateEvent,
  updateEvent: calendarEngineUpdateEvent,
  moveEvent: calendarEngineMoveEvent,
  cancelEvent: calendarEngineCancelEvent,
  deleteEvent: calendarEngineDeleteEvent,
  restoreEvent: calendarEngineRestoreEvent,
};
