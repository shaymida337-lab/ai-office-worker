import type { NatalieBriefingItem } from "@/lib/natalie/types";

export type NatalieDoneListProps = {
  items: NatalieBriefingItem[];
  title?: string;
  className?: string;
};

export function NatalieDoneList({
  items,
  title = "בזמן שהיית מחוץ לעסק:",
  className = "",
}: NatalieDoneListProps) {
  if (items.length === 0) return null;

  return (
    <section className={className} aria-label="מה נטלי כבר עשתה" data-natalie-surface="done-list">
      {title ? <h2>{title}</h2> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>{item.text}</li>
        ))}
      </ul>
    </section>
  );
}
