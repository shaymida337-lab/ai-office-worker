import type { DashboardStats } from "@/lib/api";
import type { ClientsResponse, ScanStatus } from "./homePageTypes";

export const emptyStats: DashboardStats = {
  moneyToPay: 0,
  moneyToReceive: 0,
  pendingInvoices: 0,
  missingInvoicesCount: 0,
  upcomingPaymentsCount: 0,
  openTasks: 0,
  unreadAlerts: 0,
  businessHealthScore: 100,
  overdueCustomerInvoices: 0,
  overdueSupplierPayments: 0,
  hoursSavedThisWeek: 0,
  supplierPaymentsCount: 0,
  totalInvoices: 0,
  unpaidPayments: 0,
  paidPayments: 0,
  scansCompleted: 0,
  driveUploads: 0,
  documentsInDrive: 0,
  invoicesFromGmail: 0,
  invoicesFromWhatsApp: 0,
  clients: 0,
  suspiciousPaymentsCount: 0,
  sheetsReconciliation: null,
  currency: "ILS",
};

export const emptyClients: ClientsResponse = {
  clients: [],
  totals: {
    toPay: 0,
    openTasks: 0,
    invoices: 0,
    missingInvoices: 0,
  },
};

export function emptyScanStatus(): ScanStatus {
  return { last: null, logs: [], nextScheduledScanAt: "" };
}
