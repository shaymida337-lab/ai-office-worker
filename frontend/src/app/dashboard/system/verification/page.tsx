"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ClipboardCheck, RefreshCw, Search } from "lucide-react";
import { Nav } from "@/components/Nav";
import { VerificationBadge } from "@/components/verification/VerificationBadge";
import { VerificationTimeline } from "@/components/verification/VerificationTimeline";
import { apiFetch } from "@/lib/api";
import { colors, radius, shadow, spacing, type as typography } from "@/lib/design-tokens";
import {
  buildVerificationQueryString,
  formatVerificationAmount,
  formatVerificationDate,
  formatVerificationPercent,
  verificationBadgeTone,
} from "@/lib/verificationCenterFormat";
import type { VerificationCenterResponse, VerificationDocumentSummary } from "@/types/verificationCenter";

const DEFAULT_LIMIT = "25";

export default function VerificationCenterPage() {
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [outcome, setOutcome] = useState("");
  const [review, setReview] = useState("");
  const [supplier, setSupplier] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [confidence, setConfidence] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [data, setData] = useState<VerificationCenterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);

  const filterState = useMemo(
    () => ({ days, limit, outcome, review, supplier, blocked, duplicate, confidence, search }),
    [days, limit, outcome, review, supplier, blocked, duplicate, confidence, search]
  );

  const load = useCallback(
    async (options?: { append?: boolean; cursorOverride?: string | null }) => {
      const append = options?.append ?? false;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError("");

      try {
        const query = buildVerificationQueryString(
          filterState,
          append ? options?.cursorOverride ?? cursor : null
        );
        const response = await apiFetch<VerificationCenterResponse>(
          `/api/internal/verification?${query}`,
          { timeoutMs: 30000 }
        );
        setData((current) =>
          append && current
            ? {
                ...response,
                documents: [...current.documents, ...response.documents],
              }
            : response
        );
        setCursor(response.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "טעינת מרכז האימות נכשלה");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [cursor, filterState]
  );

  useEffect(() => {
    setCursor(null);
    void load();
  }, [days, limit, outcome, review, supplier, blocked, duplicate, confidence, search]);

  const rangeLabel =
    data?.dateRange != null
      ? `${new Date(data.dateRange.from).toLocaleDateString("he-IL")} – ${new Date(data.dateRange.to).toLocaleDateString("he-IL")}`
      : `${days} ימים`;

  return (
    <div className="container">
      <Nav />
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="page-kicker">מערכת · איכות הנדסית</div>
          <h1 className="flex items-center gap-2">
            <ClipboardCheck className="h-7 w-7" style={{ color: colors.accent }} />
            מרכז אימות מסמכים
          </h1>
          <p style={{ color: colors.textSecondary }}>
            בדיקת החלטות מנועים לכל מסמך — read-only, ללא OCR גולמי, פרומפטים או קישורי Drive.
          </p>
          <p className="mt-2 text-sm" style={{ color: colors.textMuted }}>
            טווח: {rangeLabel} · גרסה: {data?.version ?? "—"} · הוחזרו: {data?.totalReturned ?? 0}
          </p>
        </div>
        <button className="btn btn-secondary min-h-[44px]" onClick={() => void load()} disabled={loading}>
          <span className="inline-flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "מרענן..." : "רענן"}
          </span>
        </button>
      </div>

      <section className={`${radius.card} ${shadow.card} ${spacing.card} mb-6 grid gap-4`}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-sm">
            <span style={{ color: colors.textMuted }}>ימים</span>
            <select className="min-h-11 rounded-xl border px-3" value={days} onChange={(e) => setDays(e.target.value as "7" | "30" | "90")}>
              <option value="7">7</option>
              <option value="30">30</option>
              <option value="90">90</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span style={{ color: colors.textMuted }}>Outcome</span>
            <select className="min-h-11 rounded-xl border px-3" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">הכל</option>
              <option value="SAVED">Saved</option>
              <option value="NEEDS_REVIEW">Needs Review</option>
              <option value="BLOCKED">Blocked</option>
              <option value="DUPLICATE">Duplicate</option>
              <option value="NOT_FINANCIAL">Not Financial</option>
              <option value="ERROR">Error</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span style={{ color: colors.textMuted }}>Review</span>
            <select className="min-h-11 rounded-xl border px-3" value={review} onChange={(e) => setReview(e.target.value)}>
              <option value="">הכל</option>
              <option value="auto_saved">auto_saved</option>
              <option value="needs_review">needs_review</option>
              <option value="duplicate">duplicate</option>
              <option value="blocked">blocked</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span style={{ color: colors.textMuted }}>ספק</span>
            <select className="min-h-11 rounded-xl border px-3" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">הכל</option>
              <option value="resolved">Resolved</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span style={{ color: colors.textMuted }}>ביטחון</span>
            <select className="min-h-11 rounded-xl border px-3" value={confidence} onChange={(e) => setConfidence(e.target.value)}>
              <option value="">הכל</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span style={{ color: colors.textMuted }}>Limit</span>
            <select className="min-h-11 rounded-xl border px-3" value={limit} onChange={(e) => setLimit(e.target.value)}>
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} />
            Blocked
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={duplicate} onChange={(e) => setDuplicate(e.target.checked)} />
            Duplicate
          </label>
        </div>

        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: colors.textMuted }} />
            <input
              className="min-h-11 w-full rounded-xl border pr-10 pl-3"
              placeholder="חיפוש לפי ספק, מספר חשבונית, Gmail message id"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-secondary min-h-11">
            חפש
          </button>
        </form>
      </section>

      {error ? (
        <div
          className="mb-6 rounded-2xl border p-4"
          style={{ borderColor: colors.dangerBorder, backgroundColor: colors.dangerBg, color: colors.dangerText }}
        >
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="card">
          <p>טוען מסמכים...</p>
        </div>
      ) : (
        <div className={`${radius.card} ${shadow.card} overflow-hidden border`} style={{ borderColor: colors.border }}>
          <div className="table-shell overflow-x-auto">
            <table className="min-w-[960px]">
              <thead>
                <tr>
                  <th />
                  <th>מזהה</th>
                  <th>נוצר</th>
                  <th>ספק</th>
                  <th>סכום</th>
                  <th>סוג</th>
                  <th>Outcome</th>
                  <th>Trust</th>
                  <th>ARC</th>
                  <th>SIR</th>
                  <th>FSE</th>
                  <th>Golden</th>
                </tr>
              </thead>
              <tbody>
                {(data?.documents ?? []).map((doc) => (
                  <VerificationRow
                    key={doc.documentId}
                    doc={doc}
                    expanded={expandedId === doc.documentId}
                    onToggle={() =>
                      setExpandedId((current) => (current === doc.documentId ? null : doc.documentId))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          {(data?.documents.length ?? 0) === 0 ? (
            <div className="p-6 text-center" style={{ color: colors.textMuted }}>
              לא נמצאו מסמכים בטווח ובפילטרים שנבחרו.
            </div>
          ) : null}
          {cursor ? (
            <div className="border-t p-4 text-center" style={{ borderColor: colors.border }}>
              <button
                className="btn btn-secondary min-h-11"
                disabled={loadingMore}
                onClick={() => void load({ append: true, cursorOverride: cursor })}
              >
                {loadingMore ? "טוען..." : "טען עוד"}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function VerificationRow({
  doc,
  expanded,
  onToggle,
}: {
  doc: VerificationDocumentSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  const tone = verificationBadgeTone(doc);

  return (
    <Fragment>
      <tr className="cursor-pointer hover:bg-black/[0.02]" onClick={onToggle}>
        <td>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </td>
        <td className="font-mono text-xs">{doc.documentId}</td>
        <td>{formatVerificationDate(doc.createdAt)}</td>
        <td>{doc.supplier ?? "—"}</td>
        <td>{formatVerificationAmount(doc.amount)}</td>
        <td>{doc.documentType ?? "—"}</td>
        <td>
          <VerificationBadge tone={tone} />
        </td>
        <td>{formatVerificationPercent(doc.trustConfidence)}</td>
        <td>{formatVerificationPercent(doc.arcConfidence)}</td>
        <td>{formatVerificationPercent(doc.sirConfidence)}</td>
        <td>{formatVerificationPercent(doc.fseTrust)}</td>
        <td>{doc.goldenMatch ?? "—"}</td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={12} className="bg-black/[0.02] p-4">
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetaItem label="Review status" value={doc.reviewStatus ?? "—"} />
              <MetaItem label="Invoice #" value={doc.invoiceNumberMasked ?? "—"} />
              <MetaItem label="Gmail message" value={doc.gmailMessageIdPrefix ?? "—"} />
              <MetaItem label="Source" value={doc.source} />
            </div>
            <h3 className={`${typography.sectionTitle} mb-3`} style={{ color: colors.textPrimary }}>
              ציר זמן מנועים
            </h3>
            <VerificationTimeline stages={doc.timeline} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${radius.control} border p-3`} style={{ borderColor: colors.border, backgroundColor: colors.surface }}>
      <div className="text-xs" style={{ color: colors.textMuted }}>
        {label}
      </div>
      <div className="mt-1 text-sm font-medium" style={{ color: colors.textPrimary }}>
        {value}
      </div>
    </div>
  );
}
