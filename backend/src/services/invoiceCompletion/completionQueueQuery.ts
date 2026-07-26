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
 * Dedupe GSI + FDR mirrors for the same Gmail document (completion queue only).
 * Mirrors mergeInvoiceListCandidates message-ref suppression, plus fingerprint/duplicateKey.
 *
 * Preference (same gmail/email/fingerprint cluster):
 * 1. Actionable (needs_review / visible) beats rejected / quarantined / blocked / hidden.
 * 2. When both are actionable (or both non-actionable): prefer gmail_scan_item over FDR.
 * Distinct documents (no shared refs) stay separate.
 */
export type CompletionDedupeCandidateFields = {
  id: string;
  source: string;
  gmailMessageId?: string | null;
  emailMessageId?: string | null;
  documentFingerprint?: string | null;
  duplicateKey?: string | null;
  reviewStatus?: string | null;
  status?: string | null;
  decisionReason?: string | null;
  uncertaintyReason?: string | null;
};

const NON_ACTIONABLE_REVIEW_STATUSES = new Set([
  "rejected",
  "duplicate",
  "blocked",
  "hidden",
]);

function completionDedupeRefs(candidate: CompletionDedupeCandidateFields): string[] {
  const refs: string[] = [];
  if (candidate.gmailMessageId) refs.push(`gmail:${candidate.gmailMessageId}`);
  if (candidate.emailMessageId) refs.push(`email:${candidate.emailMessageId}`);
  const fingerprint = candidate.documentFingerprint ?? candidate.duplicateKey;
  if (fingerprint) refs.push(`fp:${fingerprint}`);
  return refs;
}

/** Visible/actionable for queue dedupe — not rejected/quarantine mirrors that hide a live FDR. */
export function isCompletionDedupeActionable(candidate: CompletionDedupeCandidateFields): boolean {
  const status = String(candidate.reviewStatus || candidate.status || "")
    .trim()
    .toLowerCase();
  if (NON_ACTIONABLE_REVIEW_STATUSES.has(status)) return false;
  const reason = `${candidate.decisionReason ?? ""} ${candidate.uncertaintyReason ?? ""}`;
  // Cross-org quarantine (and similar) — typically paired with rejected; never prefer over needs_review.
  if (/quarantin/i.test(reason)) return false;
  return true;
}

function isGmailScanItemSource(candidate: CompletionDedupeCandidateFields): boolean {
  return candidate.source === "gmail_scan_item";
}

/**
 * Pick the better of two candidates that share a dedupe ref.
 * Actionable wins; ties break toward GSI (legacy preference).
 */
export function preferCompletionDedupeCandidate<T extends CompletionDedupeCandidateFields>(
  a: T,
  b: T
): T {
  const aActionable = isCompletionDedupeActionable(a);
  const bActionable = isCompletionDedupeActionable(b);
  if (aActionable !== bActionable) return aActionable ? a : b;
  const aGsi = isGmailScanItemSource(a);
  const bGsi = isGmailScanItemSource(b);
  if (aGsi !== bGsi) return aGsi ? a : b;
  return a;
}

export function dedupeCompletionCandidatesPreferGsi<T extends CompletionDedupeCandidateFields>(
  candidates: T[]
): T[] {
  if (candidates.length <= 1) return candidates;

  const parent = candidates.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    let cursor = index;
    while (cursor !== root) {
      const next = parent[cursor]!;
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  const refToIndex = new Map<string, number>();
  for (let i = 0; i < candidates.length; i++) {
    for (const ref of completionDedupeRefs(candidates[i]!)) {
      const prev = refToIndex.get(ref);
      if (prev !== undefined) union(i, prev);
      else refToIndex.set(ref, i);
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < candidates.length; i++) {
    const root = find(i);
    const members = clusters.get(root);
    if (members) members.push(i);
    else clusters.set(root, [i]);
  }

  const out: T[] = [];
  const emitted = new Set<number>();
  for (let i = 0; i < candidates.length; i++) {
    const root = find(i);
    if (emitted.has(root)) continue;
    emitted.add(root);
    const members = clusters.get(root) ?? [i];
    let winner = candidates[members[0]!]!;
    for (let m = 1; m < members.length; m++) {
      winner = preferCompletionDedupeCandidate(winner, candidates[members[m]!]!);
    }
    out.push(winner);
  }
  return out;
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
    /** Applied after source concat, before completeness filter + pagination. */
    dedupeCandidates?: (candidates: T[]) => T[];
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

  const sourceRowsScanned = collected.length;
  const deduped = input.dedupeCandidates ? input.dedupeCandidates(collected) : collected;

  return paginateFilteredCompletionCandidates(deduped, {
    page: input.page,
    pageSize: input.pageSize,
    sort: input.sort,
    status: input.status,
    search: input.search,
    truncated,
    sourceRowsScanned,
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
