/** User-visible document count from GmailScanItem rows in the scan window. */
export function documentsFoundFromScanItems(classifiedCount: number, rejectedCount: number): number {
  return classifiedCount + rejectedCount;
}

/** Prefer live DB item counts; fall back to persisted syncLog counters. */
export function resolveDocumentsFound(input: {
  classifiedCount: number;
  rejectedCount: number;
  persistedInvoicesFound?: number | null;
}): number {
  const fromItems = documentsFoundFromScanItems(input.classifiedCount, input.rejectedCount);
  if (fromItems > 0) return fromItems;
  return input.persistedInvoicesFound ?? 0;
}

/** Persisted counter during scan: auto-saved invoices + needs-review items. */
export function persistedDocumentsFound(invoicesCreated: number, needsReviewCount: number): number {
  return invoicesCreated + needsReviewCount;
}
