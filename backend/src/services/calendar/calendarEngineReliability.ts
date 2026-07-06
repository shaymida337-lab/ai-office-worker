import { randomUUID } from "crypto";
import { recordCalendarAudit } from "./calendarAudit.js";
import {
  recordCalendarEngineHealthFailure,
  recordCalendarEngineHealthSuccess,
} from "./calendarEngineHealth.js";
import type {
  CalendarEngineOperation,
  CalendarEngineRequestContext,
  FailureClassification,
} from "./calendarEngineTypes.js";
import { CalendarEngineServiceError } from "./serviceErrors.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 100;

export type CalendarEngineReliabilityParams<T> = {
  operation: CalendarEngineOperation;
  ctx: CalendarEngineRequestContext;
  entityId?: string;
  beforeState?: unknown;
  execute: () => Promise<T>;
  buildAfterState?: (result: T) => unknown;
  auditAction?: string;
};

function resolveCorrelationId(ctx: CalendarEngineRequestContext): string {
  return ctx.correlationId?.trim() || `cal-${randomUUID()}`;
}

function classifyError(err: unknown): FailureClassification {
  if (err instanceof CalendarEngineServiceError) {
    switch (err.code) {
      case "VALIDATION_FAILED":
      case "INVALID_TRANSITION":
        return "validation";
      case "TIME_CONFLICT":
        return "conflict";
      case "NOT_FOUND":
        return "not_found";
      case "FORBIDDEN":
        return "forbidden";
      default:
        return "permanent";
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("IDEMPOTENCY")) return "idempotency";
  if (message.includes("timeout") || message.includes("TIMEOUT")) return "timeout";
  if (message.includes("ECONNRESET") || message.includes("ETIMEDOUT")) return "transient";
  return "unknown";
}

function isRetryable(classification: FailureClassification): boolean {
  return classification === "transient" || classification === "timeout";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("CALENDAR_ENGINE_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function logCalendarEngineOperation(entry: Record<string, unknown>): void {
  console.info("[calendar-engine]", JSON.stringify(entry));
}

export async function runCalendarEngineOperation<T>(
  params: CalendarEngineReliabilityParams<T>
): Promise<{ result: T; correlationId: string; durationMs: number }> {
  const correlationId = resolveCorrelationId(params.ctx);
  const timeoutMs = params.ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const result = await withTimeout(params.execute(), timeoutMs);
      const durationMs = Date.now() - startedAt;

      recordCalendarEngineHealthSuccess({ operation: params.operation, durationMs });
      logCalendarEngineOperation({
        level: "info",
        operation: params.operation,
        correlationId,
        organizationId: params.ctx.organizationId,
        source: params.ctx.source,
        durationMs,
        attempt,
        result: "success",
      });

      if (params.auditAction && params.entityId) {
        recordCalendarAudit({
          organizationId: params.ctx.organizationId,
          action: params.auditAction as never,
          entityType: "calendar_event",
          entityId: params.entityId,
          actor: {
            actorType: params.ctx.actor.actorType,
            actorUserId: params.ctx.actor.actorUserId,
          },
          sourceModule: params.ctx.sourceModule ?? "calendar-engine",
          sourceRoute: params.ctx.sourceRoute ?? null,
          correlationId,
          beforeState: params.beforeState,
          afterState: params.buildAfterState ? params.buildAfterState(result) : result,
          metadata: {
            operation: params.operation,
            source: params.ctx.source,
            durationMs,
          },
        });
      }

      return { result, correlationId, durationMs };
    } catch (err) {
      lastError = err;
      const classification = classifyError(err);
      if (attempt < MAX_RETRIES && isRetryable(classification)) {
        logCalendarEngineOperation({
          level: "warn",
          operation: params.operation,
          correlationId,
          organizationId: params.ctx.organizationId,
          attempt,
          classification,
          message: err instanceof Error ? err.message : String(err),
          result: "retry",
        });
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      break;
    }
  }

  const durationMs = Date.now() - startedAt;
  const classification = classifyError(lastError);
  recordCalendarEngineHealthFailure({ operation: params.operation, durationMs, classification });
  logCalendarEngineOperation({
    level: "error",
    operation: params.operation,
    correlationId,
    organizationId: params.ctx.organizationId,
    source: params.ctx.source,
    durationMs,
    classification,
    message: lastError instanceof Error ? lastError.message : String(lastError),
    result: "failure",
  });

  throw lastError;
}

export { classifyError as classifyCalendarEngineError };
