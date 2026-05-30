export const businessModules = [
  { id: "crm", label: "CRM", description: "לקוחות, לידים ותהליך מכירה" },
  { id: "invoices", label: "Invoices", description: "חשבוניות, קבלות והכנסות" },
  { id: "supplier_management", label: "Supplier Management", description: "ספקים, תשלומים וחשבוניות חסרות" },
  { id: "tasks", label: "Tasks", description: "משימות, תזכורות ומעקב עבודה" },
  { id: "whatsapp", label: "WhatsApp", description: "הודעות, התראות ותזכורות" },
  { id: "documents", label: "Documents", description: "Drive, קבצים וסידור מסמכים" },
  { id: "meetings", label: "Meetings", description: "פגישות וסיכומי שיחה" },
  { id: "collections", label: "Collections", description: "גבייה ותזכורות תשלום" },
  { id: "employees", label: "Employees", description: "צוות, שיוכים ותפעול עובדים" },
] as const;

export const businessSizes = [
  { id: "solo", label: "Solo" },
  { id: "2_5", label: "2-5 employees" },
  { id: "6_20", label: "6-20 employees" },
  { id: "20_plus", label: "20+" },
] as const;

export const businessPains = [
  { id: "leads", label: "Leads", description: "יותר לידים ומעקב אחרי מתעניינים", modules: ["crm", "whatsapp"] },
  { id: "invoices", label: "Invoices", description: "חשבוניות וקבלות מסודרות", modules: ["invoices", "documents"] },
  { id: "collections", label: "Collections", description: "גבייה ותזכורות תשלום", modules: ["collections", "invoices", "whatsapp"] },
  { id: "customer_service", label: "Customer Service", description: "שירות לקוחות והודעות", modules: ["crm", "whatsapp", "tasks"] },
  { id: "whatsapp", label: "WhatsApp", description: "ניהול הודעות ותזכורות", modules: ["whatsapp", "crm"] },
  { id: "tasks", label: "Tasks", description: "משימות, פולואפים ותפעול", modules: ["tasks", "employees"] },
  { id: "documents", label: "Documents", description: "מסמכים, Drive וקבצים", modules: ["documents", "tasks"] },
] as const;

export const businessTypes = [
  { id: "beauty_clinic", label: "Beauty Clinic", modules: ["crm", "invoices", "tasks", "whatsapp", "documents", "meetings", "collections"] },
  { id: "accountant", label: "Accountant", modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "documents", "meetings"] },
  { id: "lawyer", label: "Lawyer", modules: ["crm", "invoices", "tasks", "whatsapp", "documents", "meetings", "collections"] },
  { id: "insurance_agency", label: "Insurance Agency", modules: ["crm", "invoices", "tasks", "whatsapp", "documents", "meetings", "collections"] },
  { id: "real_estate", label: "Real Estate", modules: ["crm", "invoices", "tasks", "whatsapp", "documents", "meetings", "collections"] },
  { id: "ecommerce", label: "Ecommerce", modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "documents", "collections", "employees"] },
  { id: "importer", label: "Importer", modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "documents", "collections", "employees"] },
  { id: "service_business", label: "Service Business", modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "documents", "collections"] },
  { id: "marketing_agency", label: "Marketing Agency", modules: ["crm", "invoices", "tasks", "whatsapp", "documents", "meetings", "collections", "employees"] },
  { id: "restaurant", label: "Restaurant", modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "documents", "employees"] },
  { id: "other", label: "Other", modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "documents", "collections"] },
] as const;

export type BusinessModuleId = (typeof businessModules)[number]["id"];
export type BusinessTypeId = (typeof businessTypes)[number]["id"];
export type BusinessSizeId = (typeof businessSizes)[number]["id"];
export type BusinessPainId = (typeof businessPains)[number]["id"];

export type OrganizationSettings = {
  id: string;
  name: string;
  businessName: string | null;
  businessType: BusinessTypeId;
  businessSize: BusinessSizeId | null;
  mainBusinessPain: BusinessPainId | null;
  enabledModules: BusinessModuleId[];
  onboardingCompleted: boolean;
  onboardingRequired: boolean;
  recommendedModules: BusinessModuleId[];
  locale: string;
  currency: string;
  timezone: string;
};

export type BusinessTemplatesResponse = {
  businessTypes: typeof businessTypes;
  businessSizes: typeof businessSizes;
  businessPains: typeof businessPains;
  modules: typeof businessModules;
  defaultBusinessType: BusinessTypeId;
  defaultEnabledModules: BusinessModuleId[];
};

export const defaultEnabledModules = businessTypes.find((type) => type.id === "service_business")!.modules as readonly BusinessModuleId[];

export function recommendedModulesFor(
  businessType: BusinessTypeId,
  businessSize: BusinessSizeId | null,
  mainBusinessPain: BusinessPainId | null
) {
  const template = businessTypes.find((type) => type.id === businessType) ?? businessTypes.find((type) => type.id === "service_business")!;
  const painModules = businessPains.find((pain) => pain.id === mainBusinessPain)?.modules ?? [];
  const sizeModules = businessSize === "6_20" || businessSize === "20_plus" ? ["employees"] : [];
  return Array.from(new Set([...template.modules, ...painModules, ...sizeModules])) as BusinessModuleId[];
}

export function moduleEnabled(settings: OrganizationSettings | null, moduleId: BusinessModuleId) {
  return !settings || settings.enabledModules.includes(moduleId);
}

export function businessTypeLabel(type: string | null | undefined) {
  return businessTypes.find((item) => item.id === type)?.label ?? "Service Business";
}
