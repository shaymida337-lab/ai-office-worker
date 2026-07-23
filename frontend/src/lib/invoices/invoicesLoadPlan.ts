/**
 * Invoices First Paint plan: bootstrap + slim list in parallel (≤2 requests).
 */

export const INVOICES_FIRST_PAINT_KEYS = ["bootstrap", "list"] as const;

export type InvoicesFirstPaintKey = (typeof INVOICES_FIRST_PAINT_KEYS)[number];

export const INVOICES_FIRST_PAINT_FORBIDDEN_KEYS = [
  "clients",
  "months",
  "months-complete",
  "months-incomplete",
  "stats",
  "suppliers-full",
  "document-reviews",
  "gmail-status",
  "gmail-api",
  "drive-api",
  "organization-settings",
  "invoice-by-month-fanout",
] as const;

/** Background-only keys — must not gate First Paint loading. */
export const INVOICES_BACKGROUND_KEYS = ["clients"] as const;

export function assertInvoicesFirstPaintBudget(keys: readonly string[] = INVOICES_FIRST_PAINT_KEYS) {
  if (keys.length > 2) {
    throw new Error(`Invoices First Paint allows at most 2 requests, got ${keys.length}`);
  }
  for (const key of keys) {
    if ((INVOICES_FIRST_PAINT_FORBIDDEN_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Invoices First Paint must not include heavy key: ${key}`);
    }
  }
}

export async function runInvoicesLoadPhases(options: {
  loadFirstPaint: () => Promise<void>;
  loadBackground?: () => Promise<void>;
  onFirstPaintReady: () => void;
  onBackgroundError?: (error: unknown) => void;
  isCurrent?: () => boolean;
}): Promise<void> {
  assertInvoicesFirstPaintBudget();
  await options.loadFirstPaint();
  if (options.isCurrent && !options.isCurrent()) return;
  options.onFirstPaintReady();
  if (!options.loadBackground) return;
  if (options.isCurrent && !options.isCurrent()) return;
  try {
    await options.loadBackground();
  } catch (error) {
    options.onBackgroundError?.(error);
  }
}
