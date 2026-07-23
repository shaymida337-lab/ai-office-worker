/** Sync bridge so api.ts can clear dashboard bootstrap cache without circular imports. */

type ClearFn = () => void;

let clearFn: ClearFn | null = null;

export function registerDashboardBootstrapCacheClear(fn: ClearFn): void {
  clearFn = fn;
}

export function clearDashboardBootstrapCacheNow(): void {
  clearFn?.();
}
