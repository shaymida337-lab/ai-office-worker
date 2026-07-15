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

/** Hero / summary copy from home-metrics only — no alternate counts. */
function metricLabelLine(
  id: HomeMetricId,
  value: number | null,
  metricsLoaded: boolean
): string {
  if (!metricsLoaded) return "—";
  if (value == null || !Number.isFinite(value)) return DASHBOARD_NO_DATA_LABEL;
  switch (id) {
    case "active_clients":
      return value === 0 ? "אין מבוטחים פעילים" : `יש ${value} מבוטחים פעילים`;
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
    case "renewals_placeholder":
      return DASHBOARD_NO_DATA_LABEL;
    default:
      return DASHBOARD_NO_DATA_LABEL;
  }
}

function summaryParagraphFromHomeMetrics(
  metrics: DashboardHomeMetricSnapshot,
  metricsLoaded: boolean
): string {
  if (!metricsLoaded) return "—";
  const pending = metrics.pending_docs;
  const tasks = metrics.open_tasks;
  const meetings = metrics.meetings_today;
  const newClients = metrics.new_clients_month;
  const active = metrics.active_clients;

  // Payload missing / unreliable → never invent a calm status line.
  if (
    pending == null &&
    tasks == null &&
    meetings == null &&
    newClients == null &&
    active == null
  ) {
    return DASHBOARD_NO_DATA_LABEL;
  }

  if (pending != null && pending > 0) return metricLabelLine("pending_docs", pending, true);
  if (tasks != null && tasks > 0) return metricLabelLine("open_tasks", tasks, true);
  if (meetings != null && meetings > 0) return metricLabelLine("meetings_today", meetings, true);
  if (newClients != null && newClients > 0) {
    return metricLabelLine("new_clients_month", newClients, true);
  }
  if (active != null && active > 0) return metricLabelLine("active_clients", active, true);
  return "סוכנות הביטוח שלך מסודרת להיום.";
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

  // Hero lines: always one line per configured metric id, only from home-metrics.
  const summaryLines = home.summaryMetricIds
    .filter((id) => id !== "renewals_placeholder")
    .map((id) => {
      const value = input.metrics[id as keyof DashboardHomeMetricSnapshot] ?? null;
      return metricLabelLine(id, value, input.metricsLoaded);
    });

  const greetingLine = input.partOfDayGreeting
    ? `${input.partOfDayGreeting}. ${home.greetingLine}`.trim()
    : home.greetingLine;

  return {
    greetingLine,
    summaryLines,
    summaryParagraph: summaryParagraphFromHomeMetrics(input.metrics, input.metricsLoaded),
    cards,
  };
}
