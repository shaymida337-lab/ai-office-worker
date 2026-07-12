"use client";

import Link from "next/link";
import { useEffect } from "react";
import { CheckCircle2, MessageCircle, Share2 } from "lucide-react";
import { pushToDataLayer } from "@/lib/analytics/data-layer";
import { utmEventParams } from "@/lib/analytics/utm";
import { colors, radius, shadow } from "@/lib/design-tokens";

const SHARE_TEXT = encodeURIComponent(
  "תכירו את נטלי — עובדת משרד דיגיטלית לעסקים קטנים. שווה להציץ: https://ai-office-worker.com"
);

const NEXT_STEPS = [
  "נחזור אליכם תוך יום עסקים בטלפון או בוואטסאפ.",
  "נפעיל לכם את הניסיון — 14 יום, בלי כרטיס אשראי.",
  "נלווה אתכם אישית בחיבור Gmail והוואטסאפ (10 דקות).",
];

export function ThankYouContent() {
  useEffect(() => {
    pushToDataLayer({ event: "thank_you_view", ...utmEventParams() });
  }, []);

  return (
    <main
      dir="rtl"
      className="flex min-h-[100dvh] flex-col items-center justify-center px-4 py-14"
      style={{ backgroundColor: colors.bg }}
    >
      <div
        className={`${radius.card} border ${shadow.card} w-full max-w-xl p-7 text-center sm:p-9`}
        style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      >
        <CheckCircle2 className="mx-auto h-14 w-14" style={{ color: colors.successText }} aria-hidden />
        <h1 className="mt-4 text-2xl font-extrabold sm:text-3xl" style={{ color: colors.textPrimary }}>
          הפרטים התקבלו — נטלי בדרך אליכם
        </h1>
        <p className="mt-2 text-base font-medium leading-7" style={{ color: colors.textSecondary }}>
          תודה! קיבלנו את הפרטים ושמרנו לכם מקום.
        </p>

        <ol className="mx-auto mt-6 grid max-w-md gap-2.5 text-right">
          {NEXT_STEPS.map((step, index) => (
            <li key={step} className="flex items-start gap-2.5 text-sm font-medium leading-6" style={{ color: colors.textSecondary }}>
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: colors.accent }}
                aria-hidden
              >
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>

        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/natalie" className="btn w-full sm:w-auto">
            <MessageCircle className="ml-2 h-4 w-4" aria-hidden />
            בינתיים — דברו עם נטלי בדמו
          </Link>
          <a
            href={`https://wa.me/?text=${SHARE_TEXT}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => pushToDataLayer({ event: "referral_share", channel: "whatsapp" })}
            className="btn btn-secondary w-full sm:w-auto"
          >
            <Share2 className="ml-2 h-4 w-4" aria-hidden />
            לשתף את נטלי בוואטסאפ
          </a>
        </div>

        <p className="mt-6 text-sm font-medium" style={{ color: colors.textMuted }}>
          <Link href="/" className="underline-offset-4 hover:underline" style={{ color: colors.accent }}>
            חזרה לדף הבית
          </Link>
        </p>
      </div>
    </main>
  );
}
