"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";

type DocumentReview = {
  id: string;
  source: string;
  sender: string | null;
  subject: string | null;
  fileName: string | null;
  documentType: string;
  supplierName: string | null;
  totalAmount: number | null;
  confidenceScore: number;
  uncertaintyReason: string | null;
  driveFileUrl: string | null;
  reviewStatus: string;
  createdAt: string;
};

export default function DocumentReviewsPage() {
  const [items, setItems] = useState<DocumentReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    loadItems();
  }, []);

  function loadItems() {
    setLoading(true);
    apiFetch<DocumentReview[]>("/api/document-reviews?status=needs_review")
      .then(setItems)
      .catch((err) => setMessage(err instanceof Error ? err.message : "טעינת מסמכים לבדיקה נכשלה"))
      .finally(() => setLoading(false));
  }

  async function approve(id: string) {
    setUpdatingId(id);
    setMessage("");
    try {
      await apiFetch(`/api/document-reviews/${id}/approve`, { method: "POST" });
      setItems((prev) => prev.filter((item) => item.id !== id));
      setMessage("המסמך אושר ונוסף לתשלומי הספקים");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "אישור המסמך נכשל");
    } finally {
      setUpdatingId(null);
    }
  }

  async function remove(id: string) {
    setUpdatingId(id);
    setMessage("");
    try {
      await apiFetch(`/api/document-reviews/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((item) => item.id !== id));
      setMessage("המסמך נמחק מרשימת הבדיקה");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "מחיקת המסמך נכשלה");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="container">
      <Nav />
      <div className="mb-8">
        <div className="page-kicker">דיוק מסמכים</div>
        <h1>מסמכים לבדיקה</h1>
        <p>מסמכים מג׳ימייל ומוואטסאפ עם רמת ודאות נמוכה או נתונים חסרים. אישור ידני יכניס אותם לתשלומי ספקים.</p>
      </div>

      {message && <div className="mb-6 rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4 text-base text-ink-primary">{message}</div>}
      {loading && <div className="card"><p>טוען מסמכים לבדיקה...</p></div>}
      {!loading && items.length === 0 && <div className="card"><h2>אין מסמכים שממתינים לבדיקה</h2><p className="mt-2">מסמכים בטוחים נשמרים אוטומטית, ומסמכים לא רלוונטיים מסוננים.</p></div>}

      {!loading && items.length > 0 && (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>מקור</th>
                <th>שולח</th>
                <th>סוג מסמך</th>
                <th>סכום</th>
                <th>ספק</th>
                <th>סיבת חוסר ודאות</th>
                <th>קובץ</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{sourceLabel(item.source)}</td>
                  <td>{item.sender ?? "—"}</td>
                  <td>{documentTypeLabel(item.documentType)}</td>
                  <td>{item.totalAmount == null ? "—" : `₪${item.totalAmount.toLocaleString("he-IL")}`}</td>
                  <td>{item.supplierName ?? "לא מזוהה"}</td>
                  <td>
                    <div>{item.uncertaintyReason ?? "רמת ודאות נמוכה"}</div>
                    <div className="text-sm text-ink-secondary">{Math.round(item.confidenceScore * 100)}%</div>
                  </td>
                  <td>{item.driveFileUrl ? <a className="text-accent-primary underline-offset-4 hover:underline" href={item.driveFileUrl} target="_blank" rel="noreferrer">פתח</a> : "—"}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <button className="btn btn-secondary" type="button" disabled={updatingId === item.id} onClick={() => approve(item.id)}>
                        אשר נתונים
                      </button>
                      <button className="btn btn-secondary" type="button" disabled={updatingId === item.id} onClick={() => remove(item.id)}>
                        מחיקה
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function sourceLabel(source: string) {
  return source === "whatsapp" ? "וואטסאפ" : "ג׳ימייל";
}

function documentTypeLabel(type: string) {
  const labels: Record<string, string> = {
    tax_invoice: "חשבונית מס",
    invoice: "חשבונית מס",
    receipt: "קבלה",
    tax_invoice_receipt: "חשבונית מס קבלה",
    payment_request: "דרישת תשלום",
    quote: "הצעת מחיר",
    irrelevant: "מסמך לא רלוונטי",
  };
  return labels[type] ?? type;
}
