"use client";

import { useCallback, useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import {
  apiFetch,
  clearToken,
  isAuthError,
  type DashboardStats,
  type GmailStatus,
} from "@/lib/api";
import { useRouter } from "next/navigation";

type ClientSummary = {
  id: string;
  name: string;
  color: string | null;
  stats?: {
    toPay: number;
    openTasks: number;
    invoices: number;
    missingInvoices: number;
  };
};

type ClientsResponse = {
  clients: ClientSummary[];
  totals: {
    toPay: number;
    openTasks: number;
    invoices: number;
    missingInvoices: number;
  };
};

type ScanStatus = {
  last: {
    id: string;
    type: string;
    status: string;
    found: number;
    saved: number;
    errors: string | null;
    startedAt: string;
    endedAt: string | null;
  } | null;
  nextScheduledScanAt: string;
};

type WhatsAppAssistantStats = {
  sentToday: number;
  activeChats: number;
};

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [summary, setSummary] = useState("");
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [clients, setClients] = useState<ClientsResponse | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [whatsAppStats, setWhatsAppStats] = useState<WhatsAppAssistantStats | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [firstScanRunning, setFirstScanRunning] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const s = await apiFetch<DashboardStats>("/api/dashboard");
      setStats(s);
      const sum = await apiFetch<{ text: string }>("/api/summary/daily");
      setSummary(sum.text);
      const gmail = await apiFetch<GmailStatus>("/api/integrations/gmail/status");
      setGmailStatus(gmail);
      const clientData = await apiFetch<ClientsResponse>("/api/clients");
      setClients(clientData);
      const automation = await apiFetch<ScanStatus>("/api/automation/scan-status");
      setScanStatus(automation);
      apiFetch<WhatsAppAssistantStats>("/api/whatsapp-assistant/stats")
        .then(setWhatsAppStats)
        .catch(() => undefined);
      if (automation.last?.type === "first_time" && automation.last.endedAt) {
        setFirstScanRunning(false);
      }
      setLastUpdatedAt(new Date());
    } catch (err) {
      if (isAuthError(err)) {
        clearToken();
        router.replace("/");
        return;
      }
      setError(err instanceof Error ? err.message : "טעינת הדשבורד נכשלה");
    }
  }, [router]);

  useEffect(() => {
    load();
    const interval = window.setInterval(() => {
      load().catch(() => undefined);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [load]);

  async function startFirstScan() {
    setFirstScanRunning(true);
    setError("ברוך הבא! מתחיל סריקה ראשונית...");
    try {
      await apiFetch<{ started: boolean; message: string }>("/api/automation/first-scan", { method: "POST" });
      setError("סורק Gmail... מזהה חשבוניות... שומר ב-Drive ומעדכן Sheets...");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "סריקה ראשונית נכשלה");
      setFirstScanRunning(false);
    }
  }

  async function runSync() {
    console.log("Scanning Gmail...");
    console.log("Token:", localStorage.getItem("token"));
    setSyncing(true);
    setError("");
    try {
      const result = await apiFetch<{
        emailsProcessed: number;
        emailsFound?: number;
        paymentsCreated: number;
        tasksCreated: number;
        inProgress?: boolean;
        message?: string;
      }>("/api/gmail/scan", { method: "POST" });
      await load();
      setError(
        result.inProgress
          ? "סריקת Gmail כבר רצה. נסה שוב בעוד רגע."
          : result.message ??
              `נמצאו ${result.emailsFound ?? result.emailsProcessed} מיילים ✅`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function scanAllClients() {
    setSyncing(true);
    setError("");
    try {
      const result = await apiFetch<{ success: boolean; results?: Array<{ message?: string }> }>(
        "/api/clients/scan-all",
        { method: "POST" }
      );
      await load();
      setError(result.results?.find((item) => item.message)?.message ?? "סריקת כל הלקוחות הסתיימה");
    } catch (e) {
      setError(e instanceof Error ? e.message : "סריקת לקוחות נכשלה");
    } finally {
      setSyncing(false);
    }
  }

  if (!stats) {
    return (
      <div className="container">
        <p>{error || "טוען..."}</p>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>לוח בקרה</h1>
      <Nav />
      <div className="card">
        <strong style={{ color: "#16a34a" }}>● Live</strong>
        <span style={{ marginRight: "0.75rem" }}>
          עודכן לאחרונה: {lastUpdatedAt ? relativeTime(lastUpdatedAt) : "טוען..."}
        </span>
        <span style={{ marginRight: "0.75rem" }}>
          סריקה הבאה: {scanStatus ? new Date(scanStatus.nextScheduledScanAt).toLocaleString("he-IL") : "טוען..."}
        </span>
        {scanStatus?.last && (
          <p>
            סטטוס אחרון: {scanStatus.last.type} · {scanStatus.last.status} · נמצאו {scanStatus.last.found} · נשמרו{" "}
            {scanStatus.last.saved}
          </p>
        )}
        <button className="btn btn-secondary" onClick={startFirstScan} disabled={firstScanRunning || syncing}>
          {firstScanRunning ? "סריקה ראשונית רצה..." : "הפעל סריקה ראשונית 90 יום"}
        </button>
      </div>
      {clients && (
        <div className="card">
          <h2>כל הלקוחות</h2>
          <div style={{ marginBottom: "1rem" }}>
            <button className="btn" onClick={scanAllClients} disabled={syncing}>
              {syncing ? "סורק..." : "סרוק את כולם"}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => router.push("/dashboard/clients")}
              style={{ marginRight: "0.75rem" }}
            >
              + הוסף לקוח
            </button>
          </div>
          {clients.clients.length === 0 ? (
            <p>אין לקוחות עדיין.</p>
          ) : (
            clients.clients.map((client) => (
              <div key={client.id} style={{ borderTop: "1px solid var(--border)", padding: "0.75rem 0" }}>
                <strong>
                  <span style={{ color: client.color ?? "#3B82F6" }}>■</span> {client.name}
                </strong>
                <div>
                  ₪{client.stats?.toPay ?? 0} לשלם · {client.stats?.openTasks ?? 0} משימות ·{" "}
                  {client.stats?.invoices ?? 0} חשבוניות · {client.stats?.missingInvoices ?? 0} חסרות
                </div>
              </div>
            ))
          )}
          <p>
            סה"כ: ₪{clients.totals.toPay} · {clients.totals.openTasks} משימות ·{" "}
            {clients.totals.invoices} חשבוניות
          </p>
        </div>
      )}
      <div style={{ marginBottom: "1rem" }}>
        <a
          href="https://ai-office-worker-backend.onrender.com/auth/google"
          style={{
            display: "block",
            padding: "12px",
            background: "#4285f4",
            color: "white",
            borderRadius: "8px",
            textAlign: "center",
            textDecoration: "none",
            marginBottom: "0.75rem",
          }}
        >
          התחבר עם Google
        </a>
        <button className="btn" onClick={runSync} disabled={syncing}>
          {syncing ? "סורק מיילים... ⏳" : "סרוק Gmail עכשיו"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => router.push("/camera")}
          style={{ marginRight: "0.75rem" }}
        >
          צלם/העלה חשבונית
        </button>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      </div>
      <div className="grid">
        <div className="card">
          <h2>WhatsApp</h2>
          <div className="stat-label">הודעות נשלחו היום</div>
          <div className="stat-value">{whatsAppStats?.sentToday ?? 0}</div>
          <p>שיחות פעילות: {whatsAppStats?.activeChats ?? 0}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/settings")}>
            ראה כל השיחות
          </button>
        </div>
        <div className="card">
          <div className="stat-label">כסף לשלם</div>
          <div className="stat-value">₪{stats.moneyToPay.toLocaleString("he-IL")}</div>
        </div>
        <div className="card">
          <div className="stat-label">כסף לקבל</div>
          <div className="stat-value">₪{stats.moneyToReceive.toLocaleString("he-IL")}</div>
        </div>
        <div className="card">
          <div className="stat-label">ציון בריאות עסקית</div>
          <div className="stat-value">{stats.businessHealthScore}/100</div>
          <small style={{ color: "var(--muted)" }}>
            חסכת כ-{stats.hoursSavedThisWeek} שעות השבוע
          </small>
        </div>
        <div className="card">
          <div className="stat-label">חשבוניות ממתינות</div>
          <div className="stat-value">{stats.pendingInvoices}</div>
        </div>
        <div className="card">
          <div className="stat-label">חשבוניות חסרות</div>
          <div className="stat-value" style={{ color: "var(--warn)" }}>
            {stats.missingInvoicesCount}
          </div>
        </div>
        <div className="card">
          <div className="stat-label">תשלומים קרובים (7 ימים)</div>
          <div className="stat-value">{stats.upcomingPaymentsCount}</div>
        </div>
        <div className="card">
          <div className="stat-label">משימות פתוחות</div>
          <div className="stat-value">{stats.openTasks}</div>
        </div>
        <div className="card">
          <div className="stat-label">גבייה באיחור</div>
          <div className="stat-value">{stats.overdueCustomerInvoices}</div>
        </div>
      </div>
      <div className="card">
        <h2>סיכום יומי</h2>
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>
          {summary}
        </pre>
      </div>
    </div>
  );
}

function relativeTime(date: Date) {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes === 0) return "עכשיו";
  if (minutes === 1) return "לפני דקה";
  return `לפני ${minutes} דקות`;
}
