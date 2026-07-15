import type {
  BusinessCrmField,
  BusinessDashboardWidget,
  BusinessKpiConfig,
  BusinessModuleId,
  BusinessTypeId,
} from "@/lib/business-config";
import type { NavItemId } from "@/config/navVisibility";
import type { ClientInsuranceField } from "@/lib/clients/clientInsurance";

/** Tabs available on `/dashboard/clients/[clientId]`. */
export type ClientCardTabId =
  | "details"
  | "insurance"
  | "appointments"
  | "documents"
  | "quotes"
  | "tasks"
  | "notes"
  | "whatsapp";

export type ClientCardTab = {
  id: ClientCardTabId;
  label: string;
};

export type ClientCardFieldDef = {
  key: string;
  label: string;
  multiline?: boolean;
};

export type NatalieCapabilityId =
  | "read_clients"
  | "update_clients"
  | "read_insurance_profile"
  | "update_insurance_profile"
  | "schedule_appointments"
  | "whatsapp_followups"
  | "invoice_reminders";

export type CrmLayoutId = "leads_pipeline" | "clients_first";

/**
 * Single source of truth for UI / Natalie adaptation by organization business type.
 * Screens must read this object — never branch on raw businessType strings.
 */
export type BusinessModuleConfig = {
  businessType: BusinessTypeId;
  label: string;
  /** Product feature modules enabled for this vertical (crm, invoices, …). */
  enabledModules: BusinessModuleId[];
  clientCard: {
    tabs: ClientCardTab[];
    defaultTab: ClientCardTabId;
    /** Extra fields surfaced on the insurance tab when present. */
    insuranceFields: Array<{ key: ClientInsuranceField; label: string; multiline?: boolean }>;
  };
  crm: {
    fields: BusinessCrmField[];
    layout: CrmLayoutId;
    pageKicker: string;
    pageTitle: string;
    entitySingular: string;
    entityPlural: string;
  };
  navigation: {
    /** Overrides applied on top of global navVisibility defaults. */
    itemOverrides: Partial<Record<NavItemId, boolean>>;
  };
  dashboard: {
    title: string;
    subtitle: string;
    widgets: BusinessDashboardWidget[];
    kpis: BusinessKpiConfig[];
  };
  natalie: {
    capabilities: NatalieCapabilityId[];
    clientContext: "generic" | "insured_person";
  };
  features: {
    insuranceProfile: boolean;
  };
};

/** Partial overlay registered per business type; merged onto the shared base. */
export type BusinessModuleOverlay = {
  businessType: BusinessTypeId;
  patch: DeepPartialBusinessModule;
};

type DeepPartialBusinessModule = {
  clientCard?: Partial<BusinessModuleConfig["clientCard"]>;
  crm?: Partial<BusinessModuleConfig["crm"]>;
  navigation?: {
    itemOverrides?: Partial<Record<NavItemId, boolean>>;
  };
  dashboard?: Partial<BusinessModuleConfig["dashboard"]>;
  natalie?: Partial<BusinessModuleConfig["natalie"]>;
  features?: Partial<BusinessModuleConfig["features"]>;
};
