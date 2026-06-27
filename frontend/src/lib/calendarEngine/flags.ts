function parseBoolFlag(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

/** Defaults OFF — must not enable in production without explicit rollout. */
export function isCalendarEngineReadEnabled(): boolean {
  return parseBoolFlag(process.env.NEXT_PUBLIC_CALENDAR_ENGINE_V1_READ);
}

/** Defaults OFF — must not enable in production without explicit rollout. */
export function isCalendarEngineWriteEnabled(): boolean {
  return parseBoolFlag(process.env.NEXT_PUBLIC_CALENDAR_ENGINE_V1_WRITE);
}

export const CALENDAR_ENGINE_FLAGS = {
  read: isCalendarEngineReadEnabled(),
  write: isCalendarEngineWriteEnabled(),
} as const;
