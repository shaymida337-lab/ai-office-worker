/** Sync bridge so api.ts can clear calendar caches without circular imports. */

type ClearFn = () => void;

let clearBootstrapFn: ClearFn | null = null;
let clearEventsFn: ClearFn | null = null;

export function registerCalendarBootstrapCacheClear(fn: ClearFn): void {
  clearBootstrapFn = fn;
}

export function registerCalendarEventsCacheClear(fn: ClearFn): void {
  clearEventsFn = fn;
}

export function clearCalendarBootstrapCacheNow(): void {
  clearBootstrapFn?.();
}

export function clearCalendarEventsCacheNow(): void {
  clearEventsFn?.();
}

export function clearAllCalendarCachesNow(): void {
  clearBootstrapFn?.();
  clearEventsFn?.();
}
