import type { NatalieQuietSummaryChip } from "@/lib/natalie/types";
import { colors, type } from "@/lib/design-tokens";

export function DashboardQuietSummary({ chips }: { chips: NatalieQuietSummaryChip[] }) {
  if (chips.length === 0) return null;

  return (
    <section className="flex flex-wrap gap-x-5 gap-y-2 py-2" aria-label="סיכום שקט">
      {chips.map((chip) => (
        <span key={chip.id} className={`inline-flex items-center gap-1.5 ${type.caption}`} style={{ color: colors.textMuted }}>
          <span aria-hidden>✔</span>
          <span>{chip.value}</span>
          <span>{chip.label}</span>
        </span>
      ))}
    </section>
  );
}
