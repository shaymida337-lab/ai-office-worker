import type { NatalieCoreRetryPolicy } from "./coreTypes.js";

export function computeCoreRetryDelayMs(attempt: number, policy: NatalieCoreRetryPolicy): number {
  const base = Math.max(0, policy.baseDelayMs);
  const max = policy.maxDelayMs ?? base * 8;
  const exponential = base * 2 ** Math.max(0, attempt - 1);
  return Math.min(max, exponential);
}

export async function withCoreRetry<T>(
  fn: (attempt: number) => Promise<T>,
  policy: NatalieCoreRetryPolicy
): Promise<T> {
  const maxAttempts = Math.max(1, policy.maxAttempts);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      const delayMs = computeCoreRetryDelayMs(attempt, policy);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export async function withCoreTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => T
): Promise<T> {
  if (timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve, reject) => {
        timer = setTimeout(() => {
          if (onTimeout) resolve(onTimeout());
          else reject(new Error(`operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function withCoreSafeFallback<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export async function withCoreSafeFallbackAsync<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
