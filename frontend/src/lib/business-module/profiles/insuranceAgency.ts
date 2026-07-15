import { INSURANCE_PERSONAL_FIELDS } from "@/lib/clients/clientInsurance";
import { DEFAULT_CLIENT_CARD_TABS } from "../base";
import type { BusinessModuleOverlay, ClientCardTab } from "../types";

const INSURANCE_CLIENT_TABS: ClientCardTab[] = [
  { id: "details", label: "פרטים" },
  { id: "insurance", label: "ביטוח" },
  ...DEFAULT_CLIENT_CARD_TABS.filter((tab) => tab.id !== "details"),
];

/**
 * Insurance agency vertical overlay.
 * Adds insurance tab/fields, surfaces Clients (+ CRM) in nav, and Natalie insurance capabilities.
 */
export const insuranceAgencyModule: BusinessModuleOverlay = {
  businessType: "insurance_agency",
  patch: {
    clientCard: {
      tabs: INSURANCE_CLIENT_TABS,
      defaultTab: "insurance",
      insuranceFields: INSURANCE_PERSONAL_FIELDS.map((field) => ({ ...field })),
    },
    crm: {
      layout: "clients_first",
      pageKicker: "סוכנות ביטוח",
      pageTitle: "מבוטחים ולידים",
      entitySingular: "מבוטח",
      entityPlural: "מבוטחים",
    },
    dashboard: {
      subtitle: "סוכנות ביטוח — מבוטחים, פגישות ומסמכים לטיפול.",
      home: {
        layout: "insurance_agency",
        greetingLine: "הנה מצב סוכנות הביטוח שלך להיום.",
        cards: [
          {
            id: "active_clients",
            label: "מבוטחים פעילים",
            href: "/crm",
            valueKind: "metric",
          },
          {
            id: "open_tasks",
            label: "משימות פתוחות",
            href: "/tasks",
            valueKind: "metric",
          },
          {
            id: "meetings_today",
            label: "פגישות היום",
            href: "/dashboard/calendar",
            valueKind: "metric",
          },
          {
            id: "pending_docs",
            label: "מסמכים שממתינים לטיפול",
            href: "/dashboard/document-reviews",
            valueKind: "metric",
          },
          {
            id: "new_clients_month",
            label: "לידים חדשים",
            href: "/crm",
            valueKind: "metric",
          },
          {
            id: "renewals_placeholder",
            label: "חידושים קרובים",
            href: null,
            valueKind: "placeholder",
            placeholderText: "חידושים יופיעו לאחר הוספת פוליסות",
          },
        ],
        summaryMetricIds: ["active_clients", "new_clients_month", "meetings_today", "open_tasks"],
      },
    },
    navigation: {
      itemOverrides: {
        clients: true,
        crm: true,
      },
    },
    natalie: {
      capabilities: [
        "read_clients",
        "update_clients",
        "read_insurance_profile",
        "update_insurance_profile",
        "schedule_appointments",
        "whatsapp_followups",
        "invoice_reminders",
      ],
      clientContext: "insured_person",
    },
    features: {
      insuranceProfile: true,
    },
  },
};
