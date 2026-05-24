"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch, getToken } from "@/lib/api";

type ClientItem = {
  id: string;
  name: string;
  email: string;
  color: string | null;
  gmailConnected: boolean;
  invoiceSheetUrl: string | null;
  taskSheetUrl: string | null;
  driveFolderUrl: string | null;
  stats?: {
    toPay: number;
    openTasks: number;
    invoices: number;
    missingInvoices: number;
  };
};

type ClientsResponse = {
  clients: ClientItem[];
  totals: {
    toPay: number;
    openTasks: number;
    invoices: number;
    missingInvoices: number;
  };
};

const emptyForm = {
  name: "",
  email: "",
  color: "#3B82F6",
  invoiceSheetUrl: "",
  taskSheetUrl: "",
  driveFolderUrl: "",
};

export default function ClientsPage() {
  const [data, setData] = useState<ClientsResponse | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    const next = await apiFetch<ClientsResponse>("/api/clients");
    setData(next);
  }

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : "טעינת לקוחות נכשלה"));
  }, []);

  async function createClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      await apiFetch("/api/clients", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm(emptyForm);
      setShowForm(false);
      setMessage("הלקוח נוסף בהצלחה");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שמירת לקוח נכשלה");
    }
  }

  async function scanClient(clientId: string) {
    setMessage("");
    try {
      const response = await apiFetch<{ result?: { message?: string } }>(`/api/clients/${clientId}/scan`, {
        method: "POST",
      });
      setMessage(response.result?.message ?? "סריקת הלקוח הסתיימה");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "סריקת לקוח נכשלה");
    }
  }

  function connectUrl(clientId: string) {
    const token = getToken();
    const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    return `${base}/api/clients/${clientId}/connect-gmail?token=${encodeURIComponent(token ?? "")}`;
  }

  return (
    <div className="container">
      <h1>לקוחות</h1>
      <Nav />

      <div style={{ margin: "1rem 0" }}>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          + הוסף לקוח חדש
        </button>
      </div>

      {message && <p>{message}</p>}

      {showForm && (
        <form onSubmit={createClient} className="card" style={{ display: "grid", gap: "0.75rem" }}>
          <input
            required
            placeholder="שם לקוח"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            required
            type="email"
            placeholder="מייל"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <label>
            צבע{" "}
            <input
              type="color"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
            />
          </label>
          <input
            placeholder="URL טבלת חשבוניות"
            value={form.invoiceSheetUrl}
            onChange={(e) => setForm({ ...form, invoiceSheetUrl: e.target.value })}
          />
          <input
            placeholder="URL טבלת משימות"
            value={form.taskSheetUrl}
            onChange={(e) => setForm({ ...form, taskSheetUrl: e.target.value })}
          />
          <input
            placeholder="URL תיקיית Drive"
            value={form.driveFolderUrl}
            onChange={(e) => setForm({ ...form, driveFolderUrl: e.target.value })}
          />
          <button className="btn" type="submit">
            שמור לקוח
          </button>
        </form>
      )}

      <section style={{ marginTop: "1rem" }}>
        {!data ? (
          <p>טוען לקוחות...</p>
        ) : data.clients.length === 0 ? (
          <p>אין לקוחות עדיין.</p>
        ) : (
          data.clients.map((client) => (
            <div key={client.id} className="card" style={{ marginBottom: "0.75rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: client.color ?? "#3B82F6",
                  }}
                />
                <strong>{client.name}</strong>
              </div>
              <p>{client.email}</p>
              <p>
                Gmail {client.gmailConnected ? "מחובר" : "לא מחובר"} · Sheets{" "}
                {client.invoiceSheetUrl || client.taskSheetUrl ? "מחובר" : "לא מחובר"} · Drive{" "}
                {client.driveFolderUrl ? "מחובר" : "לא מחובר"}
              </p>
              <p>
                ₪{client.stats?.toPay ?? 0} לתשלום · {client.stats?.openTasks ?? 0} משימות ·{" "}
                {client.stats?.invoices ?? 0} חשבוניות
              </p>
              <a className="btn btn-secondary" href={connectUrl(client.id)}>
                חבר Gmail
              </a>
              <button className="btn btn-secondary" onClick={() => scanClient(client.id)}>
                סרוק
              </button>
              <a className="btn btn-secondary" href={`/dashboard/clients/${client.id}`}>
                דוח
              </a>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
