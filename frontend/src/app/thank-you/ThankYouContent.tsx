"use client";

import Link from "next/link";
import { useEffect } from "react";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { ShareBar } from "@/components/ShareBar";
import { pushToDataLayer } from "@/lib/analytics/data-layer";
import { getReferral } from "@/lib/analytics/referral";
import { utmEventParams } from "@/lib/analytics/utm";
import { colors, radius, shadow } from "@/lib/design-tokens";

const NEXT_STEPS = [
  "נחזור אליכם תוך יום עסקים בטלפון או בוואטסאפ.",
  "נפעיל לכם את הניסיון — 14 יום, בלי כרטיס אשראי.",
  "נלווה אתכם אישית בחיבור Gmail והוואטסאפ (10 דקות).",
];

export function ThankYouContent() {
  useEffect(() => {
    pushToDataLayer({ event: "thank_you_view", ...utmEventParams() });
    // ליד שהגיע מהפניה — אירוע המרה לייחוס "חבר מביא חבר" עתידי (ללא PII)
    const referral = getReferral();
    if (referral.referralSource || referral.referralId) {
      pushToDataLayer({
        event: "referral_conversion",
        referral_source: referral.referralSource ?? undefined,
        referral_id: referral.referralId ?? undefined,
      });
    }
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

        <div className="mt-7 flex flex-col items-center justify-center gap-3">
          <Link href="/natalie" className="btn w-full sm:w-auto">
            <MessageCircle className="ml-2 h-4 w-4" aria-hidden />
            בינתיים — דברו עם נטלי בדמו
          </Link>
        </div>

        <div className="mt-7 border-t pt-6" style={{ borderColor: colors.borderSubtle }}>
          <p className="text-base font-bold" style={{ color: colors.textPrimary }}>
            שיתוף קטן שלך יכול לעזור לעוד בעל עסק 🙌
          </p>
          <p className="mb-4 mt-1 text-sm font-medium" style={{ color: colors.textSecondary }}>
            שתפו עכשיו:
          </p>
          <ShareBar variant="light" />
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
