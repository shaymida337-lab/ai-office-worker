"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";
import { MessageCircle, Phone, Send, Settings, ShieldAlert } from "lucide-react";

type WhatsAppStatus = {
  configured: boolean;
  connected: boolean;
  ownerWhatsApp: string;
  from: string;
  webhookUrl: string;
  connectedAt: string | null;
};

type ClientItem = {
  id: string;
  name: string;
  email: string;
  whatsappNumber: string | null;
  whatsappUnread?: number;
  whatsappLastMessage?: { body: string; createdAt: string } | null;
};

export default function WhatsAppSettingsPage() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [ownerWhatsApp, setOwnerWhatsApp] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const next = await apiFetch<WhatsAppStatus>("/api/whatsapp/status");
    const clientData = await apiFetch<{ clients: ClientItem[] }>("/api/clients");
    setStatus(next);
    setClients(clientData.clients);
    setOwnerWhatsApp(next.ownerWhatsApp.replace(/^whatsapp:/, ""));
  }

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : "טעינת הגדרות וואטסאפ נכשלה"));
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      await apiFetch<WhatsAppStatus>("/api/settings/whatsapp", {
        method: "POST",
        body: JSON.stringify({ ownerWhatsApp }),
      });
      await load();
      setMessage("מספר נשמר בהצלחה");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שמירת הגדרות וואטסאפ נכשלה");
    } finally {
      setLoading(false);
    }
  }

  async function sendTest() {
    setMessage("");
    setLoading(true);
    try {
      await apiFetch("/api/whatsapp/test", { method: "POST" });
      setMessage("הודעת בדיקה נשלחה!");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שליחת הודעת בדיקה נכשלה");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <Nav />
      <div className="mb-8">
        <div className="page-kicker">הודעות לקוחות</div>
        <h1>וואטסאפ</h1>
        <p>מרכז חיבור, בדיקות והתראות וואטסאפ לכל הלקוחות.</p>
      </div>
      {message && <div className="mb-6 rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4 text-sm text-ink-primary">{message}</div>}
      <div className="grid gap-6 xl:grid-cols-[.85fr_1.15fr]">
        <aside className="card">
          <div className="mb-5 flex items-center gap-3">
            <Settings className="h-5 w-5 text-accent-primary" />
            <h2>הגדרות חיבור</h2>
          </div>
          <div className="space-y-3 text-sm">
            <StatusRow label="ספק הודעות" ok={Boolean(status?.configured)} />
            <StatusRow label="חיבור" ok={Boolean(status?.connected)} />
            <div className="break-all rounded-xl bg-surface-secondary p-3 text-ink-secondary">מספר שולח: {status?.from || "לא הוגדר"}</div>
            <div className="break-all rounded-xl bg-surface-secondary p-3 text-ink-secondary">כתובת קבלת הודעות: {status?.webhookUrl || "לא הוגדר"}</div>
          </div>
        {status && !status.configured && (
          <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-amber-200">
            <strong className="flex items-center gap-2"><ShieldAlert className="h-4 w-4" />כדי להפעיל וואטסאפ:</strong>
            <ol>
              <li>כנס למסוף ספק ההודעות.</li>
              <li>העתק את פרטי החיבור לקובץ הסביבה של השרת.</li>
              <li>הגדר כתובת ציבורית לקבלת הודעות נכנסות.</li>
            </ol>
          </div>
        )}
        <form onSubmit={save} className="mt-5 grid gap-3">
          <label>
            מספר הוואטסאפ של בעל העסק
            <input
              dir="ltr"
              placeholder="+972501234567"
              value={ownerWhatsApp}
              onChange={(e) => setOwnerWhatsApp(e.target.value)}
            />
          </label>
          <button className="btn" type="submit" disabled={loading}>
            {loading ? "שומר..." : "שמור מספר וואטסאפ"}
          </button>
        </form>
        <button className="btn btn-secondary mt-3" onClick={sendTest} disabled={loading || !status?.configured}>
          <Send className="h-4 w-4" />שלח הודעת בדיקה
        </button>
        </aside>

        <section className="card">
          <div className="mb-5 flex items-center gap-3">
            <MessageCircle className="h-5 w-5 text-emerald-300" />
            <h2>פעילות וואטסאפ של לקוחות</h2>
          </div>
          <div className="grid gap-3">
            {clients.length === 0 ? (
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
                <h2>אין לקוחות לחיבור וואטסאפ</h2>
                <p className="mt-2">הוסף לקוחות ואז תוכל לראות כאן שיחות, מספרים חסרים והודעות שלא נקראו.</p>
                <Link className="btn mt-4" href="/dashboard/clients">הוסף לקוח</Link>
              </div>
            ) : (
              clients.map((client) => (
                <Link key={client.id} href={`/dashboard/clients/${client.id}`} className="group rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4 transition hover:border-accent-primary/40 hover:bg-surface-hover">
                  <div className="grid gap-3 sm:flex sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-11 w-11 place-items-center rounded-full bg-[linear-gradient(135deg,#10B981,#3B82F6)] text-sm font-bold text-white">{client.name.slice(0, 2)}</span>
                      <div className="min-w-0">
                        <strong className="block truncate text-ink-primary">{client.name}</strong>
                        <p className="flex min-w-0 items-center gap-2 text-sm"><Phone className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{client.whatsappNumber || "לא הוגדר מספר וואטסאפ"}</span></p>
                      </div>
                    </div>
                    {Boolean(client.whatsappUnread) && <span className="badge badge-warn w-fit">{client.whatsappUnread} לא נקראו</span>}
                  </div>
                  {client.whatsappLastMessage && (
                    <div className="mt-4 max-w-[85%] rounded-2xl rounded-tr-md bg-accent-primary/15 p-3 text-right text-sm text-ink-secondary">
                      {client.whatsappLastMessage.body}
                    </div>
                  )}
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-surface-secondary p-3">
      <span className="text-ink-secondary">{label}</span>
      <span className={`badge ${ok ? "badge-ok" : "badge-error"}`}>{ok ? "מחובר" : "לא הוגדר"}</span>
    </div>
  );
}
