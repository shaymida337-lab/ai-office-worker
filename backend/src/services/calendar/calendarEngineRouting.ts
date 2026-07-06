import type { Request } from "express";

import { AppointmentConflictError } from "../appointmentService.js";
import { SchedulingFacadeError } from "../scheduling/schedulingErrors.js";
import { CalendarEngine } from "./calendarEngineFacade.js";
import { resolveDurationMinutes } from "./availability.js";
import { appointmentEnd } from "./engine.js";
import { getCalendarRulesForOrganization } from "./rules.js";
import type {
  CalendarEngineFailure,
  CalendarEngineOperationResult,
  CalendarEngineRequestContext,
  CalendarEngineSource,
} from "./calendarEngineTypes.js";
import type { CheckSlotAvailabilityResult } from "./types.js";

export function isCalendarEngineFailure<T>(
  result: CalendarEngineOperationResult<T>
): result is CalendarEngineFailure {
  return !result.ok;
}

export function buildEngineContextFromHttp(
  req: Pick<Request, "auth" | "headers" | "originalUrl">,
  source: CalendarEngineSource = "ui"
): CalendarEngineRequestContext {
  const idempotencyHeader = req.headers["idempotency-key"];
  return {
    organizationId: req.auth!.organizationId,
    source,
    actor: { actorType: "user", actorUserId: req.auth!.userId },
    correlationId:
      typeof req.headers["x-correlation-id"] === "string" ? req.headers["x-correlation-id"] : undefined,
    idempotencyKey: typeof idempotencyHeader === "string" ? idempotencyHeader : null,
    sourceModule: "calendar-engine-routes",
    sourceRoute: req.originalUrl,
  };
}

export function buildNatalieEngineContext(params: {
  organizationId: string;
  userId: string;
  idempotencyKey?: string | null;
  correlationId?: string;
}): CalendarEngineRequestContext {
  return {
    organizationId: params.organizationId,
    source: "natalie_ai",
    actor: { actorType: "natalie", actorUserId: params.userId },
    correlationId: params.correlationId,
    idempotencyKey: params.idempotencyKey ?? null,
    sourceModule: "scheduling-facade",
  };
}

export function buildApiEngineContext(params: {
  organizationId: string;
  userId: string;
  sourceRoute?: string;
}): CalendarEngineRequestContext {
  return {
    organizationId: params.organizationId,
    source: "api",
    actor: { actorType: "user", actorUserId: params.userId },
    sourceModule: "appointment-api",
    sourceRoute: params.sourceRoute,
  };
}

export function mapEngineFailureToSchedulingError(failure: CalendarEngineFailure): SchedulingFacadeError {
  if (failure.code === "TIME_CONFLICT") {
    return new SchedulingFacadeError("time_conflict", failure.message, failure.conflict as Record<string, unknown>);
  }
  if (failure.code === "NOT_FOUND") {
    return new SchedulingFacadeError("appointment_not_found", failure.message, failure.details);
  }
  if (failure.code === "INVALID_TRANSITION") {
    return new SchedulingFacadeError("INVALID_TRANSITION", failure.message, failure.details);
  }
  const validationCode = failure.validation?.issues[0]?.code;
  if (validationCode === "PAST_START_TIME") {
    return new SchedulingFacadeError("VALIDATION_FAILED", "זמן התור חייב להיות בהווה או בעתיד", failure.details);
  }
  if (validationCode === "OUTSIDE_WORKING_HOURS") {
    return new SchedulingFacadeError("outside_working_hours", "השעה מחוץ לשעות הפעילות", failure.details);
  }
  return new SchedulingFacadeError(failure.code, failure.message, {
    ...(failure.details ?? {}),
    ...(failure.validation ? { validation: failure.validation } : {}),
    ...(failure.conflict ? { conflict: failure.conflict } : {}),
  });
}

export function throwSchedulingFacadeFromEngineFailure(failure: CalendarEngineFailure): never {
  if (failure.code === "TIME_CONFLICT") {
    throw new AppointmentConflictError(failure.message);
  }
  throw mapEngineFailureToSchedulingError(failure);
}

