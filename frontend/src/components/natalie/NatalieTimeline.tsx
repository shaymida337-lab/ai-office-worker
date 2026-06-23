import type { NatalieTimelineItem } from "@/lib/natalie/types";

export type NatalieTimelineProps = {
  items: NatalieTimelineItem[];
  title?: string;
  className?: string;
};

export function NatalieTimeline({
  items,
  title = "מה עשיתי לאחרונה",
  className = "",
}: NatalieTimelineProps) {
  if (items.length === 0) return null;

  return (
    <section className={className} aria-label={title} data-natalie-surface="timeline">
      <h2>{title}</h2>
      <ol>
        {items.map((item) => (
          <li key={item.id}>
            <span>{item.text}</span>
            {item.occurredAt ? <time dateTime={item.occurredAt}>{item.occurredAt}</time> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
