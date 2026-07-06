import { prisma } from "../../lib/prisma.js";
import { buildRealStaleLeadWhere } from "../crm/leadQuality.js";
import { getDashboardStats } from "../dashboard.js";
import {
  buildNatalieMonthlyReport,
  buildNatalieOwnerDailySummary,
  extractFirstName,
  formatHebrewDateLabel,
  formatHebrewMonthLabel,
  formatHebrewWeekday,
  type NatalieDailySummaryData,
  type NatalieMonthlyReportData,
  sanitizeWhatsAppText,
} from "./natalieWhatsAppUx.js";

function startOfDayInTimezone(timeZone: string): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
}

export async function buildNatalieMonthlyReportMessage(organizationId: string): Promise<string> {
  const data = await loadNatalieMonthlyReportData(organizationId);
  return buildNatalieMonthlyReport(data);
}

function previousMonthBounds(timeZone: string): { start: Date; end: Date; labelDate: Date } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const start = new Date(Date.UTC(prevYear, prevMonth - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(prevYear, prevMonth, 1, 0, 0, 0));
  return { start, end, labelDate: start };
}

export async function loadNatalieMonthlyReportData(organizationId: string): Promise<NatalieMonthlyReportData> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { user: true },
  });
  const timeZone = org?.timezone ?? "Asia/Jerusalem";
  const now = new Date();
  const { start: monthStart, end: monthEnd, labelDate } = previousMonthBounds(timeZone);
  const stats = await getDashboardStats(organizationId);
  const in48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const [
    paidAgg,
    urgentPayments,
    documentsProcessed,
    pendingReview,
    newLeads,
    closedLeads,
    awaitingLeads,
    incomeAgg,
  ] = await Promise.all([
    prisma.supplierPayment.aggregate({
      where: { organizationId, paid: true, date: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.supplierPayment.count({
      where: { organizationId, paid: false, paymentRequired: true, dueDate: { lt: now } },
    }),
    prisma.financialDocumentReview.count({
      where: { organizationId, createdAt: { gte: monthStart, lt: monthEnd } },
    }),
    prisma.financialDocumentReview.count({
      where: { organizationId, reviewStatus: "needs_review" },
    }),
    prisma.lead.count({
      where: { organizationId, createdAt: { gte: monthStart, lt: monthEnd } },
    }),
    prisma.lead.count({
      where: {
        organizationId,
        stage: "סגור",
        updatedAt: { gte: monthStart, lt: monthEnd },
      },
    }),
    prisma.lead.count({
      where: buildRealStaleLeadWhere(organizationId, in48h),
    }),
    prisma.invoice.aggregate({
      where: { organizationId, date: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
  ]);

  const income = incomeAgg._sum.amount ?? 0;
  const highlights: string[] = [];
  if (income > 0) highlights.push(`הכנסות: ${Math.round(income).toLocaleString("he-IL")} ₪`);
  if (newLeads > 0) highlights.push(`${newLeads} לידים חדשים נכנסו`);
  if (closedLeads > 0) highlights.push(`${closedLeads} לידים נסגרו בהצלחה`);

  const openIssues: string[] = [];
  if (urgentPayments > 0) {
    openIssues.push(`${urgentPayments} תשלומים דחופים פתוחים`);
  }
  if (awaitingLeads > 0) {
    openIssues.push(`${awaitingLeads} לידים ממתינים לטיפול`);
  }

  return {
    firstName: extractFirstName(org?.user?.name ?? org?.name ?? "שם"),
    monthLabel: formatHebrewMonthLabel(labelDate, timeZone),
    payments: {
      paidThisMonth: paidAgg._sum.amount ?? 0,
      outstanding: stats.moneyToPay,
      urgentCount: urgentPayments,
    },
    documents: {
      processed: documentsProcessed,
      pendingReview,
    },
    leads: {
      newCount: newLeads,
      closedCount: closedLeads,
      awaiting: awaitingLeads,
    },
    incomeThisMonth: income,
    highlights,
    openIssues,
  };
}

export async function buildNatalieDailySummaryMessage(organizationId: string): Promise<string> {
  const data = await loadNatalieDailySummaryData(organizationId);
  return buildNatalieOwnerDailySummary(data);
}

export async function loadNatalieDailySummaryData(organizationId: string): Promise<NatalieDailySummaryData> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { user: true },
  });
  const timeZone = org?.timezone ?? "Asia/Jerusalem";
  const now = new Date();
  const todayStart = startOfDayInTimezone(timeZone);
  const in48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const stats = await getDashboardStats(organizationId);

  const [
    urgentPayments,
    upcomingPayments,
    needsReviewCount,
    newReviewsToday,
    newLeads,
    staleLeads,
    openTasks,
    todayAppointments,
    unreadAlerts,
  ] = await Promise.all([
    prisma.supplierPayment.count({
      where: {
        organizationId,
        paid: false,
        paymentRequired: true,
        dueDate: { lt: now },
      },
    }),
    prisma.supplierPayment.count({
      where: {
        organizationId,
        paid: false,
        paymentRequired: true,
        dueDate: { gte: now, lte: in7days },
      },
    }),
    prisma.financialDocumentReview.count({
      where: { organizationId, reviewStatus: "needs_review" },
    }),
    prisma.financialDocumentReview.count({
      where: { organizationId, createdAt: { gte: todayStart } },
    }),
    prisma.lead.count({
      where: {
        organizationId,
        createdAt: { gte: yesterday },
        stage: { notIn: ["סגור", "הפסד"] },
      },
    }),
    prisma.lead.count({
      where: buildRealStaleLeadWhere(organizationId, in48h),
    }),
    prisma.task.count({ where: { organizationId, status: "open" } }),
    prisma.appointment.findMany({
      where: {
        organizationId,
        startTime: { gte: todayStart, lt: new Date(todayStart.getTime() + 24 * 60 * 60 * 1000) },
      },
      orderBy: { startTime: "asc" },
      take: 8,
      include: { client: { select: { name: true } }, service: { select: { name: true } } },
    }),
    prisma.alert.findMany({
      where: { organizationId, read: false },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const firstName = extractFirstName(org?.user?.name ?? org?.name ?? "שם");

  const attentionItems: string[] = [];
  for (const alert of unreadAlerts) {
    const title = sanitizeWhatsAppText(alert.title?.trim() ?? "");
    if (title && !attentionItems.includes(title)) {
      attentionItems.push(title);
    }
  }

  return {
    firstName,
    weekday: formatHebrewWeekday(now, timeZone),
    dateLabel: formatHebrewDateLabel(now, timeZone),
    payments: {
      totalAmount: stats.moneyToPay,
      urgentCount: urgentPayments,
      upcomingCount: upcomingPayments,
    },
    invoices: {
      pending: stats.pendingInvoices,
      needsReview: needsReviewCount,
      newToday: newReviewsToday,
    },
    leads: {
      newCount: newLeads,
      needsHandlingCount: staleLeads,
    },
    todayMeetings: todayAppointments.map((row) => ({
      time: new Intl.DateTimeFormat("he-IL", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
      }).format(row.startTime),
      title: row.service?.name?.trim() || row.client?.name?.trim() || "פגישה",
    })),
    openTasks,
    attentionItems,
  };
}
