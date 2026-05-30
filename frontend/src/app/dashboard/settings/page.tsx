"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";
import { apiFetch, getToken, type GmailStatus } from "@/lib/api";
import { businessTypeLabel, type OrganizationSettings } from "@/lib/business-config";

type AccountantSettings = {
  accountantEmail?: string | null;
  accountantName?: string | null;
  businessName?: string | null;
  businessId?: string | null;
  businessAddress?: string | null;
  sendMonthlyReport?: boolean;
  reportDay?: number;
};

type WhatsAppAssistantSettings = {
  ownerPhone: string;
  isActive: boolean;
  ownerMorningReport: boolean;
  ownerMorningTime: string;
  ownerCriticalAlerts: boolean;
  clientMorningSummary: boolean;
  clientMorningTime: string;
  clientPaymentReminder: boolean;
  clientPaymentDaysWait: number;
  clientInvoiceFound: boolean;
  clientUrgentOnly: boolean;
  maxMessagesPerDay: number;
  quietHoursStart: string;
  quietHoursEnd: string;
  noMessagesOnSaturday: boolean;
  noMessagesOnHolidays: boolean;
};

type WhatsAppStatus = {
  configured: boolean;
  connected: boolean;
  ownerWhatsApp: string;
  from: string;
  webhookUrl: string;
  connectedAt: string | null;
};

type SocialPlatformStatus = {
  platform: string;
  connected: boolean;
  activeAccounts: number;
  totalAccounts: number;
  lastUpdatedAt: string | null;
  clients: string[];
};

type GreenInvoiceEnv = "sandbox" | "production";

type GreenInvoiceStatus = {
  connected: boolean;
  env: GreenInvoiceEnv;
  connectedAt: string | null;
};

type GreenInvoiceConnectResponse = {
  success: boolean;
  error?: string;
};

type SettingsTab = "business" | "general" | "integrations" | "greenInvoice" | "accountant" | "whatsapp" | "notifications";

