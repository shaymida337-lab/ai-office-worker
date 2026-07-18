/**
 * Short-lived CRM list cache (memory + sessionStorage).
 * Speeds Home→/crm by serving the last /api/leads payload instantly.
 */

export type CrmListCachePayload = {
  leads: unknown[];
  kpis: Record<string, unknown>;
  pipeline: unknown[];
};

const MEMORY_TTL_MS = 60_000;
const STORAGE_KEY = "crm.listCache.v1";

type CacheEntry = {
  key: string;
  at: number;
  data: CrmListCachePayload;
};

let memoryEntry: CacheEntry | null = null;

function readStorage(): CacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed?.key || !parsed?.data || typeof parsed.at !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStorage(entry: CacheEntry) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // quota / private mode — memory cache still works
  }
}

export function crmListCacheKey(searchParams = ""): string {
  return searchParams || "__default__";
}

export function getCrmListCacheAge(key: string): number | null {
  const now = Date.now();
  if (memoryEntry && memoryEntry.key === key) return now - memoryEntry.at;
  const stored = readStorage();
  if (stored && stored.key === key) return now - stored.at;
  return null;
}

export function getCrmListCache(key: string, maxAgeMs = MEMORY_TTL_MS): CrmListCachePayload | null {
  const age = getCrmListCacheAge(key);
  if (age == null || age > maxAgeMs) return null;
  if (memoryEntry && memoryEntry.key === key) return memoryEntry.data;
  const stored = readStorage();
  if (stored && stored.key === key) {
    memoryEntry = stored;
    return stored.data;
  }
  return null;
}

export function setCrmListCache(key: string, data: CrmListCachePayload) {
  const entry: CacheEntry = { key, at: Date.now(), data };
  memoryEntry = entry;
  writeStorage(entry);
}

export function clearCrmListCache() {
  memoryEntry = null;
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
