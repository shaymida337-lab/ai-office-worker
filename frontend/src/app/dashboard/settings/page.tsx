"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AppShell,
  Button,
  Card,
  FormLabel,
  Input,
  MessageBanner,
  PageTitle,
  Select,
  StatusBadge,
  Textarea,
} from "@/components/natalie-ui";
import { API_URL, apiFetch, getToken, type GmailStatus } from "@/lib/api";
import {
  buildGmailConnectionFromStatus,
  gmailConnectionBadgeLabel,
  gmailReconnectActionLabel,
  type GmailConnectionStateModel,
} from "@/lib/integrations/gmailConnection";
import { businessTypeLabel, type OrganizationSettings } from "@/lib/business-config";
import { oauthReturnMessage } from "@/lib/integrations/oauthReturnMessages";

type SettingsMessage = { text: string; tone: "success" | "error" };

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

const checkboxRowClass =
  "flex flex-row items-center justify-start gap-3 rounded-2xl border border-[#DBE5F4] bg-[#F8FAFF] px-4 py-3.5 font-semibold text-[#111827] dark:border-[#1F2A44] dark:bg-[#0F172A] dark:text-[#F8FAFC]";

const sectionTitleClass =
  "text-xl font-black text-[var(--natalie-text-primary,#0F172A)] md:text-2xl";

const sectionHintClass =
  "mt-1 text-sm font-semibold leading-6 text-[var(--natalie-text-muted,#64748B)] md:text-base";

