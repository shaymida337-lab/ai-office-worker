/** Tiny sync bridge so api.ts can clear lead-admin cache without a circular import. */

type ClearFn = () => void;

let clearFn: ClearFn | null = null;

export function registerLeadAdminSummaryCacheClear(fn: ClearFn): void {
  clearFn = fn;
}

export function clearLeadAdminSummaryCacheNow(): void {
  clearFn?.();
}
