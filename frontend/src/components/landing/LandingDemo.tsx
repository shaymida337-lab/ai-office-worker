import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { LANDING_CHAT_PREVIEW, LANDING_DEMO } from "./landingContent";
import { colors, radius, shadow, type as typography } from "@/lib/design-tokens";

export function LandingDemoSection() {
  return (
    <section id="demo" className="overflow-x-hidden px-4 py-12 sm:px-6 sm:py-16" aria-label="דמו חי של נטלי">
      <div className="mx-auto max-w-6xl">
        <div
          className={`${radius.card} border ${shadow.soft} grid gap-8 overflow-hidden p-5 sm:p-7 lg:grid-cols-2 lg:items-center lg:gap-10 lg:p-8`}
          style={{ backgroundColor: colors.accentMuted, borderColor: colors.borderSubtle }}
        >
          <div className="min-w-0 text-right">
            <p className="page-kicker">{LANDING_DEMO.kicker}</p>
            <h2 className={`${typography.h2} mb-3`} style={{ color: colors.textPrimary }}>
              {LANDING_DEMO.title}
            </h2>
            <p className="max-w-xl text-base font-medium leading-7" style={{ color: colors.textSecondary }}>
              {LANDING_DEMO.lead}
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href={LANDING_DEMO.ctaHref} className="btn w-full sm:w-auto">
                <MessageCircle className="ml-2 h-4 w-4" aria-hidden />
                {LANDING_DEMO.cta}
              </Link>
              <p className="text-sm font-semibold" style={{ color: colors.textMuted }}>
                {LANDING_DEMO.note}
              </p>
            </div>
          </div>

          <div
            className={`${radius.lg} border p-4 sm:p-5`}
            style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
            aria-label={LANDING_CHAT_PREVIEW.label}
          >
            <div className="mb-3 flex items-center gap-2 border-b pb-3" style={{ borderColor: colors.borderSubtle }}>
              <span
                className="grid h-8 w-8 place-items-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: colors.accent }}
                aria-hidden
              >
                נ
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold leading-tight" style={{ color: colors.textPrimary }}>
                  נטלי
                </p>
                <p className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: colors.successText }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colors.successText }} aria-hidden />
                  פעילה עכשיו
                </p>
              </div>
              <span
                className={`${radius.pill} mr-auto border px-2.5 py-1 text-[11px] font-bold`}
                style={{ borderColor: colors.borderSubtle, color: colors.textMuted }}
              >
                {LANDING_CHAT_PREVIEW.label}
              </span>
            </div>
            <ul className="grid gap-2.5">
              {LANDING_CHAT_PREVIEW.messages.map((message) => {
                const isNatalie = message.from === "natalie";
                return (
                  <li key={message.text} className={`flex ${isNatalie ? "justify-start" : "justify-end"}`}>
                    <span
                      className={`${radius.lg} max-w-[85%] px-3.5 py-2.5 text-sm font-medium leading-6`}
                      style={
                        isNatalie
                          ? {
                              backgroundColor: colors.accentMuted,
                              color: colors.textPrimary,
                              border: `1px solid ${colors.borderSubtle}`,
                            }
                          : { backgroundColor: colors.accent, color: "#ffffff" }
                      }
                    >
                      {message.text}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
