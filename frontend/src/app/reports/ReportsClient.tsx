"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch, type Payment } from "@/lib/api";
import { useRouter } from "next/navigation";

export default function ReportsClient() {
  const router = useRouter();
  const [missing, setMissing] = useState<Payment[]>([]);

  useEffect(() => {
    apiFetch<Payment[]>("/api/reports/missing-invoices")
      .then(setMissing)
      .catch(() => router.push("/"));
  }, [router]);

  return (
    <div className="container">
      <h1>דוח חשבוניות חסרות</h1>
      <Nav />
      <div className="card">
        {missing.length === 0 ? (
          <p className="text-emerald-300">אין חשבוניות חסרות כרגע.</p>
        ) : (
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
        )}
      </div>
    </div>
  );
}
