export type NavItemId =
  | "dashboard"
  | "crm"
  | "messageScans"
  | "clients"
  | "invoices"
  | "invoiceImport"
  | "invoiceDrafts"
  | "invoiceDiagnostics"
  | "documentReviews"
  | "supplierPayments"
  | "bank"
  | "collections"
  | "tasks"
  | "social"
  | "whatsapp"
  | "reports"
  | "accountant"
  | "camera"
  | "adminDebug"
  | "businessSettings"
  | "settings"
  | "calendar"
  | "sales";

type NavVisibilityRule = {
  visible: boolean;
  businessTypes?: Partial<Record<string, boolean>>;
};

export const navVisibility: Record<NavItemId, NavVisibilityRule> = {
  dashboard: { visible: true },
  crm: { visible: false },
  messageScans: { visible: false },
  clients: { visible: false },
  invoices: { visible: true },
  invoiceImport: { visible: true },
  invoiceDrafts: { visible: true },
  invoiceDiagnostics: { visible: false },
  documentReviews: { visible: true },
  supplierPayments: { visible: true },
  bank: { visible: true },
  collections: { visible: true },
  tasks: { visible: true },
  social: { visible: false },
  whatsapp: { visible: false },
  reports: { visible: false },
  accountant: { visible: false },
  camera: { visible: false },
  adminDebug: { visible: false },
  businessSettings: { visible: false },
  settings: { visible: true },
  calendar: { visible: true },
  sales: { visible: false },
};

export function isNavItemVisible(itemId: NavItemId, businessType?: string | null) {
  const rule = navVisibility[itemId];
  if (!rule) return true;
  if (businessType && rule.businessTypes && businessType in rule.businessTypes) {
    return rule.businessTypes[businessType] ?? rule.visible;
  }
  return rule.visible;
}
