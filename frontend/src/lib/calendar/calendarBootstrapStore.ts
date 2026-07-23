import { apiFetch, getToken } from "@/lib/api";
import { registerCalendarBootstrapCacheClear } from "@/lib/calendar/calendarBootstrapCacheClear";
import type { SchedulingCapabilities } from "@/lib/scheduling/capabilities";

export const CALENDAR_BOOTSTRAP_FRESH_MS = 30_000;
export const CALENDAR_BOOTSTRAP_TTL_MS = 5 * 60_000;
const SESSION_STORAGE_KEY = "natalie.calendar.bootstrap.v1";

export type CalendarBootstrapSettings = {
  timezone: string;
  workday: { weekStart: string };
  locale: string;
};

export type CalendarBootstrapEmployee = {
  id: string;
  name: string;
  color: string;
  isActive: boolean;
};

export type CalendarBootstrapService = {
  id: string;
  name: string;
  durationMinutes: number;
  price?: number | null;
  color?: string | null;
  isActive: boolean;
  employeeIds?: string[];
};

export type CalendarBootstrapClientSummary = {
  id: string;
  name: string;
  phone?: string | null;
};

export type CalendarBootstrapConnectionStatus = {
  connected: boolean;
  calendarId?: string;
};

export type CalendarBootstrapPayload = {
  capabilities: SchedulingCapabilities;
  connectionStatus: CalendarBootstrapConnectionStatus;
  settings: CalendarBootstrapSettings;
  employees: CalendarBootstrapEmployee[];
  services: CalendarBootstrapService[];
  clientsSummary: CalendarBootstrapClientSummary[];
  generatedAt: string;
};

export type CalendarCacheSource = "memory" | "session" | "network";

type CacheEntry = {
  identityKey: string;
  value: CalendarBootstrapPayload;
  loadedAt: number;
};

type FetchBootstrap = () => Promise<CalendarBootstrapPayload>;
type IdentityResolver = () => string;

const defaultFetch: FetchBootstrap = () => apiFetch<CalendarBootstrapPayload>("/api/calendar/bootstrap");

export function resolveCalendarBootstrapIdentityKey(token = getToken()): string {
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

const defaultIdentity: IdentityResolver = () => resolveCalendarBootstrapIdentityKey();

let fetchImpl: FetchBootstrap = defaultFetch;
let identityImpl: IdentityResolver = defaultIdentity;
let cache: CacheEntry | null = null;
let inFlight: { identityKey: string; promise: Promise<CalendarBootstrapPayload> } | null = null;
let lastCacheSource: CalendarCacheSource | null = null;
let networkCount = 0;
let retryCount = 0;

function currentIdentity(): string {
  return identityImpl();
}

function cacheMatches(identityKey: string): boolean {
  return Boolean(cache && identityKey && cache.identityKey === identityKey);
}

function ageMs(entry: CacheEntry): number {
  return Date.now() - entry.loadedAt;
}

function readSessionSnapshot(identityKey: string): CacheEntry | null {
  if (typeof window === "undefined" || !identityKey) return null;
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { identityKey?: string; value?: CalendarBootstrapPayload; loadedAt?: number };
    if (!parsed?.identityKey || parsed.identityKey !== identityKey || !parsed.value) return null;
    if (typeof parsed.loadedAt !== "number") return null;
    return { identityKey: parsed.identityKey, value: parsed.value, loadedAt: parsed.loadedAt };
  } catch {
    return null;
  }
}

function writeSessionSnapshot(entry: CacheEntry): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ identityKey: entry.identityKey, value: entry.value, loadedAt: entry.loadedAt })
    );
  } catch {
    /* quota */
  }
}