const blockTitleClass =
  "text-base font-black text-[var(--natalie-text-primary,#0F172A)]";

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
  const [message, setMessage] = useState<SettingsMessage | null>(null);
  const [savingAccountant, setSavingAccountant] = useState(false);
  const [savingWhatsapp, setSavingWhatsapp] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("integrations");
  const [organizationSettings, setOrganizationSettings] = useState<OrganizationSettings | null>(null);
  const [businessProfile, setBusinessProfile] = useState("");
  const [businessProfileMessage, setBusinessProfileMessage] = useState("");
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
  const gmailConnection = useMemo(
    () =>
      buildGmailConnectionFromStatus(gmailStatus, {
        statusKnown: gmailStatus !== null,
        statusStale: false,
        connecting: false,
      }),
    [gmailStatus]
  );

  async function refreshGmailStatus() {
    const status = await apiFetch<GmailStatus>(`/api/integrations/gmail/status?t=${Date.now()}`);
    setGmailStatus(status);
    return status;
  }

  useEffect(() => {
    // תיקון הבאג הנבלע: כל תוצאות ה-OAuth (connected / invalid_state /
    // error+reason, כולל token_already_bound) מוצגות למשתמש — לא רק הצלחה.
    const oauthResult = oauthReturnMessage(window.location.search);
    if (oauthResult) {
      setMessage({ text: oauthResult.text, tone: oauthResult.tone });
      if (oauthResult.provider === "gmail" && oauthResult.tone === "success") {
        setGmailStatus((current) => ({
          googleConfigured: current?.googleConfigured ?? true,
          connected: true,
          connectedAt: current?.connectedAt ?? new Date().toISOString(),
        }));
        refreshGmailStatus().catch(() => undefined);
      }
      router.replace("/dashboard/settings");
    }
    apiFetch<AccountantSettings>("/api/accountant/settings")
      .then(setForm)
      .catch((err) => setMessage({ text: err instanceof Error ? err.message : "טעינת הגדרות נכשלה", tone: "error" }));
    apiFetch<OrganizationSettings>("/api/organization/settings")
      .then(setOrganizationSettings)
      .catch(() => undefined);
    apiFetch<{ businessProfile: string }>("/api/settings/business-profile")
      .then((data) => setBusinessProfile(data?.businessProfile ?? ""))
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
      .then((data) => setSocialStatus(Array.isArray(data?.platforms) ? data.platforms : []))
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
    setMessage(null);
    setSavingAccountant(true);
    try {
      const next = await apiFetch<AccountantSettings>("/api/accountant/settings", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      setForm(next);
      setMessage({ text: "הגדרות רואה החשבון נשמרו", tone: "success" });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "שמירת הגדרות נכשלה", tone: "error" });
    } finally {
      setSavingAccountant(false);
    }
  }

  async function saveWhatsapp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setSavingWhatsapp(true);
    try {
      const next = await apiFetch<WhatsAppAssistantSettings>("/api/whatsapp-assistant/settings", {
        method: "PUT",
        body: JSON.stringify(whatsapp),
      });
      setWhatsapp(next);
      setMessage({ text: "הגדרות עוזר וואטסאפ נשמרו", tone: "success" });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "שמירת הגדרות וואטסאפ נכשלה", tone: "error" });
    } finally {
      setSavingWhatsapp(false);
    }
  }

  async function saveBusinessProfile() {
    setBusinessProfileMessage("");
    try {
      const next = await apiFetch<{ businessProfile: string }>("/api/settings/business-profile", {
        method: "PUT",
        body: JSON.stringify({ businessProfile }),
      });
      setBusinessProfile(next.businessProfile);
      setBusinessProfileMessage("נשמר");
    } catch (err) {
      setBusinessProfileMessage(err instanceof Error ? err.message : "שמירת הזיכרון של נטלי נכשלה");
    }
  }

  async function testWhatsapp(type: "morning" | "number") {
    setMessage(null);
    try {
      await apiFetch(`/api/whatsapp-assistant/test/${type}`, { method: "POST" });
      setMessage({ text: "הודעת בדיקה נשלחה", tone: "success" });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "שליחת בדיקה נכשלה", tone: "error" });
    }
  }

  async function connectGmail() {
    setMessage(null);
    console.log("GOOGLE_RECONNECT_CLICKED");
    const token = getToken();
    if (!token) {
      router.push(`/login?next=${encodeURIComponent("/dashboard/settings?tab=integrations")}`);
      return;
    }
    const url = `${API_URL}/api/integrations/gmail/connect?token=${encodeURIComponent(token)}&returnTo=${encodeURIComponent("/dashboard/settings")}`;
    console.log("GOOGLE_AUTH_REDIRECT_STARTED", url);
    window.location.href = url;
  }

  async function disconnectGmail() {
    setMessage(null);
    try {
      await apiFetch("/api/integrations/gmail", { method: "DELETE" });
      setGmailStatus((current) => current ? { ...current, connected: false, connectedAt: null } : current);
      setMessage({ text: "ג׳ימייל נותק בהצלחה", tone: "success" });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "ניתוק ג׳ימייל נכשל", tone: "error" });
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

  const socialConnected = socialStatus.some((item) => item.connected);
  const connectionStatusItems = [
    {
      id: "gmail",
      label: "Gmail",
      connected: Boolean(gmailConnection.treatAsConnectedForUi),
      statusLabel: gmailConnectionBadgeLabel(gmailConnection, { googleConfigured: gmailStatus?.googleConfigured }),
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      connected: Boolean(whatsappStatus?.connected),
      statusLabel: whatsappStatus?.connected ? "מחובר" : whatsappStatus?.configured ? "מוגדר" : "לא מחובר",
    },
    {
      id: "social",
      label: "Social",
      connected: socialConnected,
      statusLabel: socialConnected ? "מחובר" : "לא מחובר",
    },
    {
      id: "greenInvoice",
      label: "חשבונית ירוקה",
      connected: Boolean(greenInvoiceStatus?.connected),
      statusLabel: greenInvoiceStatus?.connected ? "מחובר" : "לא מחובר",
    },
  ];

  return (
    <AppShell pageTitle={<PageTitle title="הגדרות" subtitle="בקרת סביבת עבודה" />}>
      <div className="grid gap-4">
        {message ? (
          <MessageBanner tone={message.tone}>{message.text}</MessageBanner>
        ) : null}

        <div
          className="flex flex-wrap gap-2.5 sm:gap-3"
          role="list"
          aria-label="סטטוס חיבורים"
        >
          {connectionStatusItems.map((item) => (
            <div
              key={item.id}
              role="listitem"
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-card-bg,#ffffff)] px-3.5 py-1.5 shadow-sm"
            >
              <span className="text-sm font-bold text-[var(--natalie-text-primary,#0F172A)]">{item.label}</span>
              <StatusBadge tone={item.connected ? "success" : "warn"}>{item.statusLabel}</StatusBadge>
            </div>
          ))}
        </div>

        <div
          role="tablist"
          aria-label="קטגוריות הגדרות"
          className="flex flex-wrap gap-2.5 sm:gap-3"
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-11 rounded-full border px-4 py-2 text-sm font-bold transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] ${
                  active
                    ? "border-[#1D4ED8] bg-[#1D4ED8] text-white shadow-sm"
                    : "border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-card-bg,#ffffff)] text-[var(--natalie-text-muted,#64748B)] hover:border-[#93C5FD] hover:text-[#1D4ED8]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "business" ? (
          <Card className="grid gap-5 md:p-6">
            <header>
              <h2 className={sectionTitleClass}>סוג עסק ומודולים פעילים</h2>
              <p className={sectionHintClass}>
                הבחירה כאן קובעת אילו אזורים יוצגו בדשבורד ובניווט. ההגדרות המלאות זמינות בעמוד ייעודי.
              </p>
            </header>
            <div className="rounded-2xl border border-[#DBE5F4] bg-[#F8FAFF] px-4 py-3 text-sm font-semibold text-[var(--natalie-text-muted,#64748B)] dark:border-[#1F2A44] dark:bg-[#0F172A]">
              הגדרה נוכחית: {businessTypeLabel(organizationSettings?.businessType)} · {organizationSettings?.enabledModules.length ?? 7} מודולים פעילים
            </div>
            <div className="flex flex-wrap gap-3 border-t border-[var(--natalie-border,#D9E2F2)] pt-4">
              <Button type="button" onClick={() => router.push("/dashboard/business-settings")}>
                פתח הגדרות עסק
              </Button>
            </div>
          </Card>
        ) : null}

        {activeTab === "general" ? (
          <Card className="md:p-6">
            <form className="grid gap-5" onSubmit={save}>
              <header>
                <h2 className={sectionTitleClass}>הגדרות כלליות</h2>
                <p className={sectionHintClass}>פרטי העסק הבסיסיים והזיכרון הקבוע של נטלי.</p>
              </header>
              <div className="grid gap-4 md:grid-cols-2">
                <FormLabel className="grid gap-2">
                  שם העסק הרשמי
                  <Input
                    placeholder="שם העסק הרשמי"
                    value={form.businessName ?? ""}
                    onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                  />
                </FormLabel>
                <FormLabel className="grid gap-2">
                  ח.פ / עוסק מורשה
                  <Input
                    placeholder="ח.פ / עוסק מורשה"
                    value={form.businessId ?? ""}
                    onChange={(e) => setForm({ ...form, businessId: e.target.value })}
                  />
                </FormLabel>
                <FormLabel className="grid gap-2 md:col-span-2">
                  כתובת העסק
                  <Input
                    placeholder="כתובת העסק"
                    value={form.businessAddress ?? ""}
                    onChange={(e) => setForm({ ...form, businessAddress: e.target.value })}
                  />
                </FormLabel>
              </div>
              <section className="grid gap-3 rounded-2xl border border-[#DBE5F4] bg-[#F8FAFF] p-4 dark:border-[#1F2A44] dark:bg-[#0F172A] md:p-5">
                <h3 className={blockTitleClass}>הזיכרון של נטלי</h3>
                <p className="text-sm font-semibold leading-6 text-[var(--natalie-text-muted,#64748B)]">
                  כתבי כאן מידע קבוע על העסק שנטלי תזכור בכל שיחה (למשל: שמות ספקים, כינויים, נהלים).
                </p>
                <Textarea
                  value={businessProfile}
                  onChange={(event) => setBusinessProfile(event.target.value)}
                  rows={6}
                  placeholder="לדוגמה: הספק 'יוסי' הוא יוסי כהן מהדפוס; לקוחות VIP מקבלים מענה באותו יום..."
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" variant="secondary" onClick={saveBusinessProfile}>
                    שמור
                  </Button>
                  {businessProfileMessage ? (
                    <span className="text-sm font-semibold text-[var(--natalie-text-muted,#64748B)]">
                      {businessProfileMessage}
                    </span>
                  ) : null}
                </div>
              </section>
              <div className="flex flex-wrap gap-3 border-t border-[var(--natalie-border,#D9E2F2)] pt-4">
                <Button type="submit">שמור הגדרות כלליות</Button>
              </div>
            </form>
          </Card>
        ) : null}

        {activeTab === "integrations" ? (
          <Card className="grid gap-6 md:p-6">
            <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className={sectionTitleClass}>חיבורים</h2>
                <p className={sectionHintClass}>
                  כאן מחברים את ג׳ימייל, וואטסאפ וחשבונות הסושיאל. בלי ג׳ימייל מחובר סריקת המיילים לא תעבוד.
                </p>
              </div>
              <Button type="button" variant="secondary" onClick={() => router.push("/social")}>
                פתח מודול סושיאל
              </Button>
            </header>

            <div className="grid gap-4 lg:grid-cols-2">
              <GmailIntegrationCard
                connection={gmailConnection}
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

            <div className="grid gap-3">
              <h3 className={blockTitleClass}>חיבורי סושיאל</h3>
              <p className="text-sm font-semibold leading-6 text-[var(--natalie-text-muted,#64748B)]">
                חשבונות סושיאל מחוברים דרך לקוחות במודול הסושיאל.
              </p>
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
          </Card>
        ) : null}

        {activeTab === "greenInvoice" ? (
          <Card className="md:p-6">
            <form className="grid gap-5" onSubmit={connectGreenInvoice}>
              <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#1D4ED8]">חשבונית ירוקה / מורנינג</p>
                  <h2 className={sectionTitleClass}>חיבור חשבונית ירוקה</h2>
                  <p className={sectionHintClass}>
                    חבר את חשבון חשבונית ירוקה כדי לאפשר בהמשך הפקת חשבוניות מתוך המערכת.
                  </p>
                </div>
                <StatusBadge tone={greenInvoiceStatus?.connected ? "success" : "warn"}>
                  {greenInvoiceStatus?.connected ? "מחובר" : "לא מחובר"}
                </StatusBadge>
              </header>

              {greenInvoiceStatus?.connected ? (
                <MessageBanner tone="success">
                  מחובר · סביבה: {greenInvoiceStatus.env === "production" ? "אמיתי" : "בדיקות"}
                  {greenInvoiceStatus.connectedAt ? ` · חובר בתאריך ${new Date(greenInvoiceStatus.connectedAt).toLocaleString("he-IL")}` : ""}
                </MessageBanner>
              ) : null}

              {greenInvoiceMessage ? <MessageBanner tone="success">{greenInvoiceMessage}</MessageBanner> : null}
              {greenInvoiceError ? <MessageBanner tone="error">{greenInvoiceError}</MessageBanner> : null}

              <div className="grid gap-4 md:grid-cols-2">
                <FormLabel className="grid gap-2">
                  מזהה מפתח גישה
                  <Input
                    dir="ltr"
                    placeholder="מזהה מפתח"
                    value={greenInvoiceForm.apiKeyId}
                    onChange={(event) => setGreenInvoiceForm({ ...greenInvoiceForm, apiKeyId: event.target.value })}
                    autoComplete="off"
                  />
                </FormLabel>
                <FormLabel className="grid gap-2">
                  סוד מפתח גישה
                  <Input
                    dir="ltr"
                    type="password"
                    placeholder="סוד מפתח"
                    value={greenInvoiceForm.apiSecret}
                    onChange={(event) => setGreenInvoiceForm({ ...greenInvoiceForm, apiSecret: event.target.value })}
                    autoComplete="new-password"
                  />
                </FormLabel>
                <FormLabel className="grid gap-2">
                  סביבת עבודה
                  <Select
                    value={greenInvoiceForm.env}
                    onChange={(event) => setGreenInvoiceForm({ ...greenInvoiceForm, env: event.target.value as GreenInvoiceEnv })}
                  >
                    <option value="sandbox">בדיקות</option>
                    <option value="production">אמיתי</option>
                  </Select>
                </FormLabel>
              </div>

              <div className="flex flex-wrap gap-3 border-t border-[var(--natalie-border,#D9E2F2)] pt-4">
                <Button type="submit" disabled={greenInvoiceLoading}>
                  {greenInvoiceLoading ? "מחבר..." : "חבר"}
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={testGreenInvoice}
                  disabled={greenInvoiceLoading || !greenInvoiceStatus?.connected}
                >
                  {greenInvoiceLoading ? "בודק..." : "בדוק חיבור"}
                </Button>
              </div>
            </form>
          </Card>
        ) : null}

        {activeTab === "accountant" ? (
          <Card className="md:p-6">
            <form className="grid gap-5" onSubmit={save}>
              <header>
                <h2 className={sectionTitleClass}>רואה חשבון</h2>
                <p className={sectionHintClass}>פרטי רואה החשבון והגדרות הדיווח החודשי.</p>
              </header>
              <div className="grid gap-4 md:grid-cols-2">
                <FormLabel className="grid gap-2">
                  שם רואה החשבון
                  <Input
                    placeholder="שם רואה החשבון"
                    value={form.accountantName ?? ""}
                    onChange={(e) => setForm({ ...form, accountantName: e.target.value })}
                  />
                </FormLabel>
                <FormLabel className="grid gap-2">
                  אימייל רואה החשבון
                  <Input
                    type="email"
                    placeholder="אימייל רואה החשבון"
                    value={form.accountantEmail ?? ""}
                    onChange={(e) => setForm({ ...form, accountantEmail: e.target.value })}
                  />
                </FormLabel>
                <FormLabel className="grid gap-2">
                  תאריך שליחה
                  <Input
                    type="number"
                    min={1}
                    max={28}
                    value={form.reportDay ?? 1}
                    onChange={(e) => setForm({ ...form, reportDay: Number(e.target.value) })}
                  />
                </FormLabel>
              </div>
              <label className={checkboxRowClass}>
                <input
                  className="h-5 w-5 shrink-0 accent-[#1D4ED8]"
                  type="checkbox"
                  checked={form.sendMonthlyReport ?? true}
                  onChange={(e) => setForm({ ...form, sendMonthlyReport: e.target.checked })}
                />
                שלח דוח חודשי
              </label>
              <div className="flex flex-wrap gap-3 border-t border-[var(--natalie-border,#D9E2F2)] pt-4">
                <Button type="submit" disabled={savingAccountant}>
                  {savingAccountant ? "שומר..." : "שמור הגדרות רואה חשבון"}
                </Button>
              </div>
            </form>
          </Card>
        ) : null}

        {activeTab === "whatsapp" ? (
          <Card className="md:p-6">
            <form className="grid gap-6" onSubmit={saveWhatsapp}>
              <header>
                <h2 className={sectionTitleClass}>עוזר וואטסאפ</h2>
                <p className={sectionHintClass}>מספר, שעות שליחה והעדפות הודעות לבעלים וללקוחות.</p>
              </header>

              <section className="grid gap-3">
                <h3 className={blockTitleClass}>מספר הוואטסאפ שלי</h3>
                <FormLabel className="grid gap-2 md:max-w-md">
                  מספר הוואטסאפ שלי
                  <Input
                    dir="ltr"
                    placeholder="+972..."
                    value={whatsapp.ownerPhone}
                    onChange={(e) => setWhatsapp({ ...whatsapp, ownerPhone: e.target.value })}
                  />
                </FormLabel>
              </section>

              <section className="grid gap-4">
                <h3 className={blockTitleClass}>שעת בוקר / שעת שליחה / שעות שקטות</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <FormLabel className="grid gap-2">
                    שעת בוקר
                    <Input
                      type="time"
                      value={whatsapp.ownerMorningTime}
                      onChange={(e) => setWhatsapp({ ...whatsapp, ownerMorningTime: e.target.value })}
                    />
                  </FormLabel>
                  <FormLabel className="grid gap-2">
                    שעת שליחה
                    <Input
                      type="time"
                      value={whatsapp.clientMorningTime}
                      onChange={(e) => setWhatsapp({ ...whatsapp, clientMorningTime: e.target.value })}
                    />
                  </FormLabel>
                  <FormLabel className="grid gap-2">
                    שעות שקטות - אל תשלח אחרי
                    <Input
                      type="time"
                      value={whatsapp.quietHoursStart}
                      onChange={(e) => setWhatsapp({ ...whatsapp, quietHoursStart: e.target.value })}
                    />
                  </FormLabel>
                  <FormLabel className="grid gap-2">
                    שעות שקטות - אל תשלח לפני
                    <Input
                      type="time"
                      value={whatsapp.quietHoursEnd}
                      onChange={(e) => setWhatsapp({ ...whatsapp, quietHoursEnd: e.target.value })}
                    />
                  </FormLabel>
                </div>
              </section>

              <section className="grid gap-3">
                <h3 className={blockTitleClass}>הגדרות בעלים</h3>
                <div className="grid gap-3">
                  <label className={checkboxRowClass}>
                    <input
                      className="h-5 w-5 shrink-0 accent-[#1D4ED8]"
                      type="checkbox"
                      checked={whatsapp.isActive}
                      onChange={(e) => setWhatsapp({ ...whatsapp, isActive: e.target.checked })}
                    />
                    עוזר וואטסאפ פעיל
                  </label>
                  <label className={checkboxRowClass}>
                    <input
                      className="h-5 w-5 shrink-0 accent-[#1D4ED8]"
                      type="checkbox"
                      checked={whatsapp.ownerMorningReport}
                      onChange={(e) => setWhatsapp({ ...whatsapp, ownerMorningReport: e.target.checked })}
                    />
                    שלח לי דוח בוקר יומי
                  </label>
                  <label className={checkboxRowClass}>
                    <input
                      className="h-5 w-5 shrink-0 accent-[#1D4ED8]"
                      type="checkbox"
                      checked={whatsapp.ownerCriticalAlerts}
                      onChange={(e) => setWhatsapp({ ...whatsapp, ownerCriticalAlerts: e.target.checked })}
                    />
                    קבל התראות דחופות
                  </label>
                </div>
              </section>

              <section className="grid gap-4">
                <h3 className={blockTitleClass}>הגדרות ללקוחות</h3>
                <label className={checkboxRowClass}>
                  <input
                    className="h-5 w-5 shrink-0 accent-[#1D4ED8]"
                    type="checkbox"
                    checked={whatsapp.clientMorningSummary}
                    onChange={(e) => setWhatsapp({ ...whatsapp, clientMorningSummary: e.target.checked })}
                  />
                  שלח ללקוחות סיכום בוקר
                </label>
                <div className="grid gap-4 md:grid-cols-2">
                  <FormLabel className="grid gap-2">
                    שליחת תזכורת תשלום אחרי מספר ימים
                    <Input
                      type="number"
                      min={1}
                      max={60}
                      value={whatsapp.clientPaymentDaysWait}
                      onChange={(e) => setWhatsapp({ ...whatsapp, clientPaymentDaysWait: Number(e.target.value) })}
                    />
                  </FormLabel>
                  <FormLabel className="grid gap-2">
                    מקסימום הודעות ביום ללקוח
                    <Input
                      type="number"
                      min={1}
                      max={3}
                      value={whatsapp.maxMessagesPerDay}
                      onChange={(e) => setWhatsapp({ ...whatsapp, maxMessagesPerDay: Number(e.target.value) })}
                    />
                  </FormLabel>
                </div>
                <label className={checkboxRowClass}>
                  <input
                    className="h-5 w-5 shrink-0 accent-[#1D4ED8]"
                    type="checkbox"
                    checked={whatsapp.clientPaymentReminder}
                    onChange={(e) => setWhatsapp({ ...whatsapp, clientPaymentReminder: e.target.checked })}
                  />
                  שלח תזכורות תשלום
                </label>
                <label className={checkboxRowClass}>
                  <input
                    className="h-5 w-5 shrink-0 accent-[#1D4ED8]"
                    type="checkbox"
                    checked={whatsapp.clientInvoiceFound}
                    onChange={(e) => setWhatsapp({ ...whatsapp, clientInvoiceFound: e.target.checked })}
                  />
                  עדכן לקוח כשנמצאה חשבונית
                </label>
                <label className={checkboxRowClass}>
                  <input
                    className="h-5 w-5 shrink-0 accent-[#1D4ED8]"
                    type="checkbox"
                    checked={whatsapp.clientUrgentOnly}
                    onChange={(e) => setWhatsapp({ ...whatsapp, clientUrgentOnly: e.target.checked })}
                  />
                  לשלוח רק הודעות דחופות
                </label>
              </section>

              <div className="flex flex-wrap gap-3 border-t border-[var(--natalie-border,#D9E2F2)] pt-4">
                <Button type="submit" disabled={savingWhatsapp}>
                  {savingWhatsapp ? "שומר..." : "שמור הגדרות וואטסאפ"}
                </Button>
                <Button variant="secondary" type="button" onClick={() => testWhatsapp("morning")}>
                  שלח דוח בוקר לעצמי עכשיו
                </Button>
                <Button variant="secondary" type="button" onClick={() => testWhatsapp("number")}>
                  בדוק שהמספר עובד
                </Button>
              </div>
            </form>
          </Card>
        ) : null}

        {activeTab === "notifications" ? (
          <Card className="md:p-6">
            <form className="grid gap-5" onSubmit={saveWhatsapp}>
              <header>
                <h2 className={sectionTitleClass}>התראות</h2>
                <p className={sectionHintClass}>מתי לא לשלוח התראות אוטומטיות.</p>
              </header>
              <div className="grid gap-3">
                <label className={checkboxRowClass}>
                  <input
                    className="h-5 w-5 shrink-0 accent-[#1D4ED8]"
                    type="checkbox"
                    checked={whatsapp.noMessagesOnSaturday}
                    onChange={(e) => setWhatsapp({ ...whatsapp, noMessagesOnSaturday: e.target.checked })}
                  />
                  לא לשלוח התראות בשבת
                </label>
                <label className={checkboxRowClass}>
                  <input
                    className="h-5 w-5 shrink-0 accent-[#1D4ED8]"
                    type="checkbox"
                    checked={whatsapp.noMessagesOnHolidays}
                    onChange={(e) => setWhatsapp({ ...whatsapp, noMessagesOnHolidays: e.target.checked })}
                  />
                  לא לשלוח התראות בחגים
                </label>
              </div>
              <div className="flex flex-wrap gap-3 border-t border-[var(--natalie-border,#D9E2F2)] pt-4">
                <Button type="submit">שמור הגדרות התראות</Button>
              </div>
            </form>
          </Card>
        ) : null}
      </div>
    </AppShell>
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
    <article className="flex h-full flex-col gap-4 rounded-2xl border border-[#DBE5F4] bg-[#F8FAFF] p-4 dark:border-[#1F2A44] dark:bg-[#0F172A] md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-black text-[var(--natalie-text-primary,#0F172A)]">{title}</h3>
          <p className="mt-1 text-sm font-semibold leading-6 text-[var(--natalie-text-muted,#64748B)]">{description}</p>
        </div>
        <StatusBadge tone={connected ? "success" : "warn"}>{status}</StatusBadge>
      </div>
      {meta ? (
        <p className="break-words text-sm font-semibold text-[var(--natalie-text-muted,#64748B)]">{meta}</p>
      ) : null}
      <div className="mt-auto pt-1">
        <Button type="button" variant="secondary" onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </article>
  );
}

