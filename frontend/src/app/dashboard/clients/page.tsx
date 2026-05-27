"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";
import { Mail, Plus, RefreshCcw, Search, ShieldCheck, Users } from "lucide-react";

type ClientItem = {
  id: string;
  name: string;
  email: string;
  whatsappNumber: string | null;
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
  whatsappNumber: "",
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
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [saving, setSaving] = useState(false);
  const [scanningId, setScanningId] = useState<string | null>(null);

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
    setSaving(true);
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
    } finally {
      setSaving(false);
    }
  }

  async function scanClient(clientId: string) {
    setMessage("");
    setScanningId(clientId);
    try {
      const response = await apiFetch<{ result?: { message?: string } }>(`/api/clients/${clientId}/scan`, {
        method: "POST",
      });
      setMessage(response.result?.message ?? "סריקת הלקוח הסתיימה");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "סריקת לקוח נכשלה");
    } finally {
      setScanningId(null);
    }
  }

  async function connectGmail(clientId: string) {
    setMessage("");
    try {
      const result = await apiFetch<{ url: string }>(`/api/clients/${clientId}/connect-gmail-url`);
      window.location.href = result.url;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "חיבור Gmail נכשל");
    }
  }

  const filteredClients = (data?.clients ?? []).filter((client) =>
    `${client.name} ${client.email} ${client.whatsappNumber ?? ""}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="container">
      <Nav />
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="page-kicker">Client workspace</div>
          <h1>לקוחות</h1>
          <p>כל לקוח, האינטגרציות שלו והמדדים העסקיים במקום אחד.</p>
        </div>
        <button className="btn" onClick={() => setShowForm((v) => !v)}><Plus className="h-4 w-4" />הוסף לקוח חדש</button>
      </div>

      {message && <div className="mb-6 rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4 text-sm text-ink-primary">{message}</div>}

      <div className="card">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-ink-muted" />
            <input className="pr-10" placeholder="חפש לקוח, מייל או WhatsApp" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className={view === "grid" ? "btn" : "btn btn-toggle-inactive"} onClick={() => setView("grid")}>רשת</button>
            <button className={view === "list" ? "btn" : "btn btn-toggle-inactive"} onClick={() => setView("list")}>רשימה</button>
          </div>
        </div>
      </div>

      {showForm && (
        <form onSubmit={createClient} className="card grid gap-3 md:grid-cols-2">
          <label>
            שם לקוח
            <input
              required
              placeholder="שם לקוח"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            אימייל
            <input
              required
              type="email"
              placeholder="client@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label>
            WhatsApp
            <input
              dir="ltr"
              placeholder="+972..."
              value={form.whatsappNumber}
              onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })}
            />
          </label>
          <label>
            צבע{" "}
            <input
              type="color"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
            />
          </label>
          <label>
            URL טבלת חשבוניות
            <input
              dir="ltr"
              placeholder="https://..."
              value={form.invoiceSheetUrl}
              onChange={(e) => setForm({ ...form, invoiceSheetUrl: e.target.value })}
            />
          </label>
          <label>
            URL טבלת משימות
            <input
              dir="ltr"
              placeholder="https://..."
              value={form.taskSheetUrl}
              onChange={(e) => setForm({ ...form, taskSheetUrl: e.target.value })}
            />
          </label>
          <label>
            URL תיקיית Drive
            <input
              dir="ltr"
              placeholder="https://..."
              value={form.driveFolderUrl}
              onChange={(e) => setForm({ ...form, driveFolderUrl: e.target.value })}
            />
          </label>
          <button className="btn md:col-span-2" type="submit" disabled={saving}>
            {saving ? "שומר..." : "שמור לקוח"}
          </button>
        </form>
      )}

      <section className={view === "grid" ? "grid gap-6 md:grid-cols-2 xl:grid-cols-3" : "space-y-4"}>
        {!data ? (
          <div className="skeleton h-32" />
        ) : filteredClients.length === 0 ? (
          <div className="card text-center"><Users className="mx-auto mb-3 h-8 w-8 text-ink-muted" /><p>אין לקוחות תואמים.</p></div>
        ) : (
          filteredClients.map((client) => (
            <div key={client.id} className="card group">
              <div className="mb-4 grid gap-3 sm:flex sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[linear-gradient(135deg,#6366F1,#8B5CF6)] text-sm font-bold text-white">{client.name.slice(0, 2)}</span>
                  <div className="min-w-0">
                    <strong className="block truncate text-lg text-ink-primary">{client.name}</strong>
                    <p className="flex min-w-0 items-center gap-2 text-sm"><Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{client.email}</span></p>
                  </div>
                </div>
                <span className={`badge w-fit ${client.gmailConnected ? "badge-ok" : "badge-warn"}`}>{client.gmailConnected ? "Gmail מחובר" : "חיבור חסר"}</span>
              </div>
              <div className="mb-5 grid gap-3 rounded-2xl bg-surface-secondary p-3 text-center text-sm sm:grid-cols-3">
                <div><div className="font-bold text-ink-primary">₪{(client.stats?.toPay ?? 0).toLocaleString("he-IL")}</div><div className="text-ink-muted">לתשלום</div></div>
                <div><div className="font-bold text-ink-primary">{client.stats?.openTasks ?? 0}</div><div className="text-ink-muted">משימות</div></div>
                <div><div className="font-bold text-ink-primary">{client.stats?.invoices ?? 0}</div><div className="text-ink-muted">חשבוניות</div></div>
              </div>
              <p className="mb-4 flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-emerald-300" />Sheets {client.invoiceSheetUrl || client.taskSheetUrl ? "מחובר" : "לא מחובר"} · Drive {client.driveFolderUrl ? "מחובר" : "לא מחובר"}</p>
              <div className="grid gap-2 sm:flex sm:flex-wrap">
                <button className="btn btn-secondary" onClick={() => connectGmail(client.id)}>חבר Gmail</button>
                <button className="btn btn-secondary" onClick={() => scanClient(client.id)} disabled={scanningId === client.id}><RefreshCcw className={["h-4 w-4", scanningId === client.id ? "animate-spin" : ""].join(" ")} />{scanningId === client.id ? "סורק..." : "סרוק"}</button>
                <a className="btn" href={`/dashboard/clients/${client.id}`}>דוח</a>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
