"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Bell } from "lucide-react";
import { useLeadAdminSummary } from "@/hooks/useLeadAdminSummary";

/** צליל עדין (WebAudio) — בלי קובץ, בלי תלות. נכשל בשקט אם הדפדפן חוסם. */
function playGentleChime() {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    for (const [freq, start] of [[880, 0], [1174.66, 0.12]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.06, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + 0.55);
    }
    window.setTimeout(() => void ctx.close(), 1200);
  } catch {
    /* autoplay חסום — הבאדג' עדיין מציג */
  }
}

/**
 * פעמון לידים — מוצג רק לאדמין פלטפורמה (כל השאר מקבלים null בשקט).
 * מונה אדום של לידים בסטטוס new + צליל עדין כשנכנס ליד חדש.
 * compact — גרסת כותרת עליונה (אייקון+מונה); ברירת מחדל — כפתור מלא לתפריט.
 */
export function AdminLeadsBell({ compact = false }: { compact?: boolean }) {
  const { summary, isAdmin, hasNewSince, ackNewSince } = useLeadAdminSummary();

  useEffect(() => {
    if (hasNewSince) {
      playGentleChime();
      ackNewSince();
    }
  }, [hasNewSince, ackNewSince]);

  if (!isAdmin || !summary) return null;

  if (compact) {
    return (
      <Link
        href="/admin/leads"
        aria-label={`לידים חדשים: ${summary.newCount}`}
        className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#e6eaf2] bg-white text-[#1d5bff] transition hover:bg-[#eaf0ff]"
        data-testid="admin-leads-bell"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {summary.newCount > 0 ? (
          <span
            className="absolute -left-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#e02f44] px-1 text-[11px] font-extrabold text-white"
            data-testid="admin-leads-count"
          >
            {summary.newCount > 99 ? "99+" : summary.newCount}
          </span>
        ) : null}
      </Link>
    );
  }

  return (
    <Link
      href="/admin/leads"
      aria-label={`לידים חדשים: ${summary.newCount}`}
      className="relative mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#e6eaf2] bg-white px-4 py-2.5 text-[14px] font-bold text-[#0f1830] transition hover:bg-[#eaf0ff]"
      data-testid="admin-leads-bell"
    >
      <Bell className="h-4 w-4 text-[#1d5bff]" aria-hidden />
      לידים
      {summary.newCount > 0 ? (
        <span
          className="absolute -left-1.5 -top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-[#e02f44] px-1.5 text-xs font-extrabold text-white shadow-[0_4px_12px_rgba(224,47,68,0.4)]"
          data-testid="admin-leads-count"
        >
          {summary.newCount > 99 ? "99+" : summary.newCount}
        </span>
      ) : null}
    </Link>
  );
}
