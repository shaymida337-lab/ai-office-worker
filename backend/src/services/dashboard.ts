import { prisma } from "../lib/prisma.js";

export async function getDashboardStats(organizationId: string) {
  const payments = await prisma.supplierPayment.findMany({
    where: { organizationId },
  });

  const validPayments = payments.filter((p) => isReasonableMoneyAmount(p.amount));
  const suspiciousPaymentsCount = payments.length - validPayments.length;
  const openPayments = validPayments.filter((p) => !p.paid);
  const moneyToPay = openPayments
    .filter((p) => p.paymentRequired)
    .reduce((sum, p) => sum + p.amount, 0);

  const pendingInvoices = openPayments.filter((p) => p.paymentRequired).length;
  const missingInvoices = payments.filter((p) => p.missingInvoice);

  const now = new Date();
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const upcomingPayments = openPayments.filter(
    (p) => p.dueDate && p.dueDate <= in7days && p.dueDate >= now
  );

  const [
    openTasks,
    totalInvoices,
    scansCompleted,
    driveUploads,
    clients,
  ] = await Promise.all([
    prisma.task.count({
      where: { organizationId, status: "open" },
    }),
    prisma.invoice.count({ where: { organizationId } }),
    prisma.syncLog.count({
      where: { organizationId, type: "gmail_scan", status: "success" },
    }),
    prisma.emailAttachment.count({
      where: { driveLink: { not: null }, emailMessage: { organizationId } },
    }),
    prisma.client.count({ where: { organizationId } }),
  ]);

  const customerInvoices = await prisma.customerInvoice.findMany({
    where: { organizationId },
  });
  const openCustomerInvoices = customerInvoices.filter((i) => !i.paid);
  const moneyToReceive = openCustomerInvoices.reduce((sum, i) => sum + i.amount, 0);

  const unreadAlerts = await prisma.alert.count({
    where: { organizationId, read: false },
  });

  const overdueSupplierPayments = openPayments.filter(
    (p) => p.dueDate && p.dueDate < now && p.paymentRequired
  ).length;
  const overdueCustomerInvoices = openCustomerInvoices.filter(
    (i) => i.dueDate && i.dueDate < now
  ).length;
  const businessHealthScore = Math.max(
    0,
    Math.min(
      100,
      100 -
        missingInvoices.length * 8 -
        overdueSupplierPayments * 10 -
        overdueCustomerInvoices * 10 -
        Math.min(openTasks, 10) * 2
    )
  );

  return {
    moneyToPay,
    moneyToReceive,
    pendingInvoices,
    missingInvoicesCount: missingInvoices.length,
    upcomingPaymentsCount: upcomingPayments.length,
    openTasks,
    unreadAlerts,
    businessHealthScore,
    overdueCustomerInvoices,
    overdueSupplierPayments,
    supplierPaymentsCount: payments.length,
    totalInvoices,
    unpaidPayments: openPayments.length,
    paidPayments: validPayments.filter((p) => p.paid).length,
    scansCompleted,
    driveUploads,
    clients,
    suspiciousPaymentsCount,
    hoursSavedThisWeek: Math.round((payments.length + customerInvoices.length + openTasks) * 0.25),
    currency: "ILS",
  };
}

export async function getMissingInvoicesReport(organizationId: string) {
  return prisma.supplierPayment.findMany({
    where: { organizationId, missingInvoice: true, paid: false },
    orderBy: { date: "desc" },
  });
}

function isReasonableMoneyAmount(amount: number) {
  return Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000;
}