function clearSessionSnapshot(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function commitCache(identityKey: string, value: CalendarBootstrapPayload): void {
  if (currentIdentity() !== identityKey) return;
  cache = { identityKey, value, loadedAt: Date.now() };
  writeSessionSnapshot(cache);
}

export function getCachedCalendarBootstrap(): CalendarBootstrapPayload | null {
  const identityKey = currentIdentity();
  if (!cacheMatches(identityKey) || !cache) return null;
  return cache.value;
}

export function setCalendarBootstrap(value: CalendarBootstrapPayload): void {
  const identityKey = currentIdentity();
  if (!identityKey) return;
  commitCache(identityKey, value);
}

export function invalidateCalendarBootstrap(): void {
  cache = null;
  inFlight = null;
  clearSessionSnapshot();
  lastCacheSource = null;
}

export function clearCalendarBootstrap(): void {
  invalidateCalendarBootstrap();
  networkCount = 0;
  retryCount = 0;
}

registerCalendarBootstrapCacheClear(clearCalendarBootstrap);

async function runFetch(identityKey: string): Promise<CalendarBootstrapPayload> {
  networkCount += 1;
  const value = await fetchImpl();
  commitCache(identityKey, value);
  lastCacheSource = "network";
  return value;
}

function startInFlight(identityKey: string): Promise<CalendarBootstrapPayload> {
  if (inFlight && inFlight.identityKey === identityKey) return inFlight.promise;
  const promise = runFetch(identityKey).finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { identityKey, promise };
  return promise;
}

export type LoadCalendarBootstrapResult = {
  payload: CalendarBootstrapPayload;
  cacheSource: CalendarCacheSource;
};

export async function loadCalendarBootstrap(options: { force?: boolean } = {}): Promise<LoadCalendarBootstrapResult> {
  const identityKey = currentIdentity();
  if (!identityKey) {
    const payload = await startInFlight("");
    return { payload, cacheSource: "network" };
  }

  if (options.force) {
    try {
      const payload = await startInFlight(identityKey);
      return { payload, cacheSource: "network" };
    } catch (err) {
      if (cacheMatches(identityKey) && cache) {
        return { payload: cache.value, cacheSource: lastCacheSource ?? "memory" };
      }
      throw err;
    }
  }

  if (cacheMatches(identityKey) && cache) {
    const age = ageMs(cache);
    if (age < CALENDAR_BOOTSTRAP_FRESH_MS) {
      lastCacheSource = "memory";
      return { payload: cache.value, cacheSource: "memory" };
    }
    if (age < CALENDAR_BOOTSTRAP_TTL_MS) {
      lastCacheSource = "memory";
      void startInFlight(identityKey).catch(() => {
        retryCount += 1;
      });
      return { payload: cache.value, cacheSource: "memory" };
    }
  }

  const session = readSessionSnapshot(identityKey);
  if (session) {
    cache = session;
    const age = ageMs(session);
    if (age < CALENDAR_BOOTSTRAP_TTL_MS) {
      lastCacheSource = "session";
      if (age >= CALENDAR_BOOTSTRAP_FRESH_MS) {
        void startInFlight(identityKey).catch(() => {
          retryCount += 1;
        });
      }
      return { payload: session.value, cacheSource: "session" };
    }
  }

  try {
    const payload = await startInFlight(identityKey);
    return { payload, cacheSource: "network" };
  } catch (err) {
    if (cacheMatches(identityKey) && cache) {
      return { payload: cache.value, cacheSource: lastCacheSource ?? "memory" };
    }
    const sessionFallback = readSessionSnapshot(identityKey);
    if (sessionFallback) {
      cache = sessionFallback;
      return { payload: sessionFallback.value, cacheSource: "session" };
    }
    throw err;
  }
}

export function getCalendarBootstrapDebugCounters() {
  return { networkCount, retryCount, lastCacheSource };
}

/** @internal */
export function __resetCalendarBootstrapStoreForTests(): void {
  cache = null;
  inFlight = null;
  fetchImpl = defaultFetch;
  identityImpl = defaultIdentity;
  lastCacheSource = null;
  networkCount = 0;
  retryCount = 0;
  clearSessionSnapshot();
}

/** @internal */
export function __setCalendarBootstrapFetchForTests(fn: FetchBootstrap): void {
  fetchImpl = fn;
}

/** @internal */
export function __setCalendarBootstrapIdentityForTests(fn: IdentityResolver): void {
  identityImpl = fn;
}

/** @internal */
export function __ageCalendarBootstrapCacheForTests(byMs: number): void {
  if (!cache) return;
  cache = { ...cache, loadedAt: cache.loadedAt - byMs };
}