function GmailIntegrationCard({
  connection,
  status,
  onConnect,
  onDisconnect,
}: {
  connection: GmailConnectionStateModel;
  status: GmailStatus | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const connected = connection.treatAsConnectedForUi;
  const badgeTone =
    connection.state === "ReconnectRequired"
      ? "warn"
      : connected
        ? "success"
        : "warn";
  return (
    <article className="flex h-full flex-col gap-4 rounded-2xl border border-[#DBE5F4] bg-[#F8FAFF] p-4 dark:border-[#1F2A44] dark:bg-[#0F172A] md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-black text-[var(--natalie-text-primary,#0F172A)]">ג׳ימייל</h3>
          <p className="mt-1 text-sm font-semibold leading-6 text-[var(--natalie-text-muted,#64748B)]">
            חובה לסריקת מיילים, יצירת לידים, זיהוי ספקים וחשבוניות.
          </p>
        </div>
        <StatusBadge tone={badgeTone}>
          {gmailConnectionBadgeLabel(connection, { googleConfigured: status?.googleConfigured })}
        </StatusBadge>
      </div>
      {connection.state === "ReconnectRequired" ? (
        <p className="text-sm font-semibold text-[#92400E] dark:text-[#FCD34D]">
          נדרש חיבור מחדש ל-Gmail כדי לשמור על סנכרון אמין.
        </p>
      ) : null}
      <p className="break-words text-sm font-semibold text-[var(--natalie-text-muted,#64748B)]">
        {connected && status?.connectedAt
          ? `חובר בתאריך ${new Date(status.connectedAt).toLocaleString("he-IL")}`
          : "כפתור החיבור מעביר אותך לאישור גוגל כדי לאפשר סריקת מיילים."}
      </p>
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {connected ? (
          <>
            <Button type="button" variant="secondary" onClick={onConnect}>
              {gmailReconnectActionLabel(connection)}
            </Button>
            <Button type="button" variant="danger" onClick={onDisconnect}>
              נתק ג׳ימייל
            </Button>
          </>
        ) : connection.state === "Disconnected" ? (
          <Button type="button" className="min-h-[56px] w-full" onClick={onConnect}>
            חבר ג׳ימייל
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function platformLabel(platform: string) {
  if (platform === "instagram") return "אינסטגרם";
  if (platform === "facebook") return "פייסבוק";
  if (platform === "linkedin") return "לינקדאין";
  return "סושיאל";
}
