import { CheckCircle2 } from "lucide-react";
import type { NatalieBriefingItem } from "@/lib/natalie/types";
import { colors, radius, button, type } from "@/lib/design-tokens";

export function DashboardHero({
  greeting,
  doneItems,
  pendingSentence,
  ctaLabel,
  loading = false,
  showCta = true,
  onPrimaryAction,
}: {
  greeting: string;
  doneItems: NatalieBriefingItem[];
  pendingSentence: string;
  ctaLabel: string;
  loading?: boolean;
  showCta?: boolean;
  onPrimaryAction: () => void;
}) {
  const visibleDone = doneItems.slice(0, 3);

  return (
    <section className="py-2 md:py-4" aria-label="תקציר בוקר עם נטלי">
      <h1 className={`${type.h1} leading-tight`} style={{ color: colors.textPrimary }}>
        {greeting} 👋
      </h1>

      {visibleDone.length > 0 && (
        <div className="mt-6">
          <p className={`${type.body} mb-3`} style={{ color: colors.textSecondary }}>
            בזמן שלא היית:
          </p>
          <ul className="grid gap-2">
            {visibleDone.map((item) => (
              <li key={item.id} className="flex items-start gap-2.5">
                <CheckCircle2
                  className="mt-1 h-4 w-4 shrink-0"
                  style={{ color: colors.successText }}
                  strokeWidth={2.5}
                />
                <span className={`${type.body} leading-7`} style={{ color: colors.textPrimary }}>
                  {item.text.endsWith(".") ? item.text : `${item.text}.`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className={`${type.subtitle} mt-6 leading-8`} style={{ color: colors.textPrimary }}>
        {loading ? "רגע, אני מסכמת את היום..." : pendingSentence}
      </p>

      {showCta && !loading && (
        <button
          type="button"
          onClick={onPrimaryAction}
          className={`${radius.control} ${button.primary} mt-6 w-full sm:w-auto sm:min-w-[240px]`}
          style={{
            backgroundColor: colors.accent,
            border: `1px solid ${colors.accent}`,
            color: colors.surface,
          }}
        >
          {ctaLabel}
        </button>
      )}
    </section>
  );
}
