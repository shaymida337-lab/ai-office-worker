"use client";

import { useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/Nav";
import { StatusPill } from "@/components/ui/StatusPill";
import { apiFetch } from "@/lib/api";

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
};

export default function InvoiceDraftsPage() {
  const [drafts, setDrafts] = useState<InvoiceDraft[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

      {message && <div className="mb-6 rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4 text-base text-ink-primary">{message}</div>}
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
              </div>
              <SourcePill source={draft.source} />
            </div>
            <p className="mb-3 min-w-0 break-words text-base font-semibold leading-6 text-[#111827] [overflow-wrap:anywhere]">{draft.description}</p>
            <div className="mb-3 text-lg font-black text-[#111827]">{formatDraftAmount(draft)}</div>
            <p className="mb-4 text-sm font-semibold text-[#6B7280]">נוצרה: {formatDraftDate(draft.createdAt)}</p>
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
              <th className="w-[18%] px-3 py-3 align-middle text-sm font-black text-[#111827]">לקוח</th>
              <th className="w-[22%] px-3 py-3 align-middle text-sm font-black text-[#111827]">תיאור</th>
              <th className="w-[12%] px-3 py-3 align-middle text-sm font-black text-[#111827]">סכום</th>
              <th className="w-[12%] px-3 py-3 align-middle text-sm font-black text-[#111827]">מקור</th>
              <th className="w-[12%] px-3 py-3 align-middle text-sm font-black text-[#111827]">תאריך יצירה</th>
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
                <td className="min-w-0 px-3 py-4 align-middle text-[#111827]">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-[#111827]" title={draft.customerName}>{draft.customerName}</div>
                    {draft.customerEmail && (
                      <div className="truncate text-xs font-normal text-[#9CA3AF]" title={draft.customerEmail}>{draft.customerEmail}</div>
                    )}
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
