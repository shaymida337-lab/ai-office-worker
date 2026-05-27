"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";

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

type SettingsTab = "general" | "accountant" | "whatsapp" | "notifications";

export default function SettingsPage() {
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
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  useEffect(() => {
    apiFetch<AccountantSettings>("/api/accountant/settings")
      .then(setForm)
      .catch((err) => setMessage(err instanceof Error ? err.message : "טעינת הגדרות נכשלה"));
    apiFetch<WhatsAppAssistantSettings>("/api/whatsapp-assistant/settings")
      .then(setWhatsapp)
      .catch(() => undefined);
  }, []);

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
      setMessage("הגדרות WhatsApp Assistant נשמרו");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שמירת הגדרות WhatsApp נכשלה");
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

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: "general", label: "הגדרות כלליות" },
    { id: "accountant", label: "רואה חשבון" },
    { id: "whatsapp", label: "WhatsApp Assistant" },
    { id: "notifications", label: "התראות" },
  ];

  return (
    <div className="container">
      <Nav />
      <div className="mb-8"><div className="page-kicker">Workspace controls</div><h1>הגדרות</h1></div>
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
            שלוח דוח חודשי
          </label>
          <button className="btn" type="submit">שמור הגדרות רואה חשבון</button>
        </form>
      )}

      {activeTab === "whatsapp" && (
        <form className="card grid gap-5" onSubmit={saveWhatsapp}>
          <h2>WhatsApp Assistant</h2>
          <section className="grid gap-3">
            <h3 className="text-lg font-semibold text-ink-primary">מספר WhatsApp שלי</h3>
            <label>
              מספר WhatsApp שלי
              <input dir="ltr" placeholder="whatsapp:+972..." value={whatsapp.ownerPhone} onChange={(e) => setWhatsapp({ ...whatsapp, ownerPhone: e.target.value })} />
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
              WhatsApp Assistant פעיל
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
              תזכורת תשלום אחרי X ימים
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
            <button className="btn" type="submit">שמור הגדרות WhatsApp</button>
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
