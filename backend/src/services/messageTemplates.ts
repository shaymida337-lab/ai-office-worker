import {
  buildNatalieClientMorningBrief,
  buildNatalieCriticalAlert,
  buildNatalieInvoiceFound,
  buildNataliePaymentReminder,
  buildNatalieUrgentClientAlert,
  buildNatalieWeeklyReport,
} from "./whatsapp/natalieWhatsAppUx.js";

export const ownerTemplates = {
  criticalAlert: (data: { clientName: string; issue: string; action: string }) =>
    buildNatalieCriticalAlert(data),

  weeklyReport: (data: { week: string; income: number; newClients: number; completedTasks: number; topClient: string }) =>
    buildNatalieWeeklyReport(data),
};

export const clientTemplates = {
  morningBrief: (data: { clientName: string; tasksToday: number; pendingInvoice?: number; tip?: string }) =>
    buildNatalieClientMorningBrief(data),

  invoiceFound: (data: { clientName: string; amount: number; from: string; savedTo: string }) =>
    buildNatalieInvoiceFound({ clientName: data.clientName, amount: data.amount, from: data.from }),

  paymentReminder: (data: { clientName: string; invoiceNumber: string; amount: number; daysOverdue: number; paymentLink?: string }) =>
    buildNataliePaymentReminder({
      clientName: data.clientName,
      amount: data.amount,
      daysOverdue: data.daysOverdue,
    }),

  urgentAlert: (data: { clientName: string; message: string }) => buildNatalieUrgentClientAlert(data),
};
