/** Opt-in calendar First Paint diagnostics — localStorage.CALENDAR_FP_DEBUG=1 */

export function isCalendarFpDebugEnabled(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage?.getItem("CALENDAR_FP_DEBUG") === "1";
  } catch {
    return false;
  }
}

export function calendarFpDebugLog(event: string, payload: Record<string, unknown> = {}): void {
  if (!isCalendarFpDebugEnabled()) return;
  // Never log tokens, bodies, headers, or PII.
  console.info("[calendar-fp]", event, payload);
}
