import type { SchedulingCapabilities } from "@/lib/scheduling/capabilities";
import { effectiveCalendarEngineRead } from "@/lib/scheduling/capabilities";

/**
 * Events strategy must be known before the events network request.
 * Prefer cached bootstrap capabilities; otherwise strategy is unknown until bootstrap resolves.
 */
export function resolveCalendarEventsStrategy(input: {
  cachedCapabilities: SchedulingCapabilities | null | undefined;
  liveCapabilities: SchedulingCapabilities | null | undefined;
}): { known: boolean; engineRead: boolean } {
  const caps = input.cachedCapabilities ?? input.liveCapabilities ?? null;
  if (!caps) return { known: false, engineRead: false };
  return { known: true, engineRead: effectiveCalendarEngineRead(caps) };
}
