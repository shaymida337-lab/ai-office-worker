/** Sync bridge so api.ts can clear completion caches on 401 without circular imports. */
type ClearFn = () => void;

let bootstrapClear: ClearFn | null = null;
let listClear: ClearFn | null = null;

export function registerCompletionBootstrapCacheClear(fn: ClearFn): void {
  bootstrapClear = fn;
}

export function registerCompletionListCacheClear(fn: ClearFn): void {
  listClear = fn;
}

export function clearCompletionCachesNow(): void {
  bootstrapClear?.();
  listClear?.();
}
