import { prisma } from "../lib/prisma.js";

export const BUSINESS_MODULES = [
  { id: "crm", label: "CRM", description: "Leads, clients, pipeline, and client activity." },
  { id: "invoices", label: "Invoices", description: "Customer invoices, invoice capture, and accounting sync." },
  { id: "supplier_management", label: "Supplier Management", description: "Supplier payments, missing invoices, and payment review." },
  { id: "tasks", label: "Tasks", description: "Operational tasks and follow-ups." },
  { id: "whatsapp", label: "WhatsApp", description: "Client messaging, reminders, and owner alerts." },
  { id: "documents", label: "Documents", description: "Drive folders, document upload, and file organization." },
  { id: "meetings", label: "Meetings", description: "Meeting notes, follow-ups, and scheduling." },
  { id: "collections", label: "Collections", description: "Receivables, reminders, and collection workflows." },
  { id: "employees", label: "Employees", description: "Team tasks, assignments, and employee operations." },
] as const;

export const BUSINESS_SIZES = [
  { id: "solo", label: "Solo" },
  { id: "2_5", label: "2-5 employees" },
  { id: "6_20", label: "6-20 employees" },
  { id: "20_plus", label: "20+" },
] as const;

export const BUSINESS_PAINS = [
  { id: "leads", label: "Leads", modules: ["crm", "whatsapp"] },
  { id: "invoices", label: "Invoices", modules: ["invoices", "documents"] },
  { id: "collections", label: "Collections", modules: ["collections", "invoices", "whatsapp"] },
  { id: "customer_service", label: "Customer Service", modules: ["crm", "whatsapp", "tasks"] },
  { id: "whatsapp", label: "WhatsApp", modules: ["whatsapp", "crm"] },
  { id: "tasks", label: "Tasks", modules: ["tasks", "employees"] },
  { id: "documents", label: "Documents", modules: ["documents", "tasks"] },
] as const;

export const DEFAULT_ENABLED_MODULES = [
  "crm",
  "invoices",
  "supplier_management",
  "tasks",
  "whatsapp",
  "documents",
  "collections",
] as const;

export const BUSINESS_TEMPLATES = [
  { id: "beauty_clinic", label: "Beauty Clinic", modules: ["crm", "invoices", "tasks", "whatsapp", "meetings", "collections"] },
  { id: "accountant", label: "Accountant", modules: ["crm", "invoices", "supplier_management", "tasks", "documents", "meetings"] },
  { id: "lawyer", label: "Lawyer", modules: ["crm", "invoices", "tasks", "documents", "meetings", "collections"] },
  { id: "insurance_agency", label: "Insurance Agency", modules: ["crm", "invoices", "tasks", "whatsapp", "documents", "collections"] },
  { id: "real_estate", label: "Real Estate", modules: ["crm", "invoices", "tasks", "whatsapp", "documents", "meetings"] },
  { id: "ecommerce", label: "Ecommerce", modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "collections", "employees"] },
  { id: "importer", label: "Importer", modules: ["crm", "invoices", "supplier_management", "tasks", "documents", "collections", "employees"] },
  { id: "service_business", label: "Service Business", modules: [...DEFAULT_ENABLED_MODULES] },
  { id: "renovation_contractor", label: "Renovation Contractor", modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "documents", "collections", "employees"] },
  { id: "mortgage_advisor", label: "Mortgage Advisor", modules: ["crm", "invoices", "tasks", "whatsapp", "documents", "meetings", "collections"] },
  { id: "event_production", label: "Event Production", modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "documents", "meetings", "employees"] },
  { id: "marketing_agency", label: "Marketing Agency", modules: ["crm", "invoices", "tasks", "whatsapp", "documents", "meetings", "employees"] },
  { id: "restaurant", label: "Restaurant", modules: ["crm", "invoices", "supplier_management", "tasks", "whatsapp", "employees"] },
  { id: "other", label: "Other", modules: [...DEFAULT_ENABLED_MODULES] },
] as const;

