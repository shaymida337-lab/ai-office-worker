"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch, type Payment } from "@/lib/api";

export default function ReportsClient() {
  const [missing, setMissing] = useState<Payment[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Payment[]>("/api/reports/missing-invoices")
      .then(setMissing)
      .catch((err) => setMessage(err instanceof Error ? err.message : "טעינת הדוח נכשלה"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="container">
      <Nav />
      <div className="mb-8">
        <div className="page-kicker">דוחות</div>
        <h1>דוח חשבוניות חסרות</h1>
        <p>ריכוז ספקים ותשלומים שבהם נדרש לצרף חשבונית או מסמך תומך.</p>
      </div>
      {message && <div className="mb-6 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-base text-red-100">{message}</div>}
      {loading ? (
        <div className="card"><p>טוען דוח חשבוניות חסרות...</p></div>
      ) : missing.length === 0 ? (
        <div className="card">
          <h2 className="text-emerald-300">אין חשבוניות חסרות כרגע</h2>
          <p className="mt-2">כל התשלומים שנבדקו כוללים מסמך מתאים או שלא דורשים טיפול כרגע.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:hidden">
            {missing.map((p) => (
              <div key={p.id} className="card">
                <h2 className="break-words">{p.supplier}</h2>
                <p className="break-words">{p.subject ?? "ללא נושא"}</p>
                <div className="my-4 rounded-2xl bg-surface-secondary p-3 text-left text-2xl font-bold text-ink-primary">
                  ₪{p.amount.toLocaleString("he-IL")}
                </div>
                {p.documentLink && (
                  <a className="btn btn-secondary" href={p.documentLink} target="_blank" rel="noreferrer">
                    פתח דרישת תשלום
                  </a>
                )}
              </div>
            ))}
          </div>
          <div className="table-shell hidden md:block">
            <table>
            <thead>
              <tr>
                <th>ספק</th>
                <th>נושא</th>
                <th>סכום</th>
                <th>קישור מסמך</th>
              </tr>
            </thead>
            <tbody>
              {missing.map((p) => (
                <tr key={p.id}>
                  <td>{p.supplier}</td>
                  <td>{p.subject ?? "-"}</td>
                  <td>₪{p.amount.toLocaleString("he-IL")}</td>
                  <td>
                    {p.documentLink ? (
                      <a href={p.documentLink} target="_blank" rel="noreferrer">
                        דרישת תשלום
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
