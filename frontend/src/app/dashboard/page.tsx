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

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [summary, setSummary] = useState("");
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [clients, setClients] = useState<ClientsResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
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
  }, [load]);

  async function runSync() {
    setSyncing(true);
    setError("");
    try {
      const result = await apiFetch<{
        emailsProcessed: number;
        paymentsCreated: number;
        tasksCreated: number;
        inProgress?: boolean;
        message?: string;
      }>("/api/sync/gmail", { method: "POST" });
      await load();
      setError(
        result.inProgress
          ? "סריקת Gmail כבר רצה. נסה שוב בעוד רגע."
          : result.message ??
              `נסרקו ${result.emailsProcessed} מיילים, נוספו ${result.paymentsCreated} תשלומים`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function connectGmail() {
    setError("");
    try {
      const { url } = await apiFetch<{ url: string }>("/api/integrations/gmail/connect-url");
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect Gmail");
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
        <button
          className="btn btn-secondary"
          onClick={connectGmail}
          style={{ marginLeft: "0.75rem" }}
        >
          {gmailStatus?.connected ? "Gmail מחובר ✓" : "Connect Gmail"}
        </button>
        <button className="btn" onClick={runSync} disabled={syncing}>
          {syncing ? "סורק Gmail..." : "סרוק Gmail עכשיו"}
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
