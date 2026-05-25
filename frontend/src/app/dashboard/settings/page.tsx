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

  return (
    <div className="container">
      <Nav />
      <div className="mb-8"><div className="page-kicker">Workspace controls</div><h1>הגדרות</h1></div>
      {message && <div className="mb-6 rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4 text-sm text-ink-primary">{message}</div>}
      <form className="card grid gap-3" onSubmit={save}>
        <h2>הגדרות רואה חשבון</h2>
        <input placeholder="שם רואה החשבון" value={form.accountantName ?? ""} onChange={(e) => setForm({ ...form, accountantName: e.target.value })} />
        <input type="email" placeholder="אימייל רואה החשבון" value={form.accountantEmail ?? ""} onChange={(e) => setForm({ ...form, accountantEmail: e.target.value })} />
        <input placeholder="שם העסק הרשמי" value={form.businessName ?? ""} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
        <input placeholder="ח.פ / עוסק מורשה" value={form.businessId ?? ""} onChange={(e) => setForm({ ...form, businessId: e.target.value })} />
        <input placeholder="כתובת העסק" value={form.businessAddress ?? ""} onChange={(e) => setForm({ ...form, businessAddress: e.target.value })} />
        <label>
          <input type="checkbox" checked={form.sendMonthlyReport ?? true} onChange={(e) => setForm({ ...form, sendMonthlyReport: e.target.checked })} />{" "}
          לשלוח דוח חודשי לרואה החשבון
        </label>
        <label>
          תאריך שליחה
          <input type="number" min={1} max={28} value={form.reportDay ?? 1} onChange={(e) => setForm({ ...form, reportDay: Number(e.target.value) })} />
        </label>
        <button className="btn" type="submit">שמור הגדרות</button>
      </form>
      <form className="card grid gap-3" onSubmit={saveWhatsapp}>
        <h2>WhatsApp Assistant</h2>
        <h3>הגדרות בעלים</h3>
        <label>
          מספר WhatsApp שלי
          <input placeholder="whatsapp:+972..." value={whatsapp.ownerPhone} onChange={(e) => setWhatsapp({ ...whatsapp, ownerPhone: e.target.value })} />
        </label>
        <label>
          שעת דוח בוקר
          <input type="time" value={whatsapp.ownerMorningTime} onChange={(e) => setWhatsapp({ ...whatsapp, ownerMorningTime: e.target.value })} />
        </label>
        <label>
          <input type="checkbox" checked={whatsapp.ownerCriticalAlerts} onChange={(e) => setWhatsapp({ ...whatsapp, ownerCriticalAlerts: e.target.checked })} />{" "}
          קבל התראות דחופות
        </label>
        <label>
          <input type="checkbox" checked={whatsapp.ownerMorningReport} onChange={(e) => setWhatsapp({ ...whatsapp, ownerMorningReport: e.target.checked })} />{" "}
          שלח לי דוח בוקר יומי
        </label>

        <h3>הגדרות לקוחות</h3>
        <label>
          <input type="checkbox" checked={whatsapp.clientMorningSummary} onChange={(e) => setWhatsapp({ ...whatsapp, clientMorningSummary: e.target.checked })} />{" "}
          שלח ללקוחות סיכום בוקר
        </label>
        <label>
          שעת שליחה
          <input type="time" value={whatsapp.clientMorningTime} onChange={(e) => setWhatsapp({ ...whatsapp, clientMorningTime: e.target.value })} />
        </label>
        <label>
          תזכורת תשלום אחרי X ימים
          <input type="number" min={1} max={60} value={whatsapp.clientPaymentDaysWait} onChange={(e) => setWhatsapp({ ...whatsapp, clientPaymentDaysWait: Number(e.target.value) })} />
        </label>
        <label>
          מקסימום הודעות ביום ללקוח
          <input type="number" min={1} max={3} value={whatsapp.maxMessagesPerDay} onChange={(e) => setWhatsapp({ ...whatsapp, maxMessagesPerDay: Number(e.target.value) })} />
        </label>
        <label>
          <input type="checkbox" checked={whatsapp.clientPaymentReminder} onChange={(e) => setWhatsapp({ ...whatsapp, clientPaymentReminder: e.target.checked })} />{" "}
          שלח תזכורות תשלום
        </label>

        <h3>שעות שקטות</h3>
        <label>
          אל תשלח אחרי
          <input type="time" value={whatsapp.quietHoursStart} onChange={(e) => setWhatsapp({ ...whatsapp, quietHoursStart: e.target.value })} />
        </label>
        <label>
          אל תשלח לפני
          <input type="time" value={whatsapp.quietHoursEnd} onChange={(e) => setWhatsapp({ ...whatsapp, quietHoursEnd: e.target.value })} />
        </label>
        <label>
          <input type="checkbox" checked={whatsapp.noMessagesOnSaturday} onChange={(e) => setWhatsapp({ ...whatsapp, noMessagesOnSaturday: e.target.checked })} />{" "}
          לא לשלוח בשבת
        </label>
        <div className="flex flex-wrap gap-3">
          <button className="btn" type="submit">שמור WhatsApp Assistant</button>
          <button className="btn btn-secondary" type="button" onClick={() => testWhatsapp("morning")}>
            שלח דוח בוקר לעצמי עכשיו
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => testWhatsapp("number")}>
            בדוק שהמספר עובד
          </button>
        </div>
      </form>
    </div>
  );
}
