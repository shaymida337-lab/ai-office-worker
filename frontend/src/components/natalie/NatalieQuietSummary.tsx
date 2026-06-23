import type { NatalieQuietSummaryChip } from "@/lib/natalie/types";

export type NatalieQuietSummaryProps = {
  chips: NatalieQuietSummaryChip[];
  className?: string;
};

export function NatalieQuietSummary({ chips, className = "" }: NatalieQuietSummaryProps) {
  if (chips.length === 0) return null;

  return (
    <section className={className} aria-label="סיכום שקט" data-natalie-surface="quiet-summary">
      <ul>
        {chips.map((chip) => (
          <li key={chip.id}>
            <span>{chip.label}</span>
            <strong>{chip.value}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
