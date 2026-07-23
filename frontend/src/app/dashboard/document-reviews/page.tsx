"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DocumentDecisionQueue,
  DocumentsCompletedSection,
  DocumentsEmptyState,
  DocumentsFilterChips,
  DocumentsMorningContext,
  DocumentsSearchBar,
} from "@/components/documents";
import {
  AppShell,
  MessageBanner,
  PageTitle,
  SkeletonCard,
} from "@/components/natalie-ui";
import { useI18n } from "@/i18n";
import { apiFetch } from "@/lib/api";
import { invalidateDashboardBootstrap } from "@/lib/dashboard/dashboardBootstrapStore";
import {
  approvalErrorHebrew,
  filterDocuments,
  isToday,
  remainingDocumentsMessage,
  type DocumentFilter,
  type DocumentReviewItem,
} from "@/lib/documents/presentation";
import {
  APPROVAL_FAILURE_MESSAGE,
  APPROVAL_SUCCESS_MESSAGE,
  isConfirmedApprovalResponse,
  type DocumentReviewApprovalResponse,
} from "@/lib/documents/approvalFlow";

const EXIT_ANIMATION_MS = 320;

export default function DocumentReviewsPage() {
  const { t, dir } = useI18n();
  const [pendingItems, setPendingItems] = useState<DocumentReviewItem[]>([]);
  const [completedItems, setCompletedItems] = useState<DocumentReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<DocumentFilter>("needs_decision");

  const loadItems = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    setError("");
    try {
      const [pending, approved] = await Promise.all([
        apiFetch<DocumentReviewItem[]>("/api/document-reviews?status=needs_review"),
        apiFetch<DocumentReviewItem[]>("/api/document-reviews?status=approved"),
      ]);
      setPendingItems(pending);
      setCompletedItems(approved);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("documentsDesign.loadError"));
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [t]);

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

  async function approve(id: string, supplierName: string) {
    if (updatingId) return;
    setUpdatingId(id);
    setError("");
    try {
      const result = await apiFetch<DocumentReviewApprovalResponse & {
        item: DocumentReviewItem;
        targetScreen: "invoices" | "payments";
      }>(`/api/document-reviews/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ supplierName }),
      });
      if (!isConfirmedApprovalResponse(result)) {
        throw new Error(APPROVAL_FAILURE_MESSAGE);
      }
      invalidateDashboardBootstrap();
      const approvedItem = pendingItems.find((item) => item.id === id);
      animateRemove(id, (next) => {
        setStatusMessage(APPROVAL_SUCCESS_MESSAGE);
        if (next.length > 0) {
          window.setTimeout(() => {
            setStatusMessage(remainingDocumentsMessage(next.length));
          }, 2400);
        }
      });
      void loadItems({ silent: true });
      if (approvedItem && result.item) {
        setCompletedItems((prev) => [
          { ...approvedItem, ...result.item, reviewStatus: "approved" },
          ...prev,
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? approvalErrorHebrew(err.message) : APPROVAL_FAILURE_MESSAGE);
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
      setError(err instanceof Error ? err.message : t("documentsDesign.removeError"));
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
    <div dir={dir}>
      <AppShell
        pageTitle={<PageTitle title={t("documentsDesign.title")} subtitle={t("documentsDesign.subtitle")} />}
      >
        <div className="mx-auto grid min-w-0 max-w-3xl gap-4">
          <DocumentsMorningContext
            pendingCount={pendingCount}
            loading={loading}
            statusMessage={statusMessage}
          />

          <DocumentsSearchBar value={search} onChange={setSearch} />

          <DocumentsFilterChips active={filter} onChange={setFilter} />

          {error ? (
            <MessageBanner tone="error">{error}</MessageBanner>
          ) : null}

          {loading ? (
            <div className="grid gap-4">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : null}

          {!loading && !showCompletedFilter && pendingCount === 0 && filtered.queue.length === 0 && (
            <DocumentsEmptyState />
          )}

          {!loading && showFilteredEmpty && (
            <p className="text-center text-base font-semibold text-[var(--natalie-text-muted,#64748B)]">
              {t("documentsDesign.filterEmpty")}
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
      </AppShell>
    </div>
  );
}
