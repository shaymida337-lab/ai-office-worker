import type { NatalieBriefingItem } from "@/lib/natalie/types";

export type NataliePendingListProps = {
  items: NatalieBriefingItem[];
  title?: string;
  className?: string;
};

export function NataliePendingList({
  items,
  title = "מה שעדיין ממתין להחלטה שלך:",
  className = "",
}: NataliePendingListProps) {
  if (items.length === 0) return null;

  return (
    <section className={className} aria-label="מה נטלי צריכה ממך" data-natalie-surface="pending-list">
      {title ? <h2>{title}</h2> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>{item.text}</li>
        ))}
      </ul>
    </section>
  );
}
