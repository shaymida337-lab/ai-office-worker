"use client";

import { Sparkles } from "lucide-react";
import { colors, radius, type as typography } from "@/lib/design-tokens";

export function DocumentsMorningContext({
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
      aria-label="סיכום בוקר — מסמכים"
    >
      <div className="flex items-start gap-4">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
          style={{ backgroundColor: "#F3E8FF", color: "#6D28D9" }}
        >
          <Sparkles className="h-5 w-5" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className={`${typography.h1} leading-tight`} style={{ color: colors.textPrimary }}>
            מסמכים
          </h1>
          {loading ? (
            <p className={`${typography.body} mt-3`} style={{ color: colors.textSecondary }}>
              רגע, אני עוברת על המסמכים...
            </p>
          ) : (
            <>
              <p className={`${typography.subtitle} mt-3 leading-8`} style={{ color: colors.textPrimary }}>
                עברתי על כל המסמכים החדשים.
              </p>
              <p className={`${typography.body} mt-2 leading-7`} style={{ color: colors.textSecondary }}>
                {pendingCount === 0
                  ? "כרגע אין שום דבר שמחכה להחלטה שלך."
                  : pendingCount === 1
                    ? "נשאר רק אחד שדורש את ההחלטה שלך."
                    : `נשארו רק ${pendingCount} שדורשים את ההחלטה שלך.`}
              </p>
              {statusMessage && (
                <p
                  className={`${typography.body} mt-3 font-semibold leading-7`}
                  style={{ color: colors.successText }}
                >
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
