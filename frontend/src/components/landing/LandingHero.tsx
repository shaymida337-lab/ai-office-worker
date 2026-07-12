import Link from "next/link";
import { NataliePortrait } from "@/components/dashboard/NataliePortrait";
import { LANDING_CHAT_PREVIEW, LANDING_HERO } from "./landingContent";
import { colors, radius, shadow, type as typography } from "@/lib/design-tokens";

function ChatBubble({ from, text }: { from: "natalie" | "user"; text: string }) {
  const isNatalie = from === "natalie";
  return (
    <li className={`flex ${isNatalie ? "justify-start" : "justify-end"}`}>
      <span
        className={`${radius.lg} max-w-[85%] px-3.5 py-2.5 text-sm font-medium leading-6`}
        style={
          isNatalie
            ? { backgroundColor: colors.surface, color: colors.textPrimary, border: `1px solid ${colors.borderSubtle}` }
            : { backgroundColor: colors.accent, color: "#ffffff" }
        }
      >
        {text}
      </span>
    </li>
  );
}

export function LandingHero() {
  return (
    <section className="overflow-x-hidden px-4 pb-10 pt-8 sm:px-6 sm:pb-14 sm:pt-10" aria-label="נטלי — עובדת המשרד שלך">
      <div
        className={`mx-auto max-w-6xl ${radius.card} border ${shadow.soft} overflow-hidden`}
        style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      >
        <div className="grid gap-8 p-5 sm:p-7 md:grid-cols-2 md:items-center md:gap-10 lg:p-8">
          <div className="min-w-0 text-right">
            <p className="page-kicker">{LANDING_HERO.kicker}</p>
            <h1 className={`${typography.h1} mb-0`} style={{ color: colors.textPrimary }}>
              {LANDING_HERO.headline}
            </h1>
            <p className={`mt-4 max-w-xl ${typography.subtitle}`} style={{ color: colors.textSecondary }}>
              {LANDING_HERO.subtitle}
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href={LANDING_HERO.ctaHref} className="btn w-full sm:w-auto">
                {LANDING_HERO.cta}
              </Link>
              <a href={LANDING_HERO.secondaryCtaHref} className="btn btn-secondary w-full sm:w-auto">
                {LANDING_HERO.secondaryCta}
              </a>
            </div>

            <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold" style={{ color: colors.textSecondary }}>
              {LANDING_HERO.trustLine.map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <span style={{ color: colors.successText }} aria-hidden>
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="mx-auto grid w-full max-w-[380px] min-w-0 gap-4 md:mx-0 md:max-w-none">
            <div className="mx-auto w-full max-w-[170px] md:max-w-[200px]">
              <NataliePortrait size="hero" showStatusDot />
            </div>

            <div
              className={`${radius.lg} border p-4`}
              style={{ backgroundColor: colors.accentMuted, borderColor: colors.borderSubtle }}
              aria-label={LANDING_CHAT_PREVIEW.label}
            >
              <p className="mb-3 text-xs font-bold uppercase tracking-wide" style={{ color: colors.accent }}>
                {LANDING_CHAT_PREVIEW.label}
              </p>
              <ul className="grid gap-2">
                {LANDING_CHAT_PREVIEW.messages.slice(0, 3).map((message) => (
                  <ChatBubble key={message.text} from={message.from} text={message.text} />
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
