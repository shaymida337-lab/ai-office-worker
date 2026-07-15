import type { DashboardHomeMetricSnapshot } from "./homeMetrics";
import type {
  BusinessModuleConfig,
  HomeCardConfig,
  HomeMetricId,
} from "@/lib/business-module";
import { DASHBOARD_NO_DATA_LABEL, formatDashboardMetricValue } from "./homeMetrics";

export type InsuranceHomeMetricValues = DashboardHomeMetricSnapshot;

export type InsuranceHomeResolvedCard = HomeCardConfig & {
  displayValue: string;
  clickable: boolean;
};

export type InsuranceHomeOverlayView = {
  greetingLine: string;
  summaryLines: string[];
  summaryParagraph: string;
  cards: InsuranceHomeResolvedCard[];
};

export function resolveInsuranceHomeMetrics(input: {
  homeMetrics: DashboardHomeMetricSnapshot | null;
  metricsLoaded: boolean;
}): DashboardHomeMetricSnapshot {
  if (!input.metricsLoaded || !input.homeMetrics) {
    return {
      active_clients: null,
      open_tasks: null,
      meetings_today: null,
      pending_docs: null,
      new_clients_month: null,
    };
  }
  return input.homeMetrics;
}

function metricLabelLine(
  id: HomeMetricId,
  value: number | null,
  entityPlural: string
): string | null {
  if (value == null) return null;
  switch (id) {
    case "meetings_today":
      return value === 0 ? "אין פגישות היום" : `יש ${value} פגישות היום`;
    case "open_tasks":
      return value === 0 ? "אין משימות פתוחות" : `יש ${value} משימות פתוחות`;
    case "pending_docs":
      return value === 0
        ? "אין מסמכים שממתינים לטיפול"
        : `יש ${value} מסמכים שממתינים לטיפול`;
    case "new_clients_month":
      return value === 0 ? "אין לידים חדשים" : `יש ${value} לידים חדשים`;
    default:
      return null;
  }
}

export function buildInsuranceHomeOverlay(input: {
  module: BusinessModuleConfig;
  metrics: DashboardHomeMetricSnapshot;
  metricsLoaded: boolean;
  partOfDayGreeting: string;
}): InsuranceHomeOverlayView {
  const home = input.module.dashboard.home;
  const cards: InsuranceHomeResolvedCard[] = home.cards.map((card) => {
    if (card.valueKind === "placeholder") {
      return {
        ...card,
        displayValue: card.placeholderText ?? DASHBOARD_NO_DATA_LABEL,
        clickable: false,
      };
    }
    const value = input.metrics[card.id as keyof DashboardHomeMetricSnapshot] ?? null;
    return {
      ...card,
      displayValue: formatDashboardMetricValue(value, !input.metricsLoaded),
      clickable: Boolean(card.href),
    };
  });

  const summaryLines = home.summaryMetricIds
    .map((id) => {
      if (id === "renewals_placeholder") return null;
      const value = input.metrics[id as keyof DashboardHomeMetricSnapshot] ?? null;
      return metricLabelLine(id, value, input.module.crm.entityPlural);
    })
    .filter((line): line is string => Boolean(line));

  const greetingLine = input.partOfDayGreeting
    ? `${input.partOfDayGreeting}. ${home.greetingLine}`.trim()
    : home.greetingLine;

  const pending = input.metrics.pending_docs;
  const tasks = input.metrics.open_tasks;
  const meetings = input.metrics.meetings_today;
  const newClients = input.metrics.new_clients_month;

  const priority =
    pending != null && pending > 0
      ? metricLabelLine("pending_docs", pending, input.module.crm.entityPlural)
      : tasks != null && tasks > 0
        ? metricLabelLine("open_tasks", tasks, input.module.crm.entityPlural)
        : meetings != null && meetings > 0
          ? metricLabelLine("meetings_today", meetings, input.module.crm.entityPlural)
          : newClients != null && newClients > 0
            ? metricLabelLine("new_clients_month", newClients, input.module.crm.entityPlural)
            : input.metricsLoaded
              ? "סוכנות הביטוח שלך מסודרת להיום."
              : DASHBOARD_NO_DATA_LABEL;

  return {
    greetingLine,
    summaryLines,
    summaryParagraph: priority ?? DASHBOARD_NO_DATA_LABEL,
    cards,
  };
}
