"use client";

import { useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";
import { AlertTriangle, BarChart3, Inbox, MessageCircle, Search } from "lucide-react";

type MessageScan = {
  id: string;
  channel: string;
  externalId: string;
  senderName: string | null;
  senderEmail: string | null;
  senderPhone: string | null;
  subject: string | null;
  bodyText: string;
  occurredAt: string;
  contactType: string;
  intent: string;
  sentiment: string;
  urgency: string;
  summary: string | null;
  confidence: number;
};

type ScanStats = {
  total: number;
  byChannel: Record<string, number>;
  byContactType: Record<string, number>;
  byIntent: Record<string, number>;
  urgent: number;
  sentiment: Record<string, number>;
};

const contactLabels: Record<string, string> = {
  lead: "ליד חדש",
  client: "לקוח קיים",
  vendor: "ספק",
  spam: "ספאם / לא רלוונטי",
  other: "אחר",
};

const intentLabels: Record<string, string> = {
  price_request: "בקשת מחיר",
  complaint: "תלונה",
  payment: "תשלום",
  question: "שאלה",
  other: "אחר",
};

const sentimentLabels: Record<string, string> = {
  positive: "חיובי",
  negative: "שלילי",
  neutral: "ניטרלי",
};

const channelLabels: Record<string, string> = {
  gmail: "ג׳ימייל",
  whatsapp: "וואטסאפ",
};

export default function MessageScansPage() {
  const [scans, setScans] = useState<MessageScan[]>([]);
  const [stats, setStats] = useState<ScanStats | null>(null);
  const [filters, setFilters] = useState({ channel: "all", contactType: "all", urgency: "all", search: "" });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setMessage("");
    const params = new URLSearchParams();
    if (filters.channel !== "all") params.set("channel", filters.channel);
    if (filters.contactType !== "all") params.set("contactType", filters.contactType);
    if (filters.urgency !== "all") params.set("urgency", filters.urgency);
    const [scanResult, statsResult] = await Promise.all([
      apiFetch<{ scans: MessageScan[] }>(`/api/message-scans${params.toString() ? `?${params.toString()}` : ""}`),
      apiFetch<ScanStats>("/api/message-scans/stats"),
    ]);
    setScans(scanResult.scans);
    setStats(statsResult);
    setLoading(false);
  }

  useEffect(() => {
    load().catch((err) => {
      setMessage(err instanceof Error ? err.message : "טעינת סריקות נכשלה");
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.channel, filters.contactType, filters.urgency]);

  const filteredScans = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    if (!query) return scans;
    return scans.filter((scan) =>
      [
        scan.senderName,
        scan.senderEmail,
        scan.senderPhone,
        scan.subject,
        scan.summary,
        scan.bodyText,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [filters.search, scans]);

  return (
    <div className="container">
      <Nav />
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="page-kicker">חוכמת הודעות</div>
          <h1>מנוע סריקת ג׳ימייל ווואטסאפ</h1>
          <p>כל הודעה מסווגת לליד, לקוח, ספק או זבל עם סנטימנט, דחיפות וכוונה עסקית.</p>
        </div>
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "מרענן..." : "רענן סריקות"}
        </button>
      </div>

      {message && <div className="mb-6 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-base text-red-100">{message}</div>}

      <section className="auto-grid mb-6">
        <Kpi label="סה״כ הודעות" value={stats?.total ?? 0} icon={<Inbox className="h-5 w-5" />} />
        <Kpi label="ג׳ימייל" value={stats?.byChannel.gmail ?? 0} icon={<Search className="h-5 w-5" />} />
        <Kpi label="וואטסאפ" value={stats?.byChannel.whatsapp ?? 0} icon={<MessageCircle className="h-5 w-5" />} />
        <Kpi label="דחופות" value={stats?.urgent ?? 0} icon={<AlertTriangle className="h-5 w-5" />} />
      </section>

      <section className="card">
        <div className="grid gap-3 md:grid-cols-4">
          <label>
            חיפוש
            <input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="שם, מייל, טלפון, נושא..." />
          </label>
          <label>
            ערוץ
            <select value={filters.channel} onChange={(event) => setFilters({ ...filters, channel: event.target.value })}>
              <option value="all">כל הערוצים</option>
              <option value="gmail">ג׳ימייל</option>
              <option value="whatsapp">וואטסאפ</option>
            </select>
          </label>
          <label>
            סיווג
            <select value={filters.contactType} onChange={(event) => setFilters({ ...filters, contactType: event.target.value })}>
              <option value="all">כל הסיווגים</option>
              {Object.entries(contactLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            דחיפות
            <select value={filters.urgency} onChange={(event) => setFilters({ ...filters, urgency: event.target.value })}>
              <option value="all">כל הרמות</option>
              <option value="high">גבוהה</option>
              <option value="normal">רגילה</option>
            </select>
          </label>
        </div>
      </section>

      {loading ? (
        <div className="card"><p>טוען סריקות הודעות...</p></div>
      ) : filteredScans.length === 0 ? (
        <div className="card">
          <h2>אין סריקות להצגה</h2>
          <p className="mt-2">הפעל סריקת ג׳ימייל מלוח הבקרה או חבר וואטסאפ כדי להתחיל לסווג הודעות.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:hidden">
            {filteredScans.map((scan) => <ScanCard key={scan.id} scan={scan} />)}
          </div>
          <div className="table-shell hidden md:block">
            <table>
              <thead>
                <tr>
                  <th>זמן</th>
                  <th>ערוץ</th>
                  <th>שולח</th>
                  <th>סיווג</th>
                  <th>כוונה</th>
                  <th>סנטימנט</th>
                  <th>דחיפות</th>
                  <th>סיכום</th>
                </tr>
              </thead>
              <tbody>
                {filteredScans.map((scan) => (
                  <tr key={scan.id}>
                    <td>{new Date(scan.occurredAt).toLocaleString("he-IL")}</td>
                    <td>{channelLabel(scan.channel)}</td>
                    <td>
                      <strong>{scan.senderName || scan.senderEmail || scan.senderPhone || "לא ידוע"}</strong>
                      <br />
                      <span className="text-ink-muted">{scan.subject || scan.senderEmail || scan.senderPhone}</span>
                    </td>
                    <td><ContactBadge value={scan.contactType} /></td>
                    <td>{intentLabels[scan.intent] ?? scan.intent}</td>
                    <td>{sentimentLabels[scan.sentiment] ?? scan.sentiment}</td>
                    <td><UrgencyBadge value={scan.urgency} /></td>
                    <td className="max-w-md">{scan.summary || scan.bodyText.slice(0, 120)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <section className="mt-6 grid gap-6 lg:grid-cols-3">
        <Breakdown title="לפי סיווג" values={stats?.byContactType ?? {}} labels={contactLabels} />
        <Breakdown title="לפי כוונה" values={stats?.byIntent ?? {}} labels={intentLabels} />
        <Breakdown title="סנטימנט" values={stats?.sentiment ?? {}} labels={sentimentLabels} />
      </section>
    </div>
  );
}

function ScanCard({ scan }: { scan: MessageScan }) {
  return (
    <div className="card">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate">{scan.senderName || scan.senderEmail || scan.senderPhone || "שולח לא ידוע"}</h2>
          <p className="break-words">{scan.subject || scan.senderEmail || scan.senderPhone}</p>
        </div>
        <UrgencyBadge value={scan.urgency} />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <span className="badge badge-warn">{channelLabel(scan.channel)}</span>
        <ContactBadge value={scan.contactType} />
        <span className="badge badge-ok">{intentLabels[scan.intent] ?? scan.intent}</span>
      </div>
      <p>{scan.summary || scan.bodyText.slice(0, 180)}</p>
      <small className="mt-3 block text-ink-muted">
        {new Date(scan.occurredAt).toLocaleString("he-IL")} · אמון {Math.round(scan.confidence * 100)}%
      </small>
    </div>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="stat-label">{label}</div>
          <div className="stat-value">{value}</div>
        </div>
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-hover text-accent-primary">{icon}</span>
      </div>
    </div>
  );
}

function Breakdown({ title, values, labels }: { title: string; values: Record<string, number>; labels: Record<string, string> }) {
  const entries = Object.entries(values).sort((a, b) => b[1] - a[1]);
  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-accent-primary" />
        <h2>{title}</h2>
      </div>
      <div className="grid gap-2">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-center justify-between rounded-xl bg-surface-secondary p-3">
            <span>{labels[key] ?? key}</span>
            <strong>{value}</strong>
          </div>
        ))}
        {entries.length === 0 && <p>אין נתונים עדיין.</p>}
      </div>
    </div>
  );
}

function ContactBadge({ value }: { value: string }) {
  const className = value === "lead" ? "badge-ok" : value === "spam" ? "badge-error" : value === "vendor" ? "badge-warn" : "badge";
  return <span className={`badge ${className}`}>{contactLabels[value] ?? value}</span>;
}

function channelLabel(channel: string) {
  return channelLabels[channel] ?? channel;
}

function UrgencyBadge({ value }: { value: string }) {
  return <span className={`badge ${value === "high" ? "badge-error" : "badge-ok"}`}>{value === "high" ? "גבוהה" : "רגילה"}</span>;
}
