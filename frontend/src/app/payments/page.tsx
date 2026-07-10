"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PaymentDecisionQueue,
  PaymentMorningContext,
  PaymentRecommendationCard,
  PaymentsArchiveSection,
  PaymentsCommandBar,
  PaymentsCompletedSection,
  PaymentsSnapshot,
} from "@/components/payments";
import { AppShell, Card, MessageBanner, PageTitle, Skeleton } from "@/components/natalie-ui";
import { useI18n } from "@/i18n";
import { apiFetch, type Payment } from "@/lib/api";
import { isJunkPayment } from "@/lib/junkSupplier";
import {
  buildCompletedLines,
  buildSnapshotMetrics,
  matchesPaymentSearch,
  paymentDueKind,
  sortPaymentsForQueue,
  toDrivePreviewUrl,
} from "@/lib/payments/presentation";
import {
  remainingPaymentsMessage,
  resolvePaymentRecommendation,
} from "@/lib/payments/recommendation";
import { colors, radius, button, shadow, spacing, type as typography } from "@/lib/design-tokens";

const EXIT_ANIMATION_MS = 320;
const LARGE_AMOUNT_THRESHOLD = 5000;

export default function PaymentsPage() {
  const { dir } = useI18n();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());
  const [commandQuery, setCommandQuery] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [invoiceAttachPaymentId, setInvoiceAttachPaymentId] = useState<string | null>(null);
  const [invoiceAttachLink, setInvoiceAttachLink] = useState("");
  const [scanning, setScanning] = useState(false);
  const [sessionStats, setSessionStats] = useState({ markedPaid: 0, attachedInvoices: 0 });

  const loadPayments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<Payment[]>("/api/payments");
      setPayments(data);
    } catch {
      setError("לא הצלחתי לטעון את התשלומים. נסה שוב בעוד רגע.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  const regularPayments = useMemo(
    () => payments.filter((payment) => !isJunkPayment(payment)),
    [payments]
  );

  const filteredUnpaid = useMemo(() => {
    const unpaid = regularPayments.filter((payment) => !payment.paid);
    const query = commandQuery.trim();
    if (!query) return sortPaymentsForQueue(unpaid);

    return sortPaymentsForQueue(
      unpaid.filter((payment) => {
        if (matchesPaymentSearch(payment, query)) return true;
        if (query.includes("גדול")) return payment.amount >= LARGE_AMOUNT_THRESHOLD;
        if (query.includes("דחוף") || query.includes("איחור")) {
          const kind = paymentDueKind(payment);
          return kind === "overdue" || kind === "today" || kind === "tomorrow";
        }
        if (query.includes("לא שולם") || query.includes("ממתין")) return true;
        if (query.includes("חשבונית")) return payment.missingInvoice;
        return false;
      })
    );
  }, [regularPayments, commandQuery]);

  const pendingCount = useMemo(
    () => regularPayments.filter((payment) => !payment.paid).length,
    [regularPayments]
  );

  const recommendation = useMemo(
    () => resolvePaymentRecommendation(regularPayments),
    [regularPayments]
  );

  const snapshotMetrics = useMemo(
    () => buildSnapshotMetrics(regularPayments),
    [regularPayments]
  );

  const completedLines = useMemo(
    () => buildCompletedLines({ preparedCount: 0, ...sessionStats }),
    [sessionStats]
  );

  function animateRemove(id: string, onRemoved: (next: Payment[]) => void) {
    setExitingIds((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      setPayments((prev) => {
        const next = prev.map((payment) =>
          payment.id === id ? { ...payment, paid: true } : payment
        );
        onRemoved(next.filter((payment) => !isJunkPayment(payment)));
        return next;
      });
      setExitingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, EXIT_ANIMATION_MS);
  }

  async function markPaid(id: string) {
    setUpdatingId(id);
    setError("");
    try {
      await apiFetch(`/api/payments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ paid: true }),
      });
      animateRemove(id, (remaining) => {
        setStatusMessage(remainingPaymentsMessage(remaining.filter((p) => !p.paid).length));
        setSessionStats((stats) => ({ ...stats, markedPaid: stats.markedPaid + 1 }));
      });
    } catch {
      setError("לא הצלחתי לסמן את התשלום כשולם.");
    } finally {
      setUpdatingId(null);
    }
  }

  function attachInvoiceToPayment(paymentId: string) {
    setInvoiceAttachPaymentId(paymentId);
    setInvoiceAttachLink("");
  }

  async function submitInvoiceAttachment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoiceAttachPaymentId || !invoiceAttachLink.trim()) return;
    setError("");
    try {
      await apiFetch(`/api/payments/${invoiceAttachPaymentId}`, {
        method: "PATCH",
        body: JSON.stringify({ invoiceLink: invoiceAttachLink.trim() }),
      });
      setPayments((prev) =>
        prev.map((payment) =>
          payment.id === invoiceAttachPaymentId
            ? { ...payment, invoiceLink: invoiceAttachLink.trim(), missingInvoice: false }
            : payment
        )
      );
      setSessionStats((stats) => ({ ...stats, attachedInvoices: stats.attachedInvoices + 1 }));
      setStatusMessage("חיברתי את החשבונית לתשלום.");
      setInvoiceAttachPaymentId(null);
      setInvoiceAttachLink("");
    } catch {
      setError("לא הצלחתי לצרף את החשבונית.");
    }
  }

  function handleRecommendationAction() {
    if (!recommendation.paymentId) {
      document.getElementById("payments-decisions")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (recommendation.kind === "missing_invoice") {
      attachInvoiceToPayment(recommendation.paymentId);
      return;
    }

    if (recommendation.kind === "all_clear") {
      setCommandQuery("");
      return;
    }

    void markPaid(recommendation.paymentId);
  }

  function handleCommandSubmit(value: string) {
    setCommandQuery(value);
    setStatusMessage("");
    window.setTimeout(() => {
      document.getElementById("payments-decisions")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  async function handleScan() {
    setScanning(true);
    setError("");
    setStatusMessage("סורקת את המיילים ומחפשת חשבוניות...");
    try {
      await apiFetch("/api/gmail/scan", { method: "POST" });
      await loadPayments();
      setStatusMessage("סיימתי לסרוק — התשלומים עודכנו.");
    } catch {
      setError("לא הצלחתי להריץ סריקה כרגע. בדקי שהג׳ימייל מחובר.");
    } finally {
      setScanning(false);
    }
  }

  function openPreview(url: string) {
    setPreviewUrl(url);
  }

  const showEmpty =
    !loading && pendingCount === 0 && filteredUnpaid.length === 0 && !commandQuery.trim();
  const showFilteredEmpty =
    !loading && commandQuery.trim() && filteredUnpaid.length === 0 && pendingCount > 0;

  return (
    <div dir={dir}>
      <AppShell
        pageTitle={<PageTitle title="תשלומים" subtitle="נטלי מסדרת את התשלומים שלך" />}
      >
      <div className="mx-auto grid min-w-0 max-w-3xl gap-6 md:gap-8">
        <PaymentMorningContext
          pendingCount={pendingCount}
          loading={loading}
          statusMessage={statusMessage || (scanning ? "סורקת..." : undefined)}
        />

        {!loading && (
          <PaymentRecommendationCard
            recommendation={recommendation}
            onAction={handleRecommendationAction}
          />
        )}

        {!loading && (
          <Card className="px-5 py-4 text-sm font-semibold leading-7 text-[var(--natalie-text-muted,#64748B)]">
            חשבוניות ספקים שאושרו במסמכים לבדיקה מופיעות כאן כתשלומים לספקים.
          </Card>
        )}

        {error ? <MessageBanner tone="error">{error}</MessageBanner> : null}

        {loading && (
          <div className="grid gap-4">
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className="h-72 rounded-2xl" />
            ))}
          </div>
        )}

        {showEmpty && (
          <section
            className={`${radius.lg} border p-8 text-center`}
            style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
          >
            <p className={`${typography.sectionTitle} leading-snug`} style={{ color: colors.textPrimary }}>
              אין כרגע תשלומים שמחכים לך
            </p>
            <p className={`${typography.body} mt-3 leading-7`} style={{ color: colors.textSecondary }}>
              כשאזהה דרישות תשלום וחשבוניות ספקים מהמיילים, אכין אותן כאן.
            </p>
          </section>
        )}

        {showFilteredEmpty && (
          <p className={`${typography.body} text-center font-semibold`} style={{ color: colors.textSecondary }}>
            לא מצאתי תשלומים שמתאימים לבקשה הזו
          </p>
        )}

        {!loading && filteredUnpaid.length > 0 && (
          <PaymentDecisionQueue
            payments={filteredUnpaid}
            totalCount={filteredUnpaid.length}
            exitingIds={exitingIds}
            updatingId={updatingId}
            onMarkPaid={markPaid}
            onAttach={attachInvoiceToPayment}
            onPreview={openPreview}
          />
        )}

        {!loading && <PaymentsCompletedSection lines={completedLines} />}

        <PaymentsSnapshot metrics={snapshotMetrics} loading={loading} />

        <PaymentsCommandBar onSubmit={handleCommandSubmit} onScan={handleScan} />

        {!loading && <PaymentsArchiveSection />}
      </div>

      {previewUrl && (
        <div
          className="fixed inset-0 z-[120] overflow-y-auto bg-black/70 p-0 backdrop-blur-sm sm:grid sm:place-items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className={`h-screen w-full overflow-hidden p-4 sm:h-[85vh] sm:max-w-5xl sm:rounded-2xl ${radius.lg}`}
            style={{ backgroundColor: colors.surface, color: colors.textPrimary }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className={typography.sectionTitle}>תצוגת מסמך</h2>
              <div className="grid gap-2 sm:flex">
                <a
                  className={`inline-flex min-h-[44px] items-center justify-center px-4 py-3 text-sm font-bold ${radius.control}`}
                  style={{ border: `1px solid ${colors.accent}`, color: colors.textPrimary, backgroundColor: colors.surface }}
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  פתחי בדרייב
                </a>
                <button
                  className={`min-h-[44px] px-4 py-3 text-sm font-bold ${radius.control}`}
                  style={{ border: `1px solid ${colors.border}`, color: colors.textSecondary, backgroundColor: colors.surface }}
                  type="button"
                  onClick={() => setPreviewUrl(null)}
                >
                  סגור
                </button>
              </div>
            </div>
            <iframe
              className={`h-[calc(100vh-9rem)] w-full border sm:h-[calc(85vh-8rem)] ${radius.lg}`}
              style={{ borderColor: colors.borderSubtle, backgroundColor: colors.surface }}
              src={toDrivePreviewUrl(previewUrl)}
              title="Invoice preview"
            />
          </div>
        </div>
      )}

      {invoiceAttachPaymentId && (
        <div
          className={`fixed inset-0 z-50 grid place-items-center ${spacing.page}`}
          style={{ backgroundColor: "rgba(15,23,42,0.45)" }}
        >
          <form
            className={`${radius.lg} ${shadow.raised} ${spacing.card} w-full max-w-lg`}
            style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}` }}
            onSubmit={submitInvoiceAttachment}
          >
            <h2 className={typography.sectionTitle}>צרפי חשבונית לתשלום</h2>
            <p className={`${typography.body} mt-2 leading-7`} style={{ color: colors.textSecondary }}>
              הדביקי קישור לחשבונית בדרייב כדי לסגור את החוסר.
            </p>
            <label className={`${typography.body} mt-4 block font-semibold`} style={{ color: colors.textPrimary }}>
              קישור לחשבונית
              <input
                dir="ltr"
                value={invoiceAttachLink}
                onChange={(event) => setInvoiceAttachLink(event.target.value)}
                placeholder="https://drive.google.com/..."
                autoFocus
                className={`mt-2 w-full border px-4 py-3 ${radius.control}`}
                style={{ backgroundColor: colors.bgSoft, borderColor: colors.border, color: colors.textPrimary }}
              />
            </label>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                className={`${radius.control} ${button.primary} w-full sm:w-auto`}
                style={{ backgroundColor: colors.accent, border: `1px solid ${colors.accent}`, color: colors.surface }}
                type="submit"
                disabled={!invoiceAttachLink.trim()}
              >
                צרפי חשבונית
              </button>
              <button
                type="button"
                onClick={() => setInvoiceAttachPaymentId(null)}
                className={`${radius.control} ${button.secondary} w-full sm:w-auto`}
                style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, color: colors.textSecondary }}
              >
                ביטול
              </button>
            </div>
          </form>
        </div>
      )}
      </AppShell>
    </div>
  );
}
