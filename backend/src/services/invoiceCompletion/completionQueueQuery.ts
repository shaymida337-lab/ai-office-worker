/**
 * Bounded, exact pagination for invoice-completion queue.
 *
 * Completeness + non-financial queue filters are post-DB (parity with legacy path).
 * Strategy: scan source tables in CHUNK-sized findMany waves (never unbounded),
 * map → filter → deterministic sort (primary + id) → slice page.
 * Readiness is intentionally NOT applied here — caller applies only to ≤pageSize.
 */
import {
  filterInvoiceCompletionQueueCandidates,
  filterInvoicesByCompleteness,
} from "../amount/invoiceCompleteness.js";
import {
  clampCompletionListPage,
  clampCompletionListPageSize,
  filterCompletionCandidatesBySearch,
  filterCompletionCandidatesByStatus,
  sortCompletionCandidates,
  type CompletionListCandidateLike,
  type CompletionListSort,
} from "./completionList.js";

/** Each Prisma findMany is capped at this many rows. */
export const COMPLETION_SCAN_CHUNK = 100;
/**
 * Hard safety ceiling on source rows scanned across all waves.
 * If hit, result.truncated=true and total is exact only for the scanned set
 * (never silently pretend the org has ≤300 docs).
 */
export const COMPLETION_SCAN_MAX_SOURCE_ROWS = 10_000;

export type CompletionQueueScanStats = {
  sourceRowsScanned: number;
  waves: number;
  truncated: boolean;
  matchCount: number;
};

export type CompletionQueuePageResult<T extends CompletionListCandidateLike> = {
  pageRows: T[];
  /** Full filtered+sorted match set (bounded by scan ceiling). Used for exact total/bootstrap. */
  matched: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  truncated: boolean;
  sourceRowsScanned: number;
  waves: number;
};

export type CompletionSourceBatch<TRow> = {
  rows: TRow[];
  /** True when this source has no more rows after this batch. */
  done: boolean;
};

/**
 * Deterministic compare: primary sort field, then createdAt for date sorts, then id.
 */
