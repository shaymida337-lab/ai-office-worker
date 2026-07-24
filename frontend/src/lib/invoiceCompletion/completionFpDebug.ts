/** Opt-in invoice-completion First Paint diagnostics — localStorage.INVOICE_COMPLETION_FP_DEBUG=1 or env. */
export function isCompletionFpDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage?.getItem("INVOICE_COMPLETION_FP_DEBUG") === "1") return true;
  } catch {
    /* ignore */
  }
  return (
    process.env.NEXT_PUBLIC_INVOICE_COMPLETION_FP_DEBUG === "1" ||
    process.env.INVOICE_COMPLETION_FP_DEBUG === "1"
  );
}

export function completionFpDebug(
  event: string,
  payload?: Record<string, string | number | boolean | null | undefined>
): void {
  if (!isCompletionFpDebugEnabled()) return;
  const safe: Record<string, string | number | boolean | null> = {};
  if (payload) {
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined) continue;
      // Never log tokens, names, invoice numbers, amounts, headers, bodies, or OCR.
      if (/token|email|supplier|invoice|amount|header|body|name|phone|ocr|pii/i.test(key)) continue;
      safe[key] = value;
    }
  }
  console.info(`[completion-fp] ${event}`, safe);
}
