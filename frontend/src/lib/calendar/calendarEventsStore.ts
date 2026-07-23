import { apiFetch, getToken } from "@/lib/api";
import { registerCalendarEventsCacheClear } from "@/lib/calendar/calendarBootstrapCacheClear";
import {
  calendarEventsToDisplayItems,
  type CalendarDisplayItem,
} from "@/lib/calendarEngine/adapters";
import {
  CalendarEngineUnavailableError,
  fetchCalendarEvents,
  resolveCalendarLoadStrategy,
} from "@/lib/calendarEngine/api";

function appointmentRowsToDisplayItems(rows: CalendarDisplayItem[]): CalendarDisplayItem[] {
  return rows.map((row) => ({ ...row, source: "appointment" as const }));
}

export const CALENDAR_EVENTS_FRESH_MS = 30_000;
export const CALENDAR_EVENTS_TTL_MS = 5 * 60_000;

export type CalendarEventsRangeKey = string;

export function buildCalendarEventsRangeKey(input: {
  fromIso: string;
  toIso: string;
  employeeFilter: string;
  engineRead: boolean;
}): CalendarEventsRangeKey {
  return `${input.fromIso}|${input.toIso}|${input.employeeFilter || "all"}|${input.engineRead ? "engine" : "appt"}`;
}

type RangeCacheEntry = {
  identityKey: string;
  rangeKey: CalendarEventsRangeKey;
  value: CalendarDisplayItem[];
  loadedAt: number;
};

type IdentityResolver = () => string;

