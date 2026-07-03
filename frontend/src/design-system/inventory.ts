/**
 * Natalie Design System — component inventory & migration manifest.
 * Sprint 15 foundation — presentation layer only.
 */

export const componentInventory = {
  /** Existing UI primitives — migrate to DS patterns */
  existing: [
    { name: "EmptyState", path: "components/ui/EmptyState.tsx", dsPattern: "emptyStatePatterns", priority: "high" },
    { name: "KpiCard", path: "components/ui/KpiCard.tsx", dsPattern: "cardPatterns.summary", priority: "medium" },
    { name: "StatusPill", path: "components/ui/StatusPill.tsx", dsPattern: "badgePatterns", priority: "high" },
    { name: "ScanBanner", path: "components/ui/ScanBanner.tsx", dsPattern: "toastPatterns + loadingPatterns", priority: "medium" },
    { name: "PageHeader", path: "components/ui/PageHeader.tsx", dsPattern: "navigationPatterns", priority: "low" },
  ],
  /** Natalie employee surfaces */
  natalie: [
    { name: "NatalieBriefing", path: "components/natalie/NatalieBriefing.tsx", dsPattern: "cardPatterns.employee", priority: "high" },
    { name: "NatalieTimeline", path: "components/natalie/NatalieTimeline.tsx", dsPattern: "listPatterns", priority: "medium" },
    { name: "NatalieConversationStrip", path: "components/natalie/NatalieConversationStrip.tsx", dsPattern: "formPatterns", priority: "medium" },
    { name: "NataliePrimaryAction", path: "components/natalie/NataliePrimaryAction.tsx", dsPattern: "buttonPatterns.primary", priority: "high" },
  ],
  /** Dashboard-specific — migrate to DS cards/lists */
  dashboard: [
    { name: "DashboardHero", path: "components/dashboard/DashboardHero.tsx", dsPattern: "cardPatterns.employee", priority: "high" },
    { name: "NatalieRecommendationCard", path: "components/dashboard/NatalieRecommendationCard.tsx", dsPattern: "cardPatterns.decision", priority: "high" },
    { name: "PriorityInboxItem", path: "components/dashboard/PriorityInboxItem.tsx", dsPattern: "cardPatterns.decision + listPatterns", priority: "high" },
    { name: "DashboardQuickActions", path: "components/dashboard/DashboardQuickActions.tsx", dsPattern: "buttonPatterns.ghost", priority: "medium" },
    { name: "DashboardQuietSummary", path: "components/dashboard/DashboardQuietSummary.tsx", dsPattern: "cardPatterns.summary", priority: "low" },
  ],
  /** App shell */
  shell: [
    { name: "Nav", path: "components/Nav.tsx", dsPattern: "navigationPatterns", priority: "high" },
    { name: "NatalieAssistantWidget", path: "components/NatalieAssistantWidget.tsx", dsPattern: "sheetPatterns + overlays", priority: "medium" },
  ],
  /** Planned DS primitives (not yet implemented as React components) */
  planned: [
    "Button",
    "IconButton",
    "Input",
    "Textarea",
    "Select",
    "Checkbox",
    "Radio",
    "Switch",
    "Dialog",
    "Sheet",
    "Toast",
    "Table",
    "Skeleton",
    "Card",
    "ListRow",
  ],
} as const;

export type MigrationPriority = "high" | "medium" | "low";

export function migrationQueue() {
  return [...componentInventory.existing, ...componentInventory.natalie, ...componentInventory.dashboard, ...componentInventory.shell].sort(
    (a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority];
    }
  );
}
