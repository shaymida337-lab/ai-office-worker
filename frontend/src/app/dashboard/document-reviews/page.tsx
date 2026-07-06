"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/Nav";
import {
  DocumentDecisionQueue,
  DocumentsCompletedSection,
  DocumentsEmptyState,
  DocumentsFilterChips,
  DocumentsMorningContext,
  DocumentsSearchBar,
} from "@/components/documents";
import { apiFetch } from "@/lib/api";
import {
  approvalErrorHebrew,
  filterDocuments,
  isToday,
  remainingDocumentsMessage,
  type DocumentFilter,
  type DocumentReviewItem,
} from "@/lib/documents/presentation";
import { colors, radius, type as typography } from "@/lib/design-tokens";

const EXIT_ANIMATION_MS = 320;

export default function DocumentReviewsPage() {
  const [pendingItems, setPendingItems] = useState<DocumentReviewItem[]>([]);
  const [completedItems, setCompletedItems] = useState<DocumentReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<DocumentFilter>("needs_decision");

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [pending, approved] = await Promise.all([
        apiFetch<DocumentReviewItem[]>("/api/document-reviews?status=needs_review"),
        apiFetch<DocumentReviewItem[]>("/api/document-reviews?status=approved"),
      ]);
      setPendingItems(pending);
      setCompletedItems(approved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "טעינת מסמכים נכשלה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const completedToday = useMemo(
    () => completedItems.filter((item) => isToday(item.createdAt)),
    [completedItems]
  );

  const filtered = useMemo(
    () => filterDocuments(pendingItems, completedItems, filter, search),
    [pendingItems, completedItems, filter, search]
  );

  const pendingCount = pendingItems.length;

  function animateRemove(id: string, onRemoved: (next: DocumentReviewItem[]) => void) {
    setExitingIds((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      setPendingItems((prev) => {
        const next = prev.filter((item) => item.id !== id);
        onRemoved(next);
        return next;
      });
      setExitingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, EXIT_ANIMATION_MS);
  }

  async function approve(id: string) {
    setUpdatingId(id);
    setError("");
    try {
      await apiFetch(`/api/document-reviews/${id}/approve`, { method: "POST" });
      const approvedItem = pendingItems.find((item) => item.id === id);
      animateRemove(id, (next) => {
        setStatusMessage("המסמך אושר והועבר לחשבוניות");
        if (next.length > 0) {
          window.setTimeout(() => {
            setStatusMessage(remainingDocumentsMessage(next.length));
          }, 2400);
        }
      });
      if (approvedItem) {
        setCompletedItems((prev) => [{ ...approvedItem, reviewStatus: "approved" }, ...prev]);
      }
    } catch (err) {
      setError(err instanceof Error ? approvalErrorHebrew(err.message) : "אישור המסמך נכשל");
    } finally {
      setUpdatingId(null);
    }
  }

  async function remove(id: string) {
    setUpdatingId(id);
    setError("");
    try {
      await apiFetch(`/api/document-reviews/${id}`, { method: "DELETE" });
      animateRemove(id, (next) => {
        setStatusMessage(remainingDocumentsMessage(next.length));
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "הסרת המסמך נכשלה");
    } finally {
      setUpdatingId(null);
    }
  }

  function openDocument(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const showCompletedFilter = filter === "completed";
  const showFilteredEmpty =
    !loading &&
    filter !== "completed" &&
    filtered.showQueue &&
    filtered.queue.length === 0 &&
    pendingCount > 0;

  return (
    <main
      className="min-h-screen max-w-full overflow-x-clip px-4 pb-32 pt-20 md:px-8 md:pb-8 lg:mr-60"
      style={{
        background: `linear-gradient(180deg, ${colors.bgSoft} 0%, ${colors.bg} 28%, ${colors.bg} 100%)`,
        color: colors.textPrimary,
      }}
    >
      <Nav />

      <div className="mx-auto grid min-w-0 max-w-3xl gap-6 md:gap-8">
        <DocumentsMorningContext
          pendingCount={pendingCount}
          loading={loading}
          statusMessage={statusMessage}
        />

        <DocumentsSearchBar value={search} onChange={setSearch} />

        <DocumentsFilterChips active={filter} onChange={setFilter} />

        {error && (
          <div
            className={`${radius.lg} border px-5 py-4 ${typography.body} font-semibold leading-7`}
            style={{
              color: colors.dangerText,
              backgroundColor: colors.dangerBg,
              borderColor: colors.dangerBorder,
            }}
          >
            {error}
          </div>
        )}

        {loading && (
          <div className="grid gap-4">
            {Array.from({ length: 2 }).map((_, index) => (
              <div
                key={index}
                className={`${radius.lg} h-72 animate-pulse border`}
                style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
              />
            ))}
          </div>
        )}

        {!loading && !showCompletedFilter && pendingCount === 0 && filtered.queue.length === 0 && (
          <DocumentsEmptyState />
        )}

        {!loading && showFilteredEmpty && (
          <p className={`${typography.body} text-center font-semibold`} style={{ color: colors.textSecondary }}>
            אין מסמכים שמתאימים לסינון הזה
          </p>
        )}

        {!loading && filtered.showQueue && filtered.queue.length > 0 && (
          <DocumentDecisionQueue
            items={filtered.queue}
            totalCount={filtered.queue.length}
            exitingIds={exitingIds}
            updatingId={updatingId}
            onApprove={approve}
            onOpen={openDocument}
            onRemove={remove}
          />
        )}

        {!loading && showCompletedFilter && (
          filtered.completed.length > 0 ? (
            <DocumentsCompletedSection items={filtered.completed} defaultOpen />
          ) : (
            <DocumentsEmptyState />
          )
        )}

        {!loading && !showCompletedFilter && (
          <DocumentsCompletedSection items={completedToday} />
        )}
      </div>
    </main>
  );
}
