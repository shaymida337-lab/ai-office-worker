import type { DashboardStats } from "@/lib/api";
import type {
  BusinessModuleConfig,
  HomeCardConfig,
  HomeMetricId,
} from "@/lib/business-module";
import { isThisMonth, isTodayValue } from "@/lib/dashboard/homePageHelpers";
import type { ClientsResponse, UpcomingAppointment } from "@/lib/dashboard/homePageTypes";

export type InsuranceHomeMetricValues = Record<
  Exclude<HomeMetricId, "renewals_placeholder">,
  number
>;

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
  stats: DashboardStats | null;
  /** Full pending document-reviews count from existing GET (before any UI slice). */
  pendingDocsCount: number;
  upcomingAppointments: UpcomingAppointment[];
  clients: ClientsResponse | null;
}): InsuranceHomeMetricValues {
  const activeClients =
    typeof (input.stats as DashboardStats & { totalClients?: number } | null)?.totalClients ===
    "number"
      ? (input.stats as DashboardStats & { totalClients: number }).totalClients
      : (input.stats?.clients ?? input.clients?.clients.length ?? 0);

  const meetingsToday = input.upcomingAppointments.filter((appointment) =>
    isTodayValue(appointment.startTime)
  ).length;

  const newClientsMonth = (input.clients?.clients ?? []).filter((client) => {
    const createdAt = (client as { createdAt?: string }).createdAt;
    return typeof createdAt === "string" && isThisMonth(createdAt);
  }).length;

  return {
    active_clients: activeClients,
    open_tasks: input.stats?.openTasks ?? 0,
    meetings_today: meetingsToday,
    pending_docs: input.pendingDocsCount,
    new_clients_month: newClientsMonth,
  };
}

function metricLabelLine(id: HomeMetricId, value: number, entityPlural: string): string | null {
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
      return value === 0
        ? `לא נוספו ${entityPlural} חדשים החודש`
        : `נוספו ${value} ${entityPlural} חדשים החודש`;
    default:
      return null;
  }
}

export function buildInsuranceHomeOverlay(input: {
  module: BusinessModuleConfig;
  metrics: InsuranceHomeMetricValues;
  loading: boolean;
  partOfDayGreeting: string;
}): InsuranceHomeOverlayView {
  const home = input.module.dashboard.home;
  const cards: InsuranceHomeResolvedCard[] = home.cards.map((card) => {
    if (card.valueKind === "placeholder") {
      return {
        ...card,
        displayValue: card.placeholderText ?? "—",
        clickable: false,
      };
    }
    const value = input.metrics[card.id as keyof InsuranceHomeMetricValues];
    return {
      ...card,
      displayValue: input.loading ? "—" : String(value ?? 0),
      clickable: Boolean(card.href),
    };
  });

  const summaryLines = home.summaryMetricIds
    .map((id) => {
      if (id === "renewals_placeholder") return null;
      const value = input.metrics[id as keyof InsuranceHomeMetricValues] ?? 0;
      return metricLabelLine(id, value, input.module.crm.entityPlural);
    })
    .filter((line): line is string => Boolean(line));

  const greetingLine = input.partOfDayGreeting
    ? `${input.partOfDayGreeting}. ${home.greetingLine}`.trim()
    : home.greetingLine;

  const priority =
    input.metrics.pending_docs > 0
      ? metricLabelLine("pending_docs", input.metrics.pending_docs, input.module.crm.entityPlural)
      : input.metrics.open_tasks > 0
        ? metricLabelLine("open_tasks", input.metrics.open_tasks, input.module.crm.entityPlural)
        : input.metrics.meetings_today > 0
          ? metricLabelLine("meetings_today", input.metrics.meetings_today, input.module.crm.entityPlural)
          : input.metrics.new_clients_month > 0
            ? metricLabelLine(
                "new_clients_month",
                input.metrics.new_clients_month,
                input.module.crm.entityPlural
              )
            : "סוכנות הביטוח שלך מסודרת להיום.";

  return {
    greetingLine,
    summaryLines,
    summaryParagraph: priority ?? "סוכנות הביטוח שלך מסודרת להיום.",
    cards,
  };
}
