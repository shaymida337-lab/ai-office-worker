/** Sync bridge so api.ts can clear invoices caches on 401 without circular imports. */

type ClearFn = () => void;

let bootstrapClear: ClearFn | null = null;
let listClear: ClearFn | null = null;

export function registerInvoicesBootstrapCacheClear(fn: ClearFn): void {
  bootstrapClear = fn;
}

export function registerInvoicesListCacheClear(fn: ClearFn): void {
  listClear = fn;
}

export function clearInvoicesCachesNow(): void {
  bootstrapClear?.();
  listClear?.();
}
