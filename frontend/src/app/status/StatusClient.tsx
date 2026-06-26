"use client";

import { useEffect, useState } from "react";
import { PublicTrustLayout, TrustSection } from "@/components/trust";
import { API_URL } from "@/lib/api";

type HealthState = "loading" | "ok" | "degraded" | "unknown";

export default function StatusClient() {
  const [health, setHealth] = useState<HealthState>("loading");
  const [checkedAt, setCheckedAt] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
        if (cancelled) return;
        setHealth(res.ok ? "ok" : "degraded");
        setCheckedAt(new Date().toLocaleString("he-IL"));
      } catch {
        if (!cancelled) {
          setHealth("unknown");
          setCheckedAt(new Date().toLocaleString("he-IL"));
        }
      }
    };

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  const statusLabel =
    health === "loading"
      ? "בודקים..."
      : health === "ok"
        ? "השירות פעיל"
        : health === "degraded"
          ? "תקלה חלקית"
          : "לא ניתן לאמת כרגע";

  const statusTone =
    health === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : health === "loading"
        ? "border-slate-200 bg-slate-50 text-slate-700"
        : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <PublicTrustLayout kicker="סטטוס" title="מצב השירות">
      <TrustSection title="סטטוס נוכחי">
        <div className={`rounded-2xl border px-5 py-4 text-center text-lg font-bold ${statusTone}`}>{statusLabel}</div>
        {checkedAt ? <p className="text-center text-sm text-slate-500">נבדק לאחרונה: {checkedAt}</p> : null}
        <p className="text-sm leading-7 text-slate-500">
          בדיקה זו משקפת זמינות בסיסית של שרת ה-API. היא אינה מכסה את כל רכיבי המערכת (Google, תשלומים, סריקות וכו&apos;).
        </p>
      </TrustSection>

      <TrustSection title="בעיות בשירות?">
        <p>
          אם נתקלתם בבעיה, פנו לתמיכה דרך{" "}
          <a href="/contact" className="font-semibold text-blue-700 hover:underline">
            יצירת קשר
          </a>
          .
        </p>
      </TrustSection>
    </PublicTrustLayout>
  );
}