function resolveIdentityKey(token = getToken()): string {
  const raw = token?.trim();
  if (!raw) return "";
  try {
    const parts = raw.split(".");
    if (parts.length < 2) return "";
    const json = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const padded = json + "=".repeat((4 - (json.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { userId?: string; organizationId?: string };
    const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
    const organizationId =
      typeof payload.organizationId === "string" ? payload.organizationId.trim() : "";
    if (!userId || !organizationId) return "";
    return `${userId}:${organizationId}`;
  } catch {
    return "";
  }
}

type FetchEvents = (input: {
  fromIso: string;
  toIso: string;
  employeeFilter: string;
  engineRead: boolean;
}) => Promise<CalendarDisplayItem[]>;

const defaultFetch: FetchEvents = async ({ fromIso, toIso, employeeFilter, engineRead }) => {
  const strategy = resolveCalendarLoadStrategy(engineRead);
  const employeeQuery =
    employeeFilter && employeeFilter !== "all" ? `&employeeId=${encodeURIComponent(employeeFilter)}` : "";

  if (strategy === "calendar_engine") {
    try {
      const events = await fetchCalendarEvents(fromIso, toIso);
      const engineItems = calendarEventsToDisplayItems(events);
      return employeeFilter === "all" || employeeFilter === "owner" ? engineItems : [];
    } catch (err) {
      if (err instanceof CalendarEngineUnavailableError) {
        const apptData = await apiFetch<CalendarDisplayItem[]>(
          `/api/appointments?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}${employeeQuery}`
        );
        return appointmentRowsToDisplayItems(apptData);
      }
      throw err;
    }
  }

  const apptData = await apiFetch<CalendarDisplayItem[]>(
    `/api/appointments?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}${employeeQuery}`
  );
  return appointmentRowsToDisplayItems(apptData);
};

let fetchImpl: FetchEvents = defaultFetch;
let identityImpl: IdentityResolver = resolveIdentityKey;
let cacheByRange = new Map<CalendarEventsRangeKey, RangeCacheEntry>();
let inFlightByRange = new Map<CalendarEventsRangeKey, Promise<CalendarDisplayItem[]>>();
let networkCount = 0;
let retryCount = 0;
let lastCacheSource: "memory" | "network" | null = null;

function currentIdentity(): string {
  return identityImpl();
}

function ageMs(entry: RangeCacheEntry): number {
  return Date.now() - entry.loadedAt;
}

function commit(rangeKey: CalendarEventsRangeKey, value: CalendarDisplayItem[]): void {
  const identityKey = currentIdentity();
  if (!identityKey) return;
  cacheByRange.set(rangeKey, { identityKey, rangeKey, value, loadedAt: Date.now() });
}

export function getCachedCalendarEvents(rangeKey: CalendarEventsRangeKey): CalendarDisplayItem[] | null {
  const identityKey = currentIdentity();
  const entry = cacheByRange.get(rangeKey);
  if (!entry || !identityKey || entry.identityKey !== identityKey) return null;
  return entry.value;
}

export function setCalendarEvents(rangeKey: CalendarEventsRangeKey, value: CalendarDisplayItem[]): void {
  commit(rangeKey, value);
}

export function invalidateCalendarEvents(rangeKey?: CalendarEventsRangeKey): void {
  if (rangeKey) {
    cacheByRange.delete(rangeKey);
    inFlightByRange.delete(rangeKey);
    return;
  }
  cacheByRange.clear();
  inFlightByRange.clear();
}

/** Invalidate every cached range (e.g. after create/update/cancel). */
export function invalidateAllCalendarEvents(): void {
  invalidateCalendarEvents();
}

export function clearCalendarEvents(): void {
  invalidateAllCalendarEvents();
  networkCount = 0;
  retryCount = 0;
  lastCacheSource = null;
}

registerCalendarEventsCacheClear(clearCalendarEvents);

export type LoadCalendarEventsResult = {
  items: CalendarDisplayItem[];
  cacheSource: "memory" | "network";
  rangeKey: CalendarEventsRangeKey;
};

export async function loadCalendarEvents(input: {
  fromIso: string;
  toIso: string;
  employeeFilter?: string;
  engineRead: boolean;
  force?: boolean;
}): Promise<LoadCalendarEventsResult> {
  const employeeFilter = input.employeeFilter?.trim() || "all";
  const rangeKey = buildCalendarEventsRangeKey({
    fromIso: input.fromIso,
    toIso: input.toIso,
    employeeFilter,
    engineRead: input.engineRead,
  });
  const identityKey = currentIdentity();

  if (!input.force && identityKey) {
    const entry = cacheByRange.get(rangeKey);
    if (entry && entry.identityKey === identityKey) {
      const age = ageMs(entry);
      if (age < CALENDAR_EVENTS_FRESH_MS) {
        lastCacheSource = "memory";
        return { items: entry.value, cacheSource: "memory", rangeKey };
      }
      if (age < CALENDAR_EVENTS_TTL_MS) {
        lastCacheSource = "memory";
        void startFetch(rangeKey, input).catch(() => {
          retryCount += 1;
        });
        return { items: entry.value, cacheSource: "memory", rangeKey };
      }
    }
  }

  try {
    const items = await startFetch(rangeKey, input);
    return { items, cacheSource: "network", rangeKey };
  } catch (err) {
    const entry = cacheByRange.get(rangeKey);
    if (entry && entry.identityKey === identityKey) {
      return { items: entry.value, cacheSource: "memory", rangeKey };
    }
    throw err;
  }
}

async function startFetch(
  rangeKey: CalendarEventsRangeKey,
  input: {
    fromIso: string;
    toIso: string;
    employeeFilter?: string;
    engineRead: boolean;
  }
): Promise<CalendarDisplayItem[]> {
  const existing = inFlightByRange.get(rangeKey);
  if (existing) return existing;

  const promise = (async () => {
    networkCount += 1;
    const items = await fetchImpl({
      fromIso: input.fromIso,
      toIso: input.toIso,
      employeeFilter: input.employeeFilter?.trim() || "all",
      engineRead: input.engineRead,
    });
    commit(rangeKey, items);
    lastCacheSource = "network";
    return items;
  })().finally(() => {
    if (inFlightByRange.get(rangeKey) === promise) inFlightByRange.delete(rangeKey);
  });

  inFlightByRange.set(rangeKey, promise);
  return promise;
}

export function getCalendarEventsDebugCounters() {
  return { networkCount, retryCount, lastCacheSource, rangeCount: cacheByRange.size };
}

/** @internal */
export function __resetCalendarEventsStoreForTests(): void {
  cacheByRange.clear();
  inFlightByRange.clear();
  fetchImpl = defaultFetch;
  identityImpl = resolveIdentityKey;
  networkCount = 0;
  retryCount = 0;
  lastCacheSource = null;
}

/** @internal */
export function __setCalendarEventsFetchForTests(fn: FetchEvents): void {
  fetchImpl = fn;
}

/** @internal */
export function __setCalendarEventsIdentityForTests(fn: IdentityResolver): void {
  identityImpl = fn;
}

/** @internal */
export function __ageCalendarEventsCacheForTests(rangeKey: CalendarEventsRangeKey, byMs: number): void {
  const entry = cacheByRange.get(rangeKey);
  if (!entry) return;
  cacheByRange.set(rangeKey, { ...entry, loadedAt: entry.loadedAt - byMs });
}