const BUSINESS_PROFILE_COPY: Record<string, { title: string; subtitle: string }> = {
  beauty_clinic: { title: "Clinic growth cockpit", subtitle: "Leads, appointments, WhatsApp and collections for a beauty clinic." },
  accountant: { title: "Accounting operations desk", subtitle: "Clients, documents, invoices and reporting tasks." },
  lawyer: { title: "Legal practice dashboard", subtitle: "Cases, clients, documents, meetings and collections." },
  insurance_agency: { title: "Insurance agency cockpit", subtitle: "Leads, renewals, policies and customer service." },
  real_estate: { title: "Real estate deal room", subtitle: "Properties, buyers, sellers, meetings and documents." },
  ecommerce: { title: "Ecommerce operations cockpit", subtitle: "Orders, suppliers, collections, support and team work." },
  importer: { title: "Importer control tower", subtitle: "Suppliers, documents, payments, tasks and team operations." },
  service_business: { title: "Service business command center", subtitle: "Clients, invoices, suppliers, tasks and collections." },
  renovation_contractor: { title: "Renovation contractor command center", subtitle: "Projects, quotes, suppliers, crews, documents and collections." },
  mortgage_advisor: { title: "Mortgage advisor pipeline", subtitle: "Leads, mortgage files, banks, documents, meetings and follow-ups." },
  event_production: { title: "Event production cockpit", subtitle: "Events, clients, suppliers, crew, documents and payments." },
  marketing_agency: { title: "Agency delivery cockpit", subtitle: "Clients, campaigns, delivery tasks, meetings and team work." },
  restaurant: { title: "Restaurant operations board", subtitle: "Suppliers, staff, WhatsApp, invoices and tasks." },
  other: { title: "Business command center", subtitle: "General business modules and operating metrics." },
};

const moduleIds = new Set(BUSINESS_MODULES.map((module) => module.id));
const templateIds = new Set(BUSINESS_TEMPLATES.map((template) => template.id));

export type BusinessType = (typeof BUSINESS_TEMPLATES)[number]["id"];
export type BusinessModuleId = (typeof BUSINESS_MODULES)[number]["id"];
export type BusinessSize = (typeof BUSINESS_SIZES)[number]["id"];
export type BusinessPain = (typeof BUSINESS_PAINS)[number]["id"];

export function normalizeBusinessType(value: unknown): BusinessType {
  if (value === "service_company") return "service_business";
  if (value === "insurance_agent") return "insurance_agency";
  return typeof value === "string" && templateIds.has(value as BusinessType) ? value as BusinessType : "service_business";
}

export function normalizeBusinessSize(value: unknown): BusinessSize | null {
  const ids = new Set(BUSINESS_SIZES.map((item) => item.id));
  return typeof value === "string" && ids.has(value as BusinessSize) ? value as BusinessSize : null;
}

export function normalizeBusinessPain(value: unknown): BusinessPain | null {
  const ids = new Set(BUSINESS_PAINS.map((item) => item.id));
  return typeof value === "string" && ids.has(value as BusinessPain) ? value as BusinessPain : null;
}

export function recommendedModulesFor(businessType?: unknown, businessSize?: unknown, mainBusinessPain?: unknown): BusinessModuleId[] {
  const type = normalizeBusinessType(businessType);
  const size = normalizeBusinessSize(businessSize);
  const pain = normalizeBusinessPain(mainBusinessPain);
  const template = BUSINESS_TEMPLATES.find((item) => item.id === type);
  const painModules = BUSINESS_PAINS.find((item) => item.id === pain)?.modules ?? [];
  const sizeModules = size === "6_20" || size === "20_plus" ? ["employees"] : [];
  const relevantModules = new Set(template?.modules ?? DEFAULT_ENABLED_MODULES);
  return Array.from(new Set([...(template?.modules ?? DEFAULT_ENABLED_MODULES), ...painModules, ...sizeModules]))
    .filter((item): item is BusinessModuleId => moduleIds.has(item as BusinessModuleId) && relevantModules.has(item as BusinessModuleId));
}

export function normalizeEnabledModules(value: unknown, businessType?: unknown, businessSize?: unknown, mainBusinessPain?: unknown): BusinessModuleId[] {
  const candidate = Array.isArray(value) ? value : null;
  const normalized = candidate
    ?.filter((item): item is BusinessModuleId => typeof item === "string" && moduleIds.has(item as BusinessModuleId));
  if (normalized?.length) return Array.from(new Set(normalized));
  return recommendedModulesFor(businessType, businessSize, mainBusinessPain);
}

export function getBusinessTemplates() {
  return {
    businessTypes: BUSINESS_TEMPLATES,
    businessProfiles: Object.fromEntries(BUSINESS_TEMPLATES.map((template) => [template.id, buildBusinessProfile(template.id)])),
    businessSizes: BUSINESS_SIZES,
    businessPains: BUSINESS_PAINS,
    modules: BUSINESS_MODULES,
    defaultBusinessType: "service_business",
    defaultEnabledModules: DEFAULT_ENABLED_MODULES,
  };
}

