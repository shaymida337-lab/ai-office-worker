import { prisma } from "../../lib/prisma.js";
import { beginIdempotentRequest, completeIdempotentRequest } from "../idempotency.js";
import type { CalendarEngineOperationResult } from "./calendarEngineTypes.js";

/** In-memory replay store for tests only (when idempotency key is provided). */
const testReplayCache = new Map<string, unknown>();
let memoryOnlyIdempotency = false;

export function resetCalendarEngineIdempotencyForTests(): void {
  testReplayCache.clear();
  memoryOnlyIdempotency = true;
}

export function disableCalendarEngineMemoryIdempotencyForTests(): void {
  memoryOnlyIdempotency = false;
}

export type CalendarEngineIdempotencyParams<T> = {
  organizationId: string;
  operation: string;
  idempotencyKey?: string | null;
  payload: unknown;
  execute: () => Promise<T>;
};

export async function runCalendarEngineIdempotent<T>(
  params: CalendarEngineIdempotencyParams<T>
): Promise<{ result: T; replay: boolean }> {
  const key = params.idempotencyKey?.trim();
  const routeKey = `calendar-engine:${params.operation}`;

  if (!key) {
    const result = await params.execute();
    return { result, replay: false };
  }

  const testCacheKey = `${params.organizationId}:${routeKey}:${key}`;
  if (testReplayCache.has(testCacheKey)) {
    return { result: testReplayCache.get(testCacheKey) as T, replay: true };
  }

  if (memoryOnlyIdempotency) {
    const result = await params.execute();
    testReplayCache.set(testCacheKey, result);
    return { result, replay: false };
  }

  const begin = await beginIdempotentRequest({
    prisma,
    organizationId: params.organizationId,
    idempotencyKeyHeader: key,
    routeKey,
    method: "POST",
    body: params.payload,
  });

  if (begin.mode === "replay") {
    return { result: begin.responseBody as T, replay: true };
  }

  if (begin.mode === "disabled") {
    const result = await params.execute();
    return { result, replay: false };
  }

  const result = await params.execute();
  testReplayCache.set(testCacheKey, result);
  if (begin.recordId) {
    await completeIdempotentRequest({
      prisma,
      recordId: begin.recordId,
      statusCode: 200,
      responseBody: result,
    });
  }
  return { result, replay: false };
}

export function toIdempotencyFailure(err: unknown): CalendarEngineOperationResult<never> | null {
  const message = err instanceof Error ? err.message : String(err);
  if (message === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD") {
    return {
      ok: false,
      code: "IDEMPOTENCY_MISMATCH",
      message: "Idempotency key was already used with a different payload",
      classification: "idempotency",
      correlationId: "",
      durationMs: 0,
    };
  }
  if (message === "IDEMPOTENCY_REQUEST_IN_PROGRESS") {
    return {
      ok: false,
      code: "IDEMPOTENCY_IN_PROGRESS",
      message: "A request with this idempotency key is still processing",
      classification: "idempotency",
      correlationId: "",
      durationMs: 0,
    };
  }
  return null;
}
