import type { NatalieBriefing } from "@/lib/natalie/types";
import { NatalieDoneList } from "./NatalieDoneList";
import { NataliePendingList } from "./NataliePendingList";

export type NatalieBriefingProps = {
  briefing: NatalieBriefing;
  className?: string;
};

/** Presentation shell for Natalie's morning briefing. Visual styling deferred to later phases. */
export function NatalieBriefing({ briefing, className = "" }: NatalieBriefingProps) {
  return (
    <section className={className} aria-label="תקציר מנטלי" data-natalie-surface="briefing">
      <header>
        <h1>{briefing.greeting}</h1>
        <p>{briefing.summary}</p>
      </header>
      {briefing.completedItems.length > 0 && <NatalieDoneList items={briefing.completedItems} />}
      {briefing.pendingItems.length > 0 && <NataliePendingList items={briefing.pendingItems} />}
    </section>
  );
}

export { NatalieDoneList } from "./NatalieDoneList";
export { NataliePendingList } from "./NataliePendingList";
export { NataliePrimaryAction } from "./NataliePrimaryAction";
export { NatalieConversationStrip } from "./NatalieConversationStrip";
export { NataliePresence } from "./NataliePresence";
export { NatalieTimeline } from "./NatalieTimeline";
export { NatalieQuietSummary } from "./NatalieQuietSummary";
