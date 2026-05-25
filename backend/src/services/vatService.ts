import { prisma } from "../lib/prisma.js";

export const VAT_RATE = 0.18;

export type VATReport = {
  period: string;
  salesVAT: number;
  purchaseVAT: number;
  netVAT: number;
  dueDate: string;
};

export async function calculateMonthlyVAT(organizationId: string, period: string): Promise<VATReport> {
  const { start, end } = monthRange(period);
  const [invoices, expenses] = await Promise.all([
    prisma.invoice.findMany({ where: { organizationId, date: { gte: start, lte: end } } }),
    prisma.supplierPayment.findMany({ where: { organizationId, date: { gte: start, lte: end } } }),
  ]);
  const salesVAT = roundMoney(invoices.reduce((sum, invoice) => sum + invoice.amount * VAT_RATE, 0));
  const purchaseVAT = roundMoney(expenses.reduce((sum, expense) => sum + expense.amount * VAT_RATE, 0));
  return {
    period,
    salesVAT,
    purchaseVAT,
    netVAT: roundMoney(salesVAT - purchaseVAT),
    dueDate: getVATDueDate(period),
  };
}

export function getVATDueDate(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 15)).toISOString().slice(0, 10);
}

export function monthRange(period: string) {
  const [year, month] = period.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
  };
}

export function previousMonth(from = new Date()) {
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
