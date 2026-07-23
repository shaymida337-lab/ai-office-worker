/** Tiny sync bridge so api.ts can clear org-settings cache without a circular import. */

type ClearFn = () => void;

let clearFn: ClearFn | null = null;

export function registerOrganizationSettingsCacheClear(fn: ClearFn): void {
  clearFn = fn;
}

export function clearOrganizationSettingsCacheNow(): void {
  clearFn?.();
}