export function unwrapCalendarEngineResult<T>(result: CalendarEngineOperationResult<T>): T {
  if (!result.ok) {
    throwSchedulingFacadeFromEngineFailure(result);
  }
  return result.data;
}

function mapValidationIssueToAvailabilityReason(
  code: string | undefined
): CheckSlotAvailabilityResult["reason"] {
  if (code === "PAST_START_TIME") return "past";
  if (code === "OUTSIDE_WORKING_HOURS") return "outside_working_hours";
  return "bad_datetime";
}

export async function checkSlotViaCalendarEngine(
  ctx: CalendarEngineRequestContext,
  params: {
    organizationId: string;
    startTime: Date;
    durationMinutes: number;
    serviceId?: string | null;
    clientId?: string | null;
    assignedUserId?: string | null;
    excludeCalendarEventId?: string;
    excludeAppointmentId?: string;
  }
): Promise<CheckSlotAvailabilityResult> {
  const rules = await getCalendarRulesForOrganization(params.organizationId);
  const endAt = appointmentEnd(params.startTime, params.durationMinutes);

  const validation = await CalendarEngine.validateEvent(ctx, {
    startAt: params.startTime,
    endAt,
    clientId: params.clientId ?? null,
    assignedUserId: params.assignedUserId ?? null,
    serviceId: params.serviceId ?? null,
    source: "manual",
  }, { excludeCalendarEventId: params.excludeCalendarEventId });

  if (!validation.ok) {
    throwSchedulingFacadeFromEngineFailure(validation);
  }
  if (!validation.data.valid) {
    const issue = validation.data.issues[0];
    return {
      available: false,
      reason: mapValidationIssueToAvailabilityReason(issue?.code),
      startTime: params.startTime.toISOString(),
      endTime: endAt.toISOString(),
      durationMinutes: params.durationMinutes,
      timeZone: rules.timeZone,
    };
  }

  const conflict = await CalendarEngine.detectConflicts(
    ctx,
    {
      startAt: params.startTime,
      endAt,
      clientId: params.clientId ?? null,
      assignedUserId: params.assignedUserId ?? null,
      serviceId: params.serviceId ?? null,
    },
    {
      excludeCalendarEventId: params.excludeCalendarEventId,
      excludeAppointmentId: params.excludeAppointmentId,
    }
  );

  if (!conflict.ok) {
    throwSchedulingFacadeFromEngineFailure(conflict);
  }

  if (conflict.data.hasConflict) {
    const first = conflict.data.conflicts[0];
    return {
      available: false,
      reason: "time_conflict",
      startTime: params.startTime.toISOString(),
      endTime: endAt.toISOString(),
      durationMinutes: params.durationMinutes,
      timeZone: rules.timeZone,
      conflict: {
        appointmentId: first?.conflictId ?? "unknown",
        clientName: first?.clientName,
        startTime: first?.startTime ?? params.startTime.toISOString(),
        endTime: first?.endTime ?? endAt.toISOString(),
      },
    };
  }

  return {
    available: true,
    startTime: params.startTime.toISOString(),
    endTime: endAt.toISOString(),
    durationMinutes: params.durationMinutes,
    timeZone: rules.timeZone,
  };
}

export async function checkUnifiedSlotViaEngineWhenEnabled(
  organizationId: string,
  ctx: CalendarEngineRequestContext,
  params: Parameters<typeof checkSlotViaCalendarEngine>[1] & {
    durationMinutes?: number;
    serviceId?: string | null;
  }
): Promise<CheckSlotAvailabilityResult | null> {
  const rules = await getCalendarRulesForOrganization(organizationId);
  const durationMinutes = await resolveDurationMinutes({
    organizationId,
    durationMinutes: params.durationMinutes,
    serviceId: params.serviceId,
    defaultDurationMinutes: rules.defaultDurationMinutes,
  });

  return checkSlotViaCalendarEngine(ctx, {
    ...params,
    durationMinutes,
  });
}
