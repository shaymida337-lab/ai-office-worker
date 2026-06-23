"use client";

import { Sparkles } from "lucide-react";
import { colors, radius, type as typography } from "@/lib/design-tokens";

export function PaymentMorningContext({
  pendingCount,
  loading = false,
  statusMessage,
}: {
  pendingCount: number;
  loading?: boolean;
  statusMessage?: string;
}) {
  return (
    <section
      className={`${radius.lg} border p-6 md:p-8`}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
        boxShadow: "0 10px 40px rgba(15,23,42,0.06)",
        backgroundImage: "linear-gradient(135deg, rgba(29,91,255,0.04) 0%, rgba(255,255,255,0) 55%)",
      }}
      aria-label="סיכום תשלומים"
    >
      <div className="flex items-start gap-4">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
          style={{ backgroundColor: colors.accentSoft, color: colors.accent }}
        >
          <Sparkles className="h-5 w-5" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className={`${typography.h1} leading-tight`} style={{ color: colors.textPrimary }}>
            תשלומים
          </h1>
          {loading ? (
            <p className={`${typography.body} mt-3`} style={{ color: colors.textSecondary }}>
              רגע, אני מסדרת את התשלומים...
            </p>
          ) : (
            <>
              <p className={`${typography.subtitle} mt-3 leading-8`} style={{ color: colors.textPrimary }}>
                {pendingCount === 0
                  ? "סיימתי להכין את כל התשלומים שלך."
                  : "הכנתי עבורך את כל התשלומים."}
              </p>
              <p className={`${typography.body} mt-2 leading-7`} style={{ color: colors.textSecondary }}>
                {pendingCount === 0
                  ? "אין כרגע תשלומים שמחכים לך."
                  : pendingCount === 1
                    ? "אני ממליצה שנתחיל בתשלום אחד שכדאי לסיים."
                    : `אני ממליצה שנתחיל באלו שצריכים לצאת ראשונים — ${pendingCount} ממתינים.`}
              </p>
              {statusMessage && (
                <p className={`${typography.body} mt-3 font-semibold`} style={{ color: colors.successText }}>
                  {statusMessage}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