export default function SettingsPage() {
  const router = useRouter();
  const [form, setForm] = useState<AccountantSettings>({ sendMonthlyReport: true, reportDay: 1 });
  const [whatsapp, setWhatsapp] = useState<WhatsAppAssistantSettings>({
    ownerPhone: "",
    isActive: true,
    ownerMorningReport: true,
    ownerMorningTime: "07:30",
    ownerCriticalAlerts: true,
    clientMorningSummary: true,
    clientMorningTime: "08:00",
    clientPaymentReminder: true,
    clientPaymentDaysWait: 7,
    clientInvoiceFound: true,
    clientUrgentOnly: true,
    maxMessagesPerDay: 2,
    quietHoursStart: "21:00",
    quietHoursEnd: "07:00",
    noMessagesOnSaturday: true,
    noMessagesOnHolidays: true,
  });
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<SettingsTab>("integrations");
  const [organizationSettings, setOrganizationSettings] = useState<OrganizationSettings | null>(null);
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsAppStatus | null>(null);
  const [socialStatus, setSocialStatus] = useState<SocialPlatformStatus[]>([]);
  const [greenInvoiceStatus, setGreenInvoiceStatus] = useState<GreenInvoiceStatus | null>(null);
  const [greenInvoiceForm, setGreenInvoiceForm] = useState({
    apiKeyId: "",
    apiSecret: "",
    env: "sandbox" as GreenInvoiceEnv,
  });
  const [greenInvoiceLoading, setGreenInvoiceLoading] = useState(false);
  const [greenInvoiceMessage, setGreenInvoiceMessage] = useState("");
  const [greenInvoiceError, setGreenInvoiceError] = useState("");

  async function refreshGmailStatus() {
    const status = await apiFetch<GmailStatus>(`/api/integrations/gmail/status?t=${Date.now()}`);
    setGmailStatus(status);
    return status;
  }

  useEffect(() => {
    if (window.location.search.includes("gmail=connected")) {
      setMessage("ג׳ימייל חובר בהצלחה!");
      setGmailStatus((current) => ({
        googleConfigured: current?.googleConfigured ?? true,
        connected: true,
        connectedAt: current?.connectedAt ?? new Date().toISOString(),
      }));
      refreshGmailStatus().catch(() => undefined);
      router.replace("/dashboard/settings");
    }
    apiFetch<AccountantSettings>("/api/accountant/settings")
      .then(setForm)
      .catch((err) => setMessage(err instanceof Error ? err.message : "טעינת הגדרות נכשלה"));
    apiFetch<OrganizationSettings>("/api/organization/settings")
      .then(setOrganizationSettings)
      .catch(() => undefined);
    apiFetch<WhatsAppAssistantSettings>("/api/whatsapp-assistant/settings")
      .then(setWhatsapp)
      .catch(() => undefined);
    apiFetch<GmailStatus>(`/api/integrations/gmail/status?t=${Date.now()}`)
      .then(setGmailStatus)
      .catch(() => undefined);
    apiFetch<WhatsAppStatus>("/api/whatsapp/status")
      .then(setWhatsappStatus)
      .catch(() => undefined);
    apiFetch<{ platforms: SocialPlatformStatus[] }>("/api/social/status")
      .then((data) => setSocialStatus(data.platforms))
      .catch(() => undefined);
    apiFetch<GreenInvoiceStatus>("/api/green-invoice/status")
      .then((status) => {
        setGreenInvoiceStatus(status);
        if (status.env) setGreenInvoiceForm((current) => ({ ...current, env: status.env }));
      })
      .catch(() => undefined);
  }, [router]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      const next = await apiFetch<AccountantSettings>("/api/accountant/settings", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      setForm(next);
      setMessage("הגדרות רואה החשבון נשמרו");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שמירת הגדרות נכשלה");
    }
  }

  async function saveWhatsapp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      const next = await apiFetch<WhatsAppAssistantSettings>("/api/whatsapp-assistant/settings", {
        method: "PUT",
        body: JSON.stringify(whatsapp),
      });
      setWhatsapp(next);
      setMessage("הגדרות עוזר וואטסאפ נשמרו");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שמירת הגדרות וואטסאפ נכשלה");
    }
  }

  async function testWhatsapp(type: "morning" | "number") {
    setMessage("");
    try {
      await apiFetch(`/api/whatsapp-assistant/test/${type}`, { method: "POST" });
      setMessage("הודעת בדיקה נשלחה");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שליחת בדיקה נכשלה");
    }
  }

  async function connectGmail() {
    setMessage("");
    if (!getToken()) {
      router.push(`/login?next=${encodeURIComponent("/dashboard/settings?tab=integrations")}`);
      return;
    }
    try {
      const result = await apiFetch<{ url: string }>("/api/integrations/gmail/connect-url");
      window.location.href = result.url;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "חיבור ג׳ימייל נכשל");
    }
  }

  async function disconnectGmail() {
    setMessage("");
    try {
      await apiFetch("/api/integrations/gmail", { method: "DELETE" });
      setGmailStatus((current) => current ? { ...current, connected: false, connectedAt: null } : current);
      setMessage("ג׳ימייל נותק בהצלחה");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "ניתוק ג׳ימייל נכשל");
    }
  }

  async function refreshGreenInvoiceStatus() {
    const status = await apiFetch<GreenInvoiceStatus>("/api/green-invoice/status");
    setGreenInvoiceStatus(status);
    setGreenInvoiceForm((current) => ({ ...current, env: status.env ?? current.env }));
    return status;
  }

  async function connectGreenInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGreenInvoiceLoading(true);
    setGreenInvoiceMessage("");
    setGreenInvoiceError("");
    try {
      const result = await apiFetch<GreenInvoiceConnectResponse>("/api/green-invoice/connect", {
        method: "POST",
        body: JSON.stringify(greenInvoiceForm),
      });

      if (!result.success) {
        setGreenInvoiceError(result.error ? `החיבור נכשל: ${result.error}` : "החיבור לחשבונית ירוקה נכשל. בדוק את פרטי הגישה.");
        return;
      }

      await refreshGreenInvoiceStatus();
      setGreenInvoiceForm((current) => ({ ...current, apiSecret: "" }));
      setGreenInvoiceMessage("חשבונית ירוקה חוברה בהצלחה.");
    } catch (err) {
      setGreenInvoiceError(err instanceof Error ? `החיבור נכשל: ${err.message}` : "החיבור לחשבונית ירוקה נכשל.");
    } finally {
      setGreenInvoiceLoading(false);
    }
  }

  async function testGreenInvoice() {
    setGreenInvoiceLoading(true);
    setGreenInvoiceMessage("");
    setGreenInvoiceError("");
    try {
      const result = await apiFetch<GreenInvoiceConnectResponse>("/api/green-invoice/test", { method: "POST" });
      if (!result.success) {
        setGreenInvoiceError(result.error ? `בדיקת החיבור נכשלה: ${result.error}` : "בדיקת החיבור נכשלה.");
        return;
      }
      setGreenInvoiceMessage("בדיקת החיבור הצליחה.");
      await refreshGreenInvoiceStatus();
    } catch (err) {
      setGreenInvoiceError(err instanceof Error ? `בדיקת החיבור נכשלה: ${err.message}` : "בדיקת החיבור נכשלה.");
    } finally {
      setGreenInvoiceLoading(false);
    }
  }

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: "business", label: "סוג עסק ומודולים" },
    { id: "general", label: "הגדרות כלליות" },
    { id: "integrations", label: "חיבורים" },
    { id: "greenInvoice", label: "חשבונית ירוקה" },
    { id: "accountant", label: "רואה חשבון" },
    { id: "whatsapp", label: "עוזר וואטסאפ" },
    { id: "notifications", label: "התראות" },
  ];

  return (
    <div className="container">
      <Nav />
      <div className="mb-8"><div className="page-kicker">בקרת סביבת עבודה</div><h1>הגדרות</h1></div>
      {message && <div className="mb-6 rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4 text-sm text-ink-primary">{message}</div>}

      <div className="mb-6 flex gap-2 overflow-x-auto rounded-2xl border border-[var(--border)] bg-surface-card p-2 shadow-card md:flex-wrap">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={[
              "shrink-0 rounded-xl px-4 py-3 text-[15px] font-semibold transition",
              activeTab === tab.id
                ? "bg-[#6366F1] text-white shadow-[inset_0_-3px_0_rgba(255,255,255,0.32),0_12px_28px_rgba(99,102,241,0.28)]"
                : "text-[#E2E8F0] hover:bg-surface-hover hover:text-white",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "business" && (
        <div className="card grid gap-5">
          <div>
            <div className="page-kicker">הגדרות מערכת</div>
            <h2>סוג עסק ומודולים פעילים</h2>
            <p>הבחירה כאן קובעת אילו אזורים יוצגו בדשבורד ובניווט. ההגדרות המלאות זמינות בעמוד ייעודי.</p>
          </div>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4 text-sm text-ink-secondary">
            הגדרה נוכחית: {businessTypeLabel(organizationSettings?.businessType)} · {organizationSettings?.enabledModules.length ?? 7} מודולים פעילים
          </div>
          <button className="btn" type="button" onClick={() => router.push("/dashboard/business-settings")}>פתח הגדרות עסק</button>
        </div>
      )}

      {activeTab === "general" && (
        <form className="card grid gap-3" onSubmit={save}>
          <h2>הגדרות כלליות</h2>
          <label>
            שם העסק הרשמי
            <input placeholder="שם העסק הרשמי" value={form.businessName ?? ""} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
          </label>
          <label>
            ח.פ / עוסק מורשה
            <input placeholder="ח.פ / עוסק מורשה" value={form.businessId ?? ""} onChange={(e) => setForm({ ...form, businessId: e.target.value })} />
          </label>
          <label>
            כתובת העסק
            <input placeholder="כתובת העסק" value={form.businessAddress ?? ""} onChange={(e) => setForm({ ...form, businessAddress: e.target.value })} />
          </label>
          <button className="btn" type="submit">שמור הגדרות כלליות</button>
        </form>
      )}

      {activeTab === "integrations" && (
        <section className="grid gap-5">
          <div className="card">
            <div className="mb-5">
              <h2>חיבורים</h2>
              <p>כאן מחברים את ג׳ימייל, וואטסאפ וחשבונות הסושיאל. בלי ג׳ימייל מחובר סריקת המיילים לא תעבוד.</p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <GmailIntegrationCard
                status={gmailStatus}
                onConnect={connectGmail}
                onDisconnect={disconnectGmail}
              />
              <IntegrationCard
                title="וואטסאפ"
                status={whatsappStatus?.connected ? "מחובר" : whatsappStatus?.configured ? "מוגדר, לא אומת" : "לא מוגדר"}
                connected={Boolean(whatsappStatus?.connected)}
                description="משמש להתראות, שיחות נכנסות, יצירת לידים וזיהוי תשובות."
                meta={[
                  whatsappStatus?.ownerWhatsApp ? `מספר בעלים: ${whatsappStatus.ownerWhatsApp}` : "לא הוגדר מספר בעלים",
                  whatsappStatus?.from ? `שולח: ${whatsappStatus.from}` : "",
                ].filter(Boolean).join(" · ")}
                actionLabel="פתח הגדרות וואטסאפ"
                onAction={() => setActiveTab("whatsapp")}
              />
            </div>
          </div>

          <div className="card">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2>חיבורי סושיאל</h2>
                <p>חשבונות סושיאל מחוברים דרך לקוחות במודול הסושיאל.</p>
              </div>
              <button type="button" className="btn sm:!w-auto" onClick={() => router.push("/social")}>פתח מודול סושיאל</button>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {["instagram", "facebook", "linkedin"].map((platform) => {
                const status = socialStatus.find((item) => item.platform === platform);
                return (
                  <IntegrationCard
                    key={platform}
                    title={platformLabel(platform)}
                    status={status?.connected ? "מחובר" : "לא מחובר"}
                    connected={Boolean(status?.connected)}
                    description="חיבור לפרסום תוכן, תכנון פוסטים ואוטומציות סושיאל."
                    meta={status?.connected ? `${status.activeAccounts} חשבונות פעילים${status.clients.length ? ` · ${status.clients.join(", ")}` : ""}` : "חבר דרך מודול סושיאל לפי לקוח."}
                    actionLabel={status?.connected ? "נהל חיבור" : "חבר חשבון"}
                    onAction={() => router.push("/social")}
                  />
                );
              })}
            </div>
          </div>
        </section>
      )}

      {activeTab === "greenInvoice" && (
        <section className="grid gap-5">
          <form className="card grid gap-5" onSubmit={connectGreenInvoice}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="page-kicker">חשבונית ירוקה / מורנינג</div>
                <h2>חיבור חשבונית ירוקה</h2>
                <p>חבר את חשבון חשבונית ירוקה כדי לאפשר בהמשך הפקת חשבוניות מתוך המערכת.</p>
              </div>
              <span className={`badge w-fit ${greenInvoiceStatus?.connected ? "badge-ok" : "badge-warn"}`}>
                {greenInvoiceStatus?.connected ? "מחובר" : "לא מחובר"}
              </span>
            </div>

            {greenInvoiceStatus?.connected && (
              <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm font-semibold text-emerald-100">
                מחובר · סביבה: {greenInvoiceStatus.env === "production" ? "אמיתי" : "בדיקות"}
                {greenInvoiceStatus.connectedAt ? ` · חובר בתאריך ${new Date(greenInvoiceStatus.connectedAt).toLocaleString("he-IL")}` : ""}
              </div>
            )}

            {greenInvoiceMessage && (
              <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-100">
                {greenInvoiceMessage}
              </div>
            )}
            {greenInvoiceError && (
              <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-100">
                {greenInvoiceError}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <label>
                מזהה מפתח גישה
                <input
                  dir="ltr"
                  placeholder="מזהה מפתח"
                  value={greenInvoiceForm.apiKeyId}
                  onChange={(event) => setGreenInvoiceForm({ ...greenInvoiceForm, apiKeyId: event.target.value })}
                  autoComplete="off"
                />
              </label>
              <label>
                סוד מפתח גישה
                <input
                  dir="ltr"
                  type="password"
                  placeholder="סוד מפתח"
                  value={greenInvoiceForm.apiSecret}
                  onChange={(event) => setGreenInvoiceForm({ ...greenInvoiceForm, apiSecret: event.target.value })}
                  autoComplete="new-password"
                />
              </label>
              <label>
                סביבת עבודה
                <select
                  value={greenInvoiceForm.env}
                  onChange={(event) => setGreenInvoiceForm({ ...greenInvoiceForm, env: event.target.value as GreenInvoiceEnv })}
                >
                  <option value="sandbox">בדיקות</option>
                  <option value="production">אמיתי</option>
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:flex sm:flex-wrap">
              <button className="btn" type="submit" disabled={greenInvoiceLoading}>
                {greenInvoiceLoading ? "מחבר..." : "חבר"}
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={testGreenInvoice}
                disabled={greenInvoiceLoading || !greenInvoiceStatus?.connected}
              >
                {greenInvoiceLoading ? "בודק..." : "בדוק חיבור"}
              </button>
            </div>
          </form>
        </section>
      )}

      {activeTab === "accountant" && (
        <form className="card grid gap-3" onSubmit={save}>
          <h2>רואה חשבון</h2>
          <label>
            שם רואה החשבון
            <input placeholder="שם רואה החשבון" value={form.accountantName ?? ""} onChange={(e) => setForm({ ...form, accountantName: e.target.value })} />
          </label>
          <label>
            אימייל רואה החשבון
            <input type="email" placeholder="אימייל רואה החשבון" value={form.accountantEmail ?? ""} onChange={(e) => setForm({ ...form, accountantEmail: e.target.value })} />
          </label>
          <label>
            תאריך שליחה
            <input type="number" min={1} max={28} value={form.reportDay ?? 1} onChange={(e) => setForm({ ...form, reportDay: Number(e.target.value) })} />
          </label>
          <label className="flex flex-row items-center justify-start gap-3 rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
            <input className="w-auto" type="checkbox" checked={form.sendMonthlyReport ?? true} onChange={(e) => setForm({ ...form, sendMonthlyReport: e.target.checked })} />
            שלח דוח חודשי
          </label>
          <button className="btn" type="submit">שמור הגדרות רואה חשבון</button>
        </form>
      )}

      {activeTab === "whatsapp" && (
        <form className="card grid gap-5" onSubmit={saveWhatsapp}>
          <h2>עוזר וואטסאפ</h2>
          <section className="grid gap-3">
            <h3 className="text-lg font-semibold text-ink-primary">מספר הוואטסאפ שלי</h3>
            <label>
              מספר הוואטסאפ שלי
              <input dir="ltr" placeholder="+972..." value={whatsapp.ownerPhone} onChange={(e) => setWhatsapp({ ...whatsapp, ownerPhone: e.target.value })} />
            </label>
          </section>

          <section className="grid gap-3">
            <h3 className="text-lg font-semibold text-ink-primary">שעת בוקר / שעת שליחה / שעות שקטות</h3>
            <label>
              שעת בוקר
              <input type="time" value={whatsapp.ownerMorningTime} onChange={(e) => setWhatsapp({ ...whatsapp, ownerMorningTime: e.target.value })} />
            </label>
            <label>
              שעת שליחה
              <input type="time" value={whatsapp.clientMorningTime} onChange={(e) => setWhatsapp({ ...whatsapp, clientMorningTime: e.target.value })} />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label>
                שעות שקטות - אל תשלח אחרי
                <input type="time" value={whatsapp.quietHoursStart} onChange={(e) => setWhatsapp({ ...whatsapp, quietHoursStart: e.target.value })} />
              </label>
              <label>
                שעות שקטות - אל תשלח לפני
                <input type="time" value={whatsapp.quietHoursEnd} onChange={(e) => setWhatsapp({ ...whatsapp, quietHoursEnd: e.target.value })} />
              </label>
            </div>
          </section>

          <section className="grid gap-3">
            <h3 className="text-lg font-semibold text-ink-primary">הגדרות בעלים</h3>
            <label className="flex flex-row items-center justify-start gap-3 rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
              <input className="w-auto" type="checkbox" checked={whatsapp.isActive} onChange={(e) => setWhatsapp({ ...whatsapp, isActive: e.target.checked })} />
              עוזר וואטסאפ פעיל
            </label>
            <label className="flex flex-row items-center justify-start gap-3 rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
              <input className="w-auto" type="checkbox" checked={whatsapp.ownerMorningReport} onChange={(e) => setWhatsapp({ ...whatsapp, ownerMorningReport: e.target.checked })} />
              שלח לי דוח בוקר יומי
            </label>
            <label className="flex flex-row items-center justify-start gap-3 rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
              <input className="w-auto" type="checkbox" checked={whatsapp.ownerCriticalAlerts} onChange={(e) => setWhatsapp({ ...whatsapp, ownerCriticalAlerts: e.target.checked })} />
              קבל התראות דחופות
            </label>
          </section>

          <section className="grid gap-3">
            <h3 className="text-lg font-semibold text-ink-primary">הגדרות ללקוחות</h3>
            <label className="flex flex-row items-center justify-start gap-3 rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
              <input className="w-auto" type="checkbox" checked={whatsapp.clientMorningSummary} onChange={(e) => setWhatsapp({ ...whatsapp, clientMorningSummary: e.target.checked })} />
              שלח ללקוחות סיכום בוקר
            </label>
            <label>
              שליחת תזכורת תשלום אחרי מספר ימים
              <input type="number" min={1} max={60} value={whatsapp.clientPaymentDaysWait} onChange={(e) => setWhatsapp({ ...whatsapp, clientPaymentDaysWait: Number(e.target.value) })} />
            </label>
            <label>
              מקסימום הודעות ביום ללקוח
              <input type="number" min={1} max={3} value={whatsapp.maxMessagesPerDay} onChange={(e) => setWhatsapp({ ...whatsapp, maxMessagesPerDay: Number(e.target.value) })} />
            </label>
            <label className="flex flex-row items-center justify-start gap-3 rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
              <input className="w-auto" type="checkbox" checked={whatsapp.clientPaymentReminder} onChange={(e) => setWhatsapp({ ...whatsapp, clientPaymentReminder: e.target.checked })} />
              שלח תזכורות תשלום
            </label>
            <label className="flex flex-row items-center justify-start gap-3 rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
              <input className="w-auto" type="checkbox" checked={whatsapp.clientInvoiceFound} onChange={(e) => setWhatsapp({ ...whatsapp, clientInvoiceFound: e.target.checked })} />
              עדכן לקוח כשנמצאה חשבונית
            </label>
            <label className="flex flex-row items-center justify-start gap-3 rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
              <input className="w-auto" type="checkbox" checked={whatsapp.clientUrgentOnly} onChange={(e) => setWhatsapp({ ...whatsapp, clientUrgentOnly: e.target.checked })} />
              לשלוח רק הודעות דחופות
            </label>
          </section>

          <div className="grid gap-3 sm:flex sm:flex-wrap">
            <button className="btn" type="submit">שמור הגדרות וואטסאפ</button>
            <button className="btn btn-secondary" type="button" onClick={() => testWhatsapp("morning")}>
              שלח דוח בוקר לעצמי עכשיו
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => testWhatsapp("number")}>
              בדוק שהמספר עובד
            </button>
          </div>
        </form>
      )}

      {activeTab === "notifications" && (
        <form className="card grid gap-3" onSubmit={saveWhatsapp}>
          <h2>התראות</h2>
          <label className="flex flex-row items-center justify-start gap-3 rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
            <input className="w-auto" type="checkbox" checked={whatsapp.noMessagesOnSaturday} onChange={(e) => setWhatsapp({ ...whatsapp, noMessagesOnSaturday: e.target.checked })} />
            לא לשלוח התראות בשבת
          </label>
          <label className="flex flex-row items-center justify-start gap-3 rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
            <input className="w-auto" type="checkbox" checked={whatsapp.noMessagesOnHolidays} onChange={(e) => setWhatsapp({ ...whatsapp, noMessagesOnHolidays: e.target.checked })} />
            לא לשלוח התראות בחגים
          </label>
          <button className="btn" type="submit">שמור הגדרות התראות</button>
        </form>
      )}
    </div>
  );
}

function IntegrationCard({
  title,
  status,
  connected,
  description,
  meta,
  actionLabel,
  onAction,
}: {
  title: string;
  status: string;
  connected: boolean;
  description: string;
  meta?: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-surface-secondary p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-ink-primary">{title}</h3>
          <p className="mt-1 text-sm">{description}</p>
        </div>
        <span className={`badge ${connected ? "badge-ok" : "badge-warn"}`}>{status}</span>
      </div>
      {meta && <p className="mb-4 break-words text-sm text-ink-muted">{meta}</p>}
      <button type="button" className="btn btn-secondary" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}

function GmailIntegrationCard({
  status,
  onConnect,
  onDisconnect,
}: {
  status: GmailStatus | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const connected = Boolean(status?.connected);
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-surface-secondary p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-ink-primary">ג׳ימייל</h3>
          <p className="mt-1 text-sm">חובה לסריקת מיילים, יצירת לידים, זיהוי ספקים וחשבוניות.</p>
        </div>
        <span className={`badge ${connected ? "badge-ok" : "badge-warn"}`}>
          {connected ? "מחובר" : status?.googleConfigured === false ? "התחברות גוגל לא מוגדרת" : "לא מחובר"}
        </span>
      </div>
      <p className="mb-4 break-words text-sm text-ink-muted">
        {connected && status?.connectedAt
          ? `חובר בתאריך ${new Date(status.connectedAt).toLocaleString("he-IL")}`
          : "כפתור החיבור מעביר אותך לאישור גוגל כדי לאפשר סריקת מיילים."}
      </p>
      {connected ? (
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <button type="button" className="btn btn-secondary" onClick={onConnect}>
            חבר ג׳ימייל מחדש
          </button>
          <button type="button" className="btn btn-danger" onClick={onDisconnect}>
            נתק ג׳ימייל
          </button>
        </div>
      ) : (
        <button type="button" className="btn min-h-[56px] w-full bg-[#2563EB] text-base shadow-[0_16px_32px_rgba(37,99,235,0.35)] hover:bg-[#1D4ED8]" onClick={onConnect}>
          חבר ג׳ימייל
        </button>
      )}
    </div>
  );
}

function platformLabel(platform: string) {
  if (platform === "instagram") return "אינסטגרם";
  if (platform === "facebook") return "פייסבוק";
  if (platform === "linkedin") return "לינקדאין";
  return "סושיאל";
}
