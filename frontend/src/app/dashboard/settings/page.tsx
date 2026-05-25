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

export default function SettingsPage() {
  const [form, setForm] = useState<AccountantSettings>({ sendMonthlyReport: true, reportDay: 1 });
  const [message, setMessage] = useState("");

  useEffect(() => {
    apiFetch<AccountantSettings>("/api/accountant/settings")
      .then(setForm)
      .catch((err) => setMessage(err instanceof Error ? err.message : "טעינת הגדרות נכשלה"));
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

  return (
    <div className="container">
      <h1>הגדרות</h1>
      <Nav />
      {message && <p>{message}</p>}
      <form className="card" onSubmit={save} style={{ display: "grid", gap: "0.75rem" }}>
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
    </div>
  );
}