function buildBusinessProfile(businessType: BusinessType) {
  const template = BUSINESS_TEMPLATES.find((item) => item.id === businessType) ?? BUSINESS_TEMPLATES[7];
  const copy = BUSINESS_PROFILE_COPY[businessType] ?? BUSINESS_PROFILE_COPY.service_business;
  return {
    ...copy,
    modules: template.modules,
    dashboardWidgets: template.modules.slice(0, 3).map((moduleId) => ({
      id: `${businessType}-${moduleId}`,
      module: moduleId,
      title: BUSINESS_MODULES.find((module) => module.id === moduleId)?.label ?? moduleId,
      description: BUSINESS_MODULES.find((module) => module.id === moduleId)?.description ?? "",
    })),
    crmFields: [
      "name",
      "company",
      "phone",
      "email",
      "estimatedValue",
      "tags",
      "notes",
    ],
  };
}

export async function getOrganizationSettings(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      businessName: true,
      locale: true,
      currency: true,
      timezone: true,
    },
  });
  if (!organization) throw new Error("Organization not found");
  const configRows = await prisma.$queryRawUnsafe<Array<{ business_type: string | null; enabled_modules: unknown; business_size: string | null; main_business_pain: string | null; onboarding_completed: boolean | null }>>(
    'SELECT "business_type", "enabled_modules", "business_size", "main_business_pain", "onboarding_completed" FROM "Organization" WHERE "id" = $1 LIMIT 1',
    organizationId
  ).catch(() => []);
  const businessType = normalizeBusinessType(configRows[0]?.business_type);
  const businessSize = normalizeBusinessSize(configRows[0]?.business_size);
  const mainBusinessPain = normalizeBusinessPain(configRows[0]?.main_business_pain);
  const enabledModules = normalizeEnabledModules(configRows[0]?.enabled_modules, businessType, businessSize, mainBusinessPain);
  return {
    ...organization,
    businessType,
    businessSize,
    mainBusinessPain,
    enabledModules,
    onboardingCompleted: configRows[0]?.onboarding_completed ?? true,
    onboardingRequired: !(configRows[0]?.onboarding_completed ?? true),
    recommendedModules: recommendedModulesFor(businessType, businessSize, mainBusinessPain),
    businessProfile: buildBusinessProfile(businessType),
    template: BUSINESS_TEMPLATES.find((template) => template.id === businessType) ?? BUSINESS_TEMPLATES[7],
  };
}

export async function updateOrganizationBusinessSettings(
  organizationId: string,
  input: { businessType?: unknown; businessSize?: unknown; mainBusinessPain?: unknown; enabledModules?: unknown; businessName?: unknown; name?: unknown; onboardingCompleted?: unknown }
) {
  const businessType = normalizeBusinessType(input.businessType);
  const businessSize = normalizeBusinessSize(input.businessSize);
  const mainBusinessPain = normalizeBusinessPain(input.mainBusinessPain);
  const enabledModules = normalizeEnabledModules(input.enabledModules, businessType, businessSize, mainBusinessPain);
  const onboardingCompleted = typeof input.onboardingCompleted === "boolean" ? input.onboardingCompleted : null;
  await prisma.$executeRawUnsafe(
    'UPDATE "Organization" SET "business_type" = $1, "enabled_modules" = $2::jsonb, "business_size" = $3, "main_business_pain" = $4, "onboarding_completed" = COALESCE($5, "onboarding_completed"), "businessName" = COALESCE($6, "businessName"), "name" = COALESCE($7, "name"), "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $8',
    businessType,
    JSON.stringify(enabledModules),
    businessSize,
    mainBusinessPain,
    onboardingCompleted,
    typeof input.businessName === "string" ? input.businessName.trim() || null : null,
    typeof input.name === "string" && input.name.trim() ? input.name.trim() : null,
    organizationId
  );
  return getOrganizationSettings(organizationId);
}

export async function markOrganizationNeedsOnboarding(organizationId: string) {
  await prisma.$executeRawUnsafe(
    'UPDATE "Organization" SET "onboarding_completed" = false WHERE "id" = $1',
    organizationId
  ).catch(() => undefined);
}
