import { apiFetch, getToken } from "@/lib/api";
import { registerLeadAdminSummaryCacheClear } from "@/lib/admin/leadAdminSummaryCacheClear";

export type LeadAdminSummary = {
  newCount: number;
  today: number;
  week: number;
  month: number;
  qualified: number;
  converted: number;
  latestCreatedAt: string | null;
};

type AuthKeyResolver = () => string;
type FetchPlatformAdmin = () => Promise<{ isPlatformAdmin: boolean }>;
type FetchSummary = () => Promise<LeadAdminSummary>;

const defaultAuthKey: AuthKeyResolver = () => getToken()?.trim() || "";
const defaultFetchPlatformAdmin: FetchPlatformAdmin = () =>
  apiFetch<{ isPlatformAdmin: boolean }>("/api/auth/platform-admin");
const defaultFetchSummary: FetchSummary = () =>
  apiFetch<LeadAdminSummary>("/api/admin/marketing-leads/summary");

let authKeyImpl: AuthKeyResolver = defaultAuthKey;
let fetchPlatformAdminImpl: FetchPlatformAdmin = defaultFetchPlatformAdmin;
let fetchSummaryImpl: FetchSummary = defaultFetchSummary;

let platformAdminCache: { authKey: string; value: boolean } | null = null;
let platformAdminInFlight: { authKey: string; promise: Promise<boolean> } | null = null;

let summaryCache: { authKey: string; value: LeadAdminSummary } | null = null;
let summaryInFlight: { authKey: string; promise: Promise<LeadAdminSummary> } | null = null;

const listeners = new Set<() => void>();

function currentAuthKey(): string {
  return authKeyImpl();
}

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function subscribeLeadAdminSummary(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCachedIsPlatformAdmin(): boolean | null {
  const authKey = currentAuthKey();
  if (!authKey || !platformAdminCache || platformAdminCache.authKey !== authKey) return null;
  return platformAdminCache.value;
}

export function getCachedLeadAdminSummary(): LeadAdminSummary | null {
  const authKey = currentAuthKey();
  if (!authKey || !summaryCache || summaryCache.authKey !== authKey) return null;
  return summaryCache.value;
}

export function clearLeadAdminSummaryCache(): void {
  platformAdminCache = null;
  platformAdminInFlight = null;
  summaryCache = null;
  summaryInFlight = null;
  notify();
}

registerLeadAdminSummaryCacheClear(clearLeadAdminSummaryCache);

/** Safe probe: always 200 for authenticated users. Does not touch marketing-leads permissions. */
export async function loadIsPlatformAdmin(): Promise<boolean> {
  const authKey = currentAuthKey();
  if (!authKey) return false;
  if (platformAdminCache && platformAdminCache.authKey === authKey) {
    return platformAdminCache.value;
  }
  if (platformAdminInFlight && platformAdminInFlight.authKey === authKey) {
    return platformAdminInFlight.promise;
  }

  const promise = fetchPlatformAdminImpl()
    .then((res) => Boolean(res.isPlatformAdmin))
    .then((value) => {
      platformAdminCache = { authKey, value };
      notify();
      return value;
    })
    .finally(() => {
      if (platformAdminInFlight?.promise === promise) platformAdminInFlight = null;
    });

  platformAdminInFlight = { authKey, promise };
  return promise;
}

/**
 * Fetches marketing-leads summary only after platform-admin is confirmed.
 * Shares one in-flight promise + cache across Bell/Card/page consumers.
 */
export async function loadLeadAdminSummary(): Promise<LeadAdminSummary | null> {
  const authKey = currentAuthKey();
  if (!authKey) return null;

  const isAdmin = await loadIsPlatformAdmin();
  if (!isAdmin) return null;

  if (summaryCache && summaryCache.authKey === authKey) {
    return summaryCache.value;
  }
  if (summaryInFlight && summaryInFlight.authKey === authKey) {
    return summaryInFlight.promise;
  }

  const promise = fetchSummaryImpl()
    .then((value) => {
      summaryCache = { authKey, value };
      notify();
      return value;
    })
    .finally(() => {
      if (summaryInFlight?.promise === promise) summaryInFlight = null;
    });

  summaryInFlight = { authKey, promise };
  return promise;
}

/** Force a fresh summary fetch (polling / manual refresh). Still gated by platform-admin. */
export async function refreshLeadAdminSummary(): Promise<LeadAdminSummary | null> {
  const authKey = currentAuthKey();
  if (!authKey) return null;
  const isAdmin = await loadIsPlatformAdmin();
  if (!isAdmin) return null;

  summaryCache = null;
  if (summaryInFlight && summaryInFlight.authKey === authKey) {
    return summaryInFlight.promise;
  }

  const promise = fetchSummaryImpl()
    .then((value) => {
      summaryCache = { authKey, value };
      notify();
      return value;
    })
    .finally(() => {
      if (summaryInFlight?.promise === promise) summaryInFlight = null;
    });

  summaryInFlight = { authKey, promise };
  return promise;
}

export function __resetLeadAdminSummaryStoreForTests(): void {
  clearLeadAdminSummaryCache();
  authKeyImpl = defaultAuthKey;
  fetchPlatformAdminImpl = defaultFetchPlatformAdmin;
  fetchSummaryImpl = defaultFetchSummary;
}

export function __setLeadAdminSummaryAuthKeyForTests(resolver: AuthKeyResolver): void {
  authKeyImpl = resolver;
}

export function __setLeadAdminSummaryFetchersForTests(opts: {
  platformAdmin?: FetchPlatformAdmin;
  summary?: FetchSummary;
}): void {
  if (opts.platformAdmin) fetchPlatformAdminImpl = opts.platformAdmin;
  if (opts.summary) fetchSummaryImpl = opts.summary;
}

export function __getLeadAdminSummaryStoreSnapshotForTests() {
  return {
    platformAdminCache,
    platformAdminInFlight: Boolean(platformAdminInFlight),
    summaryCache,
    summaryInFlight: Boolean(summaryInFlight),
  };
}