export function compareCompletionCandidates(
  a: CompletionListCandidateLike,
  b: CompletionListCandidateLike,
  sort: CompletionListSort = "date_desc"
): number {
  let primary = 0;
  switch (sort) {
    case "date_asc":
      primary = a.date.getTime() - b.date.getTime();
      if (primary !== 0) return primary;
      primary = a.createdAt.getTime() - b.createdAt.getTime();
      break;
    case "amount_desc":
      primary = (b.amount ?? -Infinity) - (a.amount ?? -Infinity);
      break;
    case "amount_asc":
      primary = (a.amount ?? Infinity) - (b.amount ?? Infinity);
      break;
    case "date_desc":
    default:
      primary = b.date.getTime() - a.date.getTime();
      if (primary !== 0) return primary;
      primary = b.createdAt.getTime() - a.createdAt.getTime();
      break;
  }
  if (primary !== 0) return primary;
  if (sort === "date_asc" || sort === "amount_asc") {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
}

export function sortCompletionCandidatesStable<T extends CompletionListCandidateLike>(
  rows: T[],
  sort: CompletionListSort = "date_desc"
): T[] {
  return sortCompletionCandidates(rows, sort);
}

export function applyCompletionQueueFilters<T extends CompletionListCandidateLike>(
  candidates: T[],
  options?: { status?: string; search?: string }
): T[] {
  const incomplete = filterInvoicesByCompleteness(candidates, "incomplete");
  const queued = filterInvoiceCompletionQueueCandidates(incomplete);
  const byStatus = filterCompletionCandidatesByStatus(queued, options?.status);
  return filterCompletionCandidatesBySearch(byStatus, options?.search);
}

/**
 * Merge batches from multiple sources already loaded, filter, sort, paginate.
 * Pure — used by route + unit tests (301+ fixtures without DB).
 */
export function paginateFilteredCompletionCandidates<T extends CompletionListCandidateLike>(
  candidates: T[],
  input: {
    page?: number;
    pageSize?: number;
    sort?: CompletionListSort;
    status?: string;
    search?: string;
    truncated?: boolean;
    sourceRowsScanned?: number;
    waves?: number;
  }
): CompletionQueuePageResult<T> {
  const page = clampCompletionListPage(input.page);
  const pageSize = clampCompletionListPageSize(input.pageSize);
  const sort = input.sort ?? "date_desc";
  const matched = applyCompletionQueueFilters(candidates, {
    status: input.status,
    search: input.search,
  });
  const sorted = sortCompletionCandidatesStable(matched, sort);
  const total = sorted.length;
  const start = (page - 1) * pageSize;
  const pageRows = sorted.slice(start, start + pageSize);
  return {
    pageRows,
    matched: sorted,
    page,
    pageSize,
    total,
    hasMore: start + pageSize < total,
    truncated: Boolean(input.truncated),
    sourceRowsScanned: input.sourceRowsScanned ?? candidates.length,
    waves: input.waves ?? 0,
  };
}

export type CompletionBatchLoader<T extends CompletionListCandidateLike> = (args: {
  skip: number;
  take: number;
}) => Promise<T[]>;

/**
 * Load all source candidates via bounded skip/take waves, then filter/sort/page.
 * `loadBatch` must return rows for the global merge stream already mapped to candidates
 * (caller merges sources). Prefer `scanCompletionQueueFromSources` for multi-source.
 */
export async function scanCompletionQueueWithBatchLoader<T extends CompletionListCandidateLike>(
  loadBatch: CompletionBatchLoader<T>,
  input: {
    page?: number;
    pageSize?: number;
    sort?: CompletionListSort;
    status?: string;
    search?: string;
    chunk?: number;
    maxSourceRows?: number;
  }
): Promise<CompletionQueuePageResult<T>> {
  const chunk = input.chunk ?? COMPLETION_SCAN_CHUNK;
  const maxRows = input.maxSourceRows ?? COMPLETION_SCAN_MAX_SOURCE_ROWS;
  const collected: T[] = [];
  let skip = 0;
  let waves = 0;
  let truncated = false;

  while (collected.length < maxRows) {
    const take = Math.min(chunk, maxRows - collected.length);
    waves += 1;
    const batch = await loadBatch({ skip, take });
    if (batch.length === 0) break;
    collected.push(...batch);
    skip += batch.length;
    if (batch.length < take) break;
    if (collected.length >= maxRows) {
      truncated = true;
      break;
    }
  }

  return paginateFilteredCompletionCandidates(collected, {
    page: input.page,
    pageSize: input.pageSize,
    sort: input.sort,
    status: input.status,
    search: input.search,
    truncated,
    sourceRowsScanned: collected.length,
    waves,
  });
}

export type CompletionSourceLoader<TRow> = (args: {
  skip: number;
  take: number;
}) => Promise<TRow[]>;

/**
 * Multi-source scan: exhaust each source with CHUNK findMany, concat, then
 * filter/sort/page. Each findMany is bounded; total source rows ≤ maxSourceRows.
 */
export async function scanCompletionQueueFromSources<TRow, T extends CompletionListCandidateLike>(
  sources: Array<{
    name: string;
    load: CompletionSourceLoader<TRow>;
    map: (row: TRow) => T;
  }>,
  input: {
    page?: number;
    pageSize?: number;
    sort?: CompletionListSort;
    status?: string;
    search?: string;
    chunk?: number;
    maxSourceRows?: number;
  }
): Promise<CompletionQueuePageResult<T>> {
  const chunk = input.chunk ?? COMPLETION_SCAN_CHUNK;
  const maxRows = input.maxSourceRows ?? COMPLETION_SCAN_MAX_SOURCE_ROWS;
  const collected: T[] = [];
  let waves = 0;
  let truncated = false;

  for (const source of sources) {
    let skip = 0;
    for (;;) {
      if (collected.length >= maxRows) {
        truncated = true;
        break;
      }
      const take = Math.min(chunk, maxRows - collected.length);
      waves += 1;
      const rows = await source.load({ skip, take });
      if (rows.length === 0) break;
      for (const row of rows) {
        collected.push(source.map(row));
      }
      skip += rows.length;
      if (rows.length < take) break;
    }
    if (truncated) break;
  }

  return paginateFilteredCompletionCandidates(collected, {
    page: input.page,
    pageSize: input.pageSize,
    sort: input.sort,
    status: input.status,
    search: input.search,
    truncated,
    sourceRowsScanned: collected.length,
    waves,
  });
}

/**
 * Bootstrap aggregates over the full matched set (same filters as list).
 * Does not run readiness.
 */
export function aggregateCompletionBootstrapFromCandidates<T extends CompletionListCandidateLike>(
  candidates: T[],
  options?: { status?: string; search?: string; truncated?: boolean }
): {
  matched: T[];
  truncated: boolean;
} {
  const matched = applyCompletionQueueFilters(candidates, {
    status: options?.status,
    search: options?.search,
  });
  return { matched, truncated: Boolean(options?.truncated) };
}
