"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";

type ClientDetail = {
  client: {
    id: string;
    name: string;
    email: string;
    color: string | null;
    gmailConnected: boolean;
    invoiceSheetUrl: string | null;
    taskSheetUrl: string | null;
    driveFolderUrl: string | null;
  };
  payments: Array<{
    id: string;
    supplier: string;
    amount: number;
    currency: string;
    date: string;
    invoiceLink: string | null;
    documentLink: string | null;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    priority: string;
    dueDate: string | null;
  }>;
};

export default function ClientDetailPage() {
  const params = useParams<{ clientId: string }>();
  const [data, setData] = useState<ClientDetail | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    const next = await apiFetch<ClientDetail>(`/api/clients/${params.clientId}`);
    setData(next);
  }

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : "טעינת לקוח נכשלה"));
  }, [params.clientId]);

  async function scanClient() {
    setMessage("");
    try {
      await apiFetch(`/api/clients/${params.clientId}/scan`, { method: "POST" });
      await load();
      setMessage("הסריקה הסתיימה");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "סריקה נכשלה");
    }
  }

  if (!data) {
    return (
      <div className="container">
        <Nav />
        <p>{message || "טוען לקוח..."}</p>
      </div>
    );
  }

  return (
    <div className="container">
      <Nav />
      <h1>
        <span style={{ color: data.client.color ?? "#3B82F6" }}>■</span> {data.client.name}
      </h1>
      <p>gmail: {data.client.email}</p>
      {message && <p>{message}</p>}
      <div style={{ marginBottom: "1rem" }}>
        <button className="btn" onClick={scanClient}>
          סרוק
        </button>
        {data.client.invoiceSheetUrl && (
          <a className="btn btn-secondary" href={data.client.invoiceSheetUrl} target="_blank">
            פתח Sheets
          </a>
        )}
        {data.client.driveFolderUrl && (
          <a className="btn btn-secondary" href={data.client.driveFolderUrl} target="_blank">
            פתח Drive
          </a>
        )}
      </div>

      <div className="card">
        <h2>חשבוניות</h2>
        {data.payments.length === 0 ? (
          <p>אין חשבוניות עדיין.</p>
        ) : (
          data.payments.map((payment) => (
            <p key={payment.id}>
              {payment.supplier} | ₪{payment.amount} |{" "}
              {new Date(payment.date).toLocaleDateString("he-IL")} |{" "}
              {(payment.invoiceLink || payment.documentLink) && (
                <a href={payment.invoiceLink ?? payment.documentLink ?? ""} target="_blank">
                  📎 Drive
                </a>
              )}
            </p>
          ))
        )}
      </div>

      <div className="card">
        <h2>משימות</h2>
        {data.tasks.length === 0 ? (
          <p>אין משימות פתוחות.</p>
        ) : (
          data.tasks.map((task) => (
            <p key={task.id}>
              {task.priority === "high" ? "🔴" : task.priority === "low" ? "🟢" : "🟡"}{" "}
              {task.title}
              {task.dueDate ? ` - עד ${new Date(task.dueDate).toLocaleDateString("he-IL")}` : ""}
            </p>
          ))
        )}
      </div>
    </div>
  );
}
