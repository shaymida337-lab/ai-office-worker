import {
  businessTypeLabel,
  getBusinessProfile,
  type BusinessTypeId,
} from "@/lib/business-config";
import type { BusinessModuleConfig, ClientCardTab } from "./types";

/** Default client-card tabs for general service businesses (no insurance). */
export const DEFAULT_CLIENT_CARD_TABS: ClientCardTab[] = [
  { id: "details", label: "פרטים" },
  { id: "appointments", label: "פגישות" },
  { id: "documents", label: "מסמכים" },
  { id: "quotes", label: "הצעות מחיר" },
  { id: "tasks", label: "משימות" },
  { id: "notes", label: "הערות" },
  { id: "whatsapp", label: "וואטסאפ" },
];

export function buildBaseBusinessModule(businessType: BusinessTypeId): BusinessModuleConfig {
  const profile = getBusinessProfile(businessType);
  return {
    businessType,
    label: businessTypeLabel(businessType),
    enabledModules: [...profile.modules],
    clientCard: {
      tabs: DEFAULT_CLIENT_CARD_TABS,
      defaultTab: "details",
      insuranceFields: [],
    },
    crm: {
      fields: profile.crmFields,
      layout: "leads_pipeline",
      pageKicker: "CRM",
      pageTitle: "ניהול לקוחות",
      entitySingular: "לקוח",
      entityPlural: "לקוחות",
    },
    navigation: {
      itemOverrides: {},
    },
    dashboard: {
      title: profile.title,
      subtitle: profile.subtitle,
      widgets: profile.dashboardWidgets,
      kpis: profile.dashboardKpis,
      home: {
        layout: "default",
        greetingLine: "",
        cards: [],
        summaryMetricIds: [],
      },
    },
    natalie: {
      capabilities: [
        "read_clients",
        "update_clients",
        "schedule_appointments",
        "whatsapp_followups",
        "invoice_reminders",
      ],
      clientContext: "generic",
    },
    features: {
      insuranceProfile: false,
    },
  };
}
