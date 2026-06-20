"use client";

import { useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/Nav";
import { StatusPill } from "@/components/ui/StatusPill";
import { apiFetch, issueDraft } from "@/lib/api";

type InvoiceDraft = {
  id: string;
  status: string;
  source: string;
  customerName: string;
  customerEmail: string | null;
  customerTaxId: string | null;
  clientId: string | null;
  description: string;
  amount: number;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  greenInvoiceDocumentId: string | null;
  approvedAt: string | null;
  createdAt: string;
  duplicateOf: string[];
};

export default function InvoiceDraftsPage() {
  const [drafts, setDrafts] = useState<InvoiceDraft[]>([]);
  const [message, setMessage] = useState("");
  const [documentLink, setDocumentLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [issuingId, setIssuingId] = useState<string | null>(null);

  const summary = useMemo(() => {
    const totalAmount = drafts.reduce((sum, draft) => sum + draft.amount, 0);
    return { count: drafts.length, totalAmount };
  }, [drafts]);

  async function loadDrafts() {
    setLoading(true);
    try {
      const data = await apiFetch<InvoiceDraft[]>("/api/natalie/invoice-drafts");
      setDrafts(data);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "טעינת טיוטות החשבונית נכשלה");
      setDocumentLink(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDrafts();
  }, []);

  async function deleteDraft(draft: InvoiceDraft) {
    const confirmed = window.confirm(
      `למחוק את הטיוטה של "${draft.customerName}" בסכום ${formatDraftAmount(draft)}? הפעולה תמחק את הטיוטה.`,
    );
    if (!confirmed) return;

    setDeletingId(draft.id);
    setMessage("");
    setDocumentLink(null);
    try {
      await apiFetch(`/api/natalie/invoice-drafts/${draft.id}`, { method: "DELETE" });
      setDrafts((prev) => prev.filter((item) => item.id !== draft.id));
      setMessage("הטיוטה נמחקה");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "מחיקת הטיוטה נכשלה");
    } finally {
      setDeletingId(null);
    }
  }

  async function issueDraftInSandbox(draft: InvoiceDraft) {
    const confirmed = window.confirm(
      "להנפיק מסמך בסביבת הבדיקות? פעולה זו יוצרת מסמך ב-Green Invoice (סנדבוקס).",
    );
    if (!confirmed) return;

    setIssuingId(draft.id);
    setMessage("");
    setDocumentLink(null);
    try {
      const result = await issueDraft(draft.id);
      if (result.success) {
        const link = result.document?.pdfUrl ?? result.document?.url ?? null;
        setMessage(`הטיוטה הונפקה בהצלחה. מזהה מסמך: ${result.documentId ?? "—"}`);
        setDocumentLink(link);
        await loadDrafts();
      } else {
        setMessage(result.error ?? "הנפקת הטיוטה נכשלה");
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "הנפקת הטיוטה נכשלה");
    } finally {
      setIssuingId(null);
    }
  }

  return (
    <div className="container">
      <Nav />
      <div className="mb-8">
        <div className="page-kicker">טיוטות חשבונית</div>
        <h1>טיוטות חשבונית</h1>
        <p className="mt-2 text-base font-semibold leading-7 text-[#111827]">
          טיוטות פנימיות שנשמרו — מהצ&apos;אט עם נטלי ומייבוא קבצים. אלה טיוטות בלבד, לא הונפקו חשבוניות מס.
        </p>
      </div>

      <div className="mb-6 rounded-2xl border border-[#F59E0B] bg-[#FFFBEB] p-4 text-base font-bold text-[#92400E]">
        ⚠️ אלה טיוטות פנימיות בלבד — לא הונפקו חשבוניות מס רשמיות.
      </div>

      {!loading && drafts.length > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <div className="text-sm font-bold text-[#6B7280]">סה״כ טיוטות</div>
            <div className="mt-1 text-2xl font-black text-[#111827]">{summary.count}</div>
          </div>
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <div className="text-sm font-bold text-[#6B7280]">סכום כולל</div>
            <div className="mt-1 text-2xl font-black text-[#111827]">₪{summary.totalAmount.toLocaleString("he-IL")}</div>
          </div>
        </div>
      )}

      {message && (
        <div className="mb-6 rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4 text-base text-ink-primary">
          <p>{message}</p>
          {documentLink && (
            <a
              className="mt-2 inline-block font-bold text-accent-primary underline"
              href={documentLink}
              rel="noopener noreferrer"
              target="_blank"
            >
              צפייה במסמך
            </a>
          )}
        </div>
      )}
      {loading && <div className="card"><p>טוען טיוטות חשבונית...</p></div>}
      {!loading && drafts.length === 0 && (
        <div className="card">
          <h2>אין עדיין טיוטות</h2>
          <p className="mt-2">
            אפשר ליצור טיוטה בצ&apos;אט עם נטלי או לייבא קובץ במסך &apos;ייבוא חשבוניות&apos;.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:hidden">
        {drafts.map((draft) => (
          <div key={draft.id} className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white p-4 text-[#111827] shadow-sm" dir="rtl">
            <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="min-w-0 break-words text-xl font-black leading-7 text-[#111827] [overflow-wrap:anywhere]">{draft.customerName}</h2>
                {draft.customerEmail && (
                  <p className="mt-1 min-w-0 break-words text-sm font-semibold leading-6 text-[#6B7280] [overflow-wrap:anywhere]">{draft.customerEmail}</p>
                )}
                <DuplicateWarning draft={draft} />
              </div>
              <SourcePill source={draft.source} />
            </div>
            <p className="mb-3 min-w-0 break-words text-base font-semibold leading-6 text-[#111827] [overflow-wrap:anywhere]">{draft.description}</p>
            <div className="mb-3 text-lg font-black text-[#111827]">{formatDraftAmount(draft)}</div>
            <p className="mb-4 text-sm font-semibold text-[#6B7280]">נוצרה: {formatDraftDate(draft.createdAt)}</p>
            <div className="mb-3">
              <IssueDraftControl
                draft={draft}
                issuingId={issuingId}
                onIssue={() => issueDraftInSandbox(draft)}
              />
            </div>
            <button
              className="min-h-[44px] w-full rounded-xl border border-red-600 bg-red-600 px-3 py-2 text-center text-sm font-bold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60"
              type="button"
              onClick={() => deleteDraft(draft)}
              disabled={deletingId === draft.id}
            >
              {deletingId === draft.id ? "מוחק..." : "מחק"}
            </button>
          </div>
        ))}
      </div>

      <div className="table-shell hidden max-w-full overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm md:block">
        <table className="w-full table-fixed border-separate border-spacing-0 text-right text-[#111827]" dir="rtl">
          <thead className="bg-[#F3F4F6]">
            <tr className="border-b border-[#E5E7EB]">
              <th className="w-[4%] px-1 py-3 align-middle text-sm font-black text-[#111827]">מחק</th>
              <th className="w-[14%] px-2 py-3 align-middle text-sm font-black text-[#111827]">הנפקה</th>
              <th className="w-[16%] px-3 py-3 align-middle text-sm font-black text-[#111827]">לקוח</th>
              <th className="w-[20%] px-3 py-3 align-middle text-sm font-black text-[#111827]">תיאור</th>
              <th className="w-[10%] px-3 py-3 align-middle text-sm font-black text-[#111827]">סכום</th>
              <th className="w-[10%] px-3 py-3 align-middle text-sm font-black text-[#111827]">מקור</th>
              <th className="w-[10%] px-3 py-3 align-middle text-sm font-black text-[#111827]">תאריך יצירה</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft) => (
              <tr key={draft.id} className="border-b border-[#E5E7EB] bg-white transition hover:bg-[#F8FAFC]">
                <td className="px-1 py-4 align-middle text-[#111827]">
                  <button
                    className="min-h-[32px] w-full truncate rounded-lg bg-red-600 px-1 py-1 text-xs font-bold text-white shadow-sm disabled:opacity-60"
                    onClick={() => deleteDraft(draft)}
                    disabled={deletingId === draft.id}
                    title="מחק טיוטה"
                    type="button"
                  >
                    {deletingId === draft.id ? "מוחק..." : "מחק"}
                  </button>
                </td>
                <td className="px-2 py-4 align-middle">
                  <IssueDraftControl
                    compact
                    draft={draft}
                    issuingId={issuingId}
                    onIssue={() => issueDraftInSandbox(draft)}
                  />
                </td>
                <td className="min-w-0 px-3 py-4 align-middle text-[#111827]">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-[#111827]" title={draft.customerName}>{draft.customerName}</div>
                    {draft.customerEmail && (
                      <div className="truncate text-xs font-normal text-[#9CA3AF]" title={draft.customerEmail}>{draft.customerEmail}</div>
                    )}
                    <DuplicateWarning draft={draft} compact />
                  </div>
                </td>
                <td className="min-w-0 px-3 py-4 align-middle text-base font-semibold text-[#111827]">
                  <div className="truncate" title={draft.description}>{draft.description}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-4 align-middle text-base font-bold text-[#111827]">{formatDraftAmount(draft)}</td>
                <td className="px-3 py-4 align-middle">
                  <SourcePill source={draft.source} />
                </td>
                <td className="whitespace-nowrap px-3 py-4 align-middle text-base font-semibold text-[#111827]">{formatDraftDate(draft.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DuplicateWarning({ draft, compact = false }: { draft: InvoiceDraft; compact?: boolean }) {
  if (!draft.duplicateOf?.length) return null;

  return (
    <div
      className={
        compact
          ? "mt-1 rounded border border-orange-300 bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold leading-tight text-orange-800"
          : "mt-2 rounded-lg border border-orange-300 bg-orange-50 px-2 py-1 text-xs font-bold leading-snug text-orange-800"
      }
    >
      ⚠️ כפילות אפשרית — לקוח וסכום זהים לטיוטה אחרת
    </div>
  );
}

function IssueDraftControl({
  draft,
  issuingId,
  onIssue,
  compact = false,
}: {
  draft: InvoiceDraft;
  issuingId: string | null;
  onIssue: () => void;
  compact?: boolean;
}) {
  if (draft.greenInvoiceDocumentId) {
    return (
      <div className={compact ? "text-xs" : "text-sm"}>
        <StatusPill tone="success">הונפק ✓</StatusPill>
        <div className="mt-1 break-all font-semibold text-[#047857]" title={draft.greenInvoiceDocumentId}>
          {draft.greenInvoiceDocumentId}
        </div>
      </div>
    );
  }

  return (
    <button
      className={
        compact
          ? "min-h-[32px] w-full truncate rounded-lg bg-emerald-600 px-1 py-1 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
          : "min-h-[44px] w-full rounded-xl border border-emerald-600 bg-emerald-600 px-3 py-2 text-center text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
      }
      disabled={issuingId === draft.id}
      onClick={onIssue}
      type="button"
    >
      {issuingId === draft.id ? "מנפיק..." : "הנפק בסנדבוקס"}
    </button>
  );
}

function SourcePill({ source }: { source: string }) {
  if (source === "import") {
    return <StatusPill tone="success">ייבוא</StatusPill>;
  }
  return <StatusPill tone="info">נטלי</StatusPill>;
}

function formatDraftDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("he-IL");
}

function formatDraftAmount(draft: InvoiceDraft) {
  const symbol = draft.currency === "ILS" || !draft.currency ? "₪" : draft.currency;
  return `${symbol}${draft.amount.toLocaleString("he-IL")}`;
}
