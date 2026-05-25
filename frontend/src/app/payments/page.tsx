"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch, type Payment } from "@/lib/api";
import { useRouter } from "next/navigation";

export default function PaymentsPage() {
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    apiFetch<Payment[]>("/api/payments")
      .then(setPayments)
      .catch(() => router.push("/"));
  }, [router]);

  async function markPaid(id: string) {
    await apiFetch(`/api/payments/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ paid: true }),
    });
    setPayments((prev) =>
      prev.map((p) => (p.id === id ? { ...p, paid: true, missingInvoice: false } : p))
    );
  }

  return (
    <div className="container">
      <h1>תשלומי ספקים</h1>
      <Nav />
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>ספק</th>
              <th>שולח</th>
              <th>סכום</th>
              <th>תאריך</th>
              <th>לתשלום עד</th>
              <th>שולם</th>
              <th>מסמך</th>
              <th>חשבונית</th>
              <th>חסרה</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>{p.supplier}</td>
                <td>{p.emailSender ?? "—"}</td>
                <td>₪{p.amount.toLocaleString("he-IL")}</td>
                <td>{new Date(p.date).toLocaleDateString("he-IL")}</td>
                <td>
                  {p.dueDate
                    ? new Date(p.dueDate).toLocaleDateString("he-IL")
                    : "—"}
                </td>
                <td>{p.paid ? "כן" : "לא"}</td>
                <td>
                  {p.documentLink ? (
                    <a href={p.documentLink} target="_blank" rel="noreferrer">
                      קישור
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {p.invoiceLink ? (
                    <a href={p.invoiceLink} target="_blank" rel="noreferrer">
                      קישור
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {p.missingInvoice ? (
                    <span className="badge badge-warn">כן</span>
                  ) : (
                    <span className="badge badge-ok">לא</span>
                  )}
                </td>
                <td>
                  {!p.paid && (
                    <button className="btn btn-secondary" onClick={() => markPaid(p.id)}>
                      סמן שולם
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {payments.length === 0 && <p>אין רשומות. הרץ סריקת Gmail מהלוח.</p>}
      </div>
    </div>
  );
}
