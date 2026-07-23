/** Opt-in invoices First Paint diagnostics — localStorage.INVOICES_FP_DEBUG=1 or env. */
export function isInvoicesFpDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage?.getItem("INVOICES_FP_DEBUG") === "1";
  } catch {
    return false;
  }
}

export function invoicesFpDebug(
  event: string,
  payload?: Record<string, string | number | boolean | null | undefined>
): void {
  if (!isInvoicesFpDebugEnabled()) return;
  const safe: Record<string, string | number | boolean | null> = {};
  if (payload) {
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined) continue;
      // Never log tokens, names, invoice numbers, amounts, headers, or bodies.
      if (/token|email|supplier|invoice|amount|header|body|name|phone/i.test(key)) continue;
      safe[key] = value;
    }
  }
  console.info(`[invoices-fp] ${event}`, safe);
}
