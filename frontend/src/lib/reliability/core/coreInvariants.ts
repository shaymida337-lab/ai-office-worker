import type { NatalieCoreInvariantResult } from "./coreTypes";

export function enforceCoreInvariant<T>(
  condition: boolean,
  message: string,
  value: T,
  fallback: T
): NatalieCoreInvariantResult<T> {
  if (condition) {
    return { ok: true, recovered: false, value };
  }
  return {
    ok: false,
    violation: message,
    recovered: true,
    value: fallback,
  };
}

export function guardCoreInvariant<T>(
  value: T,
  validate: (candidate: T) => boolean,
  message: string,
  fallback: T
): NatalieCoreInvariantResult<T> {
  try {
    return enforceCoreInvariant(validate(value), message, value, fallback);
  } catch {
    return {
      ok: false,
      violation: message,
      recovered: true,
      value: fallback,
    };
  }
}

export function runCoreInvariantSafe<T>(fn: () => T, fallback: T, message: string): NatalieCoreInvariantResult<T> {
  try {
    const value = fn();
    return { ok: true, recovered: false, value };
  } catch (error) {
    return {
      ok: false,
      violation: `${message}: ${error instanceof Error ? error.message : String(error)}`,
      recovered: true,
      value: fallback,
    };
  }
}
