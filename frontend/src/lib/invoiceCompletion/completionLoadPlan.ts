/**
 * Invoice-completion First Paint plan: bootstrap + slim list in parallel (≤2 requests).
 */

export const COMPLETION_FIRST_PAINT_KEYS = ["bootstrap", "list"] as const;

export type CompletionFirstPaintKey = (typeof COMPLETION_FIRST_PAINT_KEYS)[number];

export const COMPLETION_FIRST_PAINT_FORBIDDEN_KEYS = [
  "clients",
  "months",
  "stats",
  "suppliers-full",
  "document-reviews",
  "gmail-status",
  "gmail-api",
  "drive-api",
  "organization-settings",
  "ocr",
  "enrichment",
  "legacy-invoices-incomplete-300",
] as const;

export function assertCompletionFirstPaintBudget(keys: readonly string[] = COMPLETION_FIRST_PAINT_KEYS) {
  if (keys.length > 2) {
    throw new Error(`Completion First Paint allows at most 2 requests, got ${keys.length}`);
  }
  for (const key of keys) {
    if ((COMPLETION_FIRST_PAINT_FORBIDDEN_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Completion First Paint must not include heavy key: ${key}`);
    }
  }
}

export async function runCompletionLoadPhases(options: {
  loadFirstPaint: () => Promise<void>;
  loadBackground?: () => Promise<void>;
  onFirstPaintReady: () => void;
  onBackgroundError?: (error: unknown) => void;
  isCurrent?: () => boolean;
}): Promise<void> {
  assertCompletionFirstPaintBudget();
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

/** Truncated scan UX — list/bootstrap hit the hard source-row ceiling. */
export const COMPLETION_TRUNCATED_MESSAGE =
  "מוצגות תוצאות חלקיות. יש לצמצם את החיפוש או המסננים.";

export function isCompletionTruncated(flags: {
  listTruncated?: boolean | null;
  bootstrapTruncated?: boolean | null;
}): boolean {
  return flags.listTruncated === true || flags.bootstrapTruncated === true;
}

export function completionTruncatedBannerText(truncated: boolean): string | null {
  return truncated ? COMPLETION_TRUNCATED_MESSAGE : null;
}

/**
 * When truncated, pagination must not invent pages beyond the scanned match set.
 * `total` is exact only for that set — never treat it as the org-wide universe.
 */
export function maxSupportedCompletionPage(input: {
  truncated: boolean;
  total: number;
  pageSize: number;
}): number {
  const pageSize = Math.max(1, input.pageSize);
  const total = Math.max(0, input.total);
  if (total === 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

export function shouldFetchCompletionPage(input: {
  truncated: boolean;
  page: number;
  total: number;
  pageSize: number;
  hasMore: boolean;
}): boolean {
  if (input.page < 1) return false;
  const maxPage = maxSupportedCompletionPage(input);
  if (input.page > maxPage) return false;
  if (input.page === 1) return true;
  return input.hasMore && input.page <= maxPage;
}
