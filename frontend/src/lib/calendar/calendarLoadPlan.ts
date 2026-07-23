/**
 * Calendar First Paint plan:
 * - Strategy must be known before events network.
 * - Warm/session: bootstrap refresh ∥ events (known strategy).
 * - Cold: await bootstrap, then one events request.
 */
import type { SchedulingCapabilities } from "@/lib/scheduling/capabilities";
import { resolveCalendarEventsStrategy } from "./calendarEventsStrategy";

export const CALENDAR_FIRST_PAINT_KEYS = ["calendar-bootstrap", "calendar-events"] as const;

export const CALENDAR_FIRST_PAINT_FORBIDDEN_KEYS = [
  "services",
  "clients",
  "employees",
  "organization-settings",
  "scheduling-capabilities",
  "calendar-status",
  "tasks",
  "briefing",
  "owner-decisions",
] as const;

export function assertCalendarFirstPaintBudget(keys: readonly string[] = CALENDAR_FIRST_PAINT_KEYS) {
  if (keys.length > 2) {
    throw new Error(`Calendar First Paint allows at most 2 requests, got ${keys.length}`);
  }
  for (const key of keys) {
    if ((CALENDAR_FIRST_PAINT_FORBIDDEN_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Calendar First Paint must not include: ${key}`);
    }
  }
}

export type CalendarFirstPaintRunResult = {
  engineRead: boolean;
  bootstrapAwaitedForStrategy: boolean;
  eventsStartedAfterStrategyKnown: true;
};

/**
 * Ensures events never start until strategy is known.
 * Never issues a second competing events request for strategy switch.
 */
export async function runCalendarFirstPaintPhases(options: {
  cachedCapabilities: SchedulingCapabilities | null | undefined;
  liveCapabilities: SchedulingCapabilities | null | undefined;
  loadBootstrap: () => Promise<SchedulingCapabilities>;
  loadEvents: (engineRead: boolean) => Promise<void>;
  onFirstGridReady?: () => void;
  onBootstrapApplied?: () => void;
  onError?: (error: unknown) => void;
}): Promise<CalendarFirstPaintRunResult> {
  assertCalendarFirstPaintBudget();
  options.onFirstGridReady?.();

  const initial = resolveCalendarEventsStrategy({
    cachedCapabilities: options.cachedCapabilities,
    liveCapabilities: options.liveCapabilities,
  });

  if (initial.known) {
    const bootstrapP = (async () => {
      try {
        await options.loadBootstrap();
        options.onBootstrapApplied?.();
      } catch (err) {
        options.onError?.(err);
      }
    })();
    const eventsP = (async () => {
      try {
        await options.loadEvents(initial.engineRead);
      } catch (err) {
        options.onError?.(err);
      }
    })();
    await Promise.all([bootstrapP, eventsP]);
    return {
      engineRead: initial.engineRead,
      bootstrapAwaitedForStrategy: false,
      eventsStartedAfterStrategyKnown: true,
    };
  }

  // Cold: resolve strategy from bootstrap first, then a single events request.
  let engineRead = false;
  try {
    const caps = await options.loadBootstrap();
    options.onBootstrapApplied?.();
    engineRead = resolveCalendarEventsStrategy({
      cachedCapabilities: caps,
      liveCapabilities: caps,
    }).engineRead;
  } catch (err) {
    options.onError?.(err);
    throw err;
  }

  try {
    await options.loadEvents(engineRead);
  } catch (err) {
    options.onError?.(err);
  }

  return {
    engineRead,
    bootstrapAwaitedForStrategy: true,
    eventsStartedAfterStrategyKnown: true,
  };
}
