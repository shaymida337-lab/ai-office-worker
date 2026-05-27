import { Readable } from "node:stream";
import PDFDocument from "pdfkit";
import { prisma } from "../lib/prisma.js";
import { ensureDriveFolder, safeFolderName } from "./driveService.js";
import { getGoogleClients } from "./google.js";
import { config } from "../lib/config.js";
import { categorizeExpense } from "./accountantAI.js";
import { calculateMonthlyVAT, monthRange, previousMonth, VAT_RATE } from "./vatService.js";

const ROOT_FOLDER = `${config.driveRootFolder} - דוחות רואה חשבון`;
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

export type AccountantSummary = Awaited<ReturnType<typeof buildAccountantSummary>>;

export async function buildAccountantSummary(organizationId: string, period = currentMonth()) {
  const { start, end } = monthRange(period);
  const [org, incomeInvoices, expenses, reports] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId } }),
    prisma.invoice.findMany({ where: { organizationId, date: { gte: start, lte: end } }, include: { client: true } }),
    prisma.supplierPayment.findMany({ where: { organizationId, date: { gte: start, lte: end } } }),
    getAccountantReports(organizationId),
  ]);
  const categorizedExpenses = await Promise.all(expenses.map(async (expense) => ({
    ...expense,
    accounting: await categorizeExpense(expense.subject ?? "", expense.supplier, expense.amount),
  })));
  const totalIncome = incomeInvoices.reduce((sum, invoice) => sum + invoice.amount, 0);
  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const vat = await calculateMonthlyVAT(organizationId, period);
  const annual = await buildAnnualSummary(organizationId, Number(period.slice(0, 4)));
  return {
    organization: org,
    period,
    totalIncome,
    totalExpenses,
    profit: totalIncome - totalExpenses,
    vatDue: vat.netVAT,
    vat,
    invoiceCount: incomeInvoices.length,
    activeClientCount: new Set(incomeInvoices.map((invoice) => invoice.clientId)).size,
    incomeInvoices,
    expenses: categorizedExpenses,
    reports,
    annual,
  };
}

export async function generateAccountantReport(organizationId: string, period = previousMonth()) {
  const summary = await buildAccountantSummary(organizationId, period);
  const pdf = await generatePdf(summary);
  let driveUrl: string | null = null;
  try {
    driveUrl = await saveAccountantReportToDrive(organizationId, period, pdf);
    await updateAccountantSheet(organizationId, period, summary);
  } catch (err) {
    console.error("[accountantReports] Drive/Sheets update failed", err);
  }
  await upsertAccountantReport(organizationId, period, {
    totalIncome: summary.totalIncome,
    totalExpenses: summary.totalExpenses,
    profit: summary.profit,
    vatDue: summary.vatDue,
    driveUrl,
  });
  return { ...summary, driveUrl };
}

export async function getAccountantReports(organizationId: string) {
  return prisma.$queryRawUnsafe<Array<{ id: string; period: string; totalIncome: number; totalExpenses: number; profit: number; vatDue: number; driveUrl: string | null; sentAt: Date | null; createdAt: Date }>>(
    'SELECT "id", "period", "totalIncome", "totalExpenses", "profit", "vatDue", "driveUrl", "sentAt", "createdAt" FROM "AccountantReport" WHERE "organizationId" = $1 ORDER BY "period" DESC',
    organizationId
  );
}

export async function getAccountantSettings(organizationId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    'SELECT "accountantEmail", "accountantName", "businessName", "businessId", "businessAddress", "sendMonthlyReport", "reportDay" FROM "Organization" WHERE "id" = $1 LIMIT 1',
    organizationId
  );
  return rows[0] ?? {};
}

export async function updateAccountantSettings(organizationId: string, data: Record<string, unknown>) {
  await prisma.$executeRawUnsafe(
    'UPDATE "Organization" SET "accountantEmail"=$1, "accountantName"=$2, "businessName"=$3, "businessId"=$4, "businessAddress"=$5, "sendMonthlyReport"=$6, "reportDay"=$7 WHERE "id"=$8',
    stringOrNull(data.accountantEmail),
    stringOrNull(data.accountantName),
    stringOrNull(data.businessName),
    stringOrNull(data.businessId),
    stringOrNull(data.businessAddress),
    Boolean(data.sendMonthlyReport ?? true),
    Math.max(1, Math.min(28, Number(data.reportDay ?? 1))),
    organizationId
  );
  return getAccountantSettings(organizationId);
}

export function accountantZipBuffer(summary: AccountantSummary) {
  const content = [
    `דוחות רואה חשבון ${summary.period}`,
    `הכנסות: ${summary.totalIncome}`,
    `הוצאות: ${summary.totalExpenses}`,
    `רווח: ${summary.profit}`,
    `מע"מ לתשלום: ${summary.vatDue}`,
    "",
    "דוחות Drive:",
    ...summary.reports.map((report) => `${report.period}: ${report.driveUrl ?? "-"}`),
  ].join("\n");
  return Buffer.from(content, "utf8");
}

async function generatePdf(summary: AccountantSummary) {
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ margin: 48 });
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  doc.fontSize(20).text(`Accountant Report ${summary.period}`);
  doc.moveDown().fontSize(12).text(`Business: ${summary.organization?.name ?? ""}`);
  doc.text(`Income: ${summary.totalIncome.toLocaleString("he-IL")} ILS`);
  doc.text(`Expenses: ${summary.totalExpenses.toLocaleString("he-IL")} ILS`);
  doc.text(`Profit: ${summary.profit.toLocaleString("he-IL")} ILS`);
  doc.addPage().fontSize(16).text("Income").fontSize(10);
  for (const invoice of summary.incomeInvoices) doc.text(`${invoice.date.toISOString().slice(0, 10)} ${invoice.client.name} ${invoice.amount}`);
  doc.addPage().fontSize(16).text("Expenses").fontSize(10);
  for (const expense of summary.expenses) doc.text(`${expense.date.toISOString().slice(0, 10)} ${expense.supplier} ${expense.accounting.category} ${expense.amount}`);
  doc.addPage().fontSize(16).text("VAT").fontSize(12);
  doc.text(`Sales VAT: ${summary.vat.salesVAT}`);
  doc.text(`Purchase VAT: ${summary.vat.purchaseVAT}`);
  doc.text(`Net VAT: ${summary.vat.netVAT}`);
  doc.text(`Due: ${summary.vat.dueDate}`);
  doc.end();
  return done;
}

async function saveAccountantReportToDrive(organizationId: string, period: string, pdf: Buffer) {
  const { drive } = await getGoogleClients(organizationId);
  const root = await ensureDriveFolder(drive, ROOT_FOLDER);
  const [year, month] = period.split("-");
  const yearFolder = await ensureDriveFolder(drive, year, root);
  const monthFolder = await ensureDriveFolder(drive, `${month} - ${MONTHS[Number(month) - 1]}`, yearFolder);
  await ensureDriveFolder(drive, "הכנסות", monthFolder);
  await ensureDriveFolder(drive, "הוצאות", monthFolder);
  const reportsFolder = await ensureDriveFolder(drive, "דוחות", monthFolder);
  const upload = await drive.files.create({
    requestBody: { name: `דוח_${safeFolderName(MONTHS[Number(month) - 1])}_${year}.pdf`, parents: [reportsFolder] },
    media: { mimeType: "application/pdf", body: Readable.from(pdf) },
    fields: "id, webViewLink",
  });
  return upload.data.webViewLink ?? (upload.data.id ? `https://drive.google.com/file/d/${upload.data.id}/view` : null);
}

async function updateAccountantSheet(organizationId: string, period: string, summary: AccountantSummary) {
  const { sheets } = await getGoogleClients(organizationId);
  const spreadsheet = await sheets.spreadsheets.create({ requestBody: { properties: { title: `דוחות רואה חשבון ${period.slice(0, 4)}` } }, fields: "spreadsheetId" });
  const spreadsheetId = spreadsheet.data.spreadsheetId;
  if (!spreadsheetId) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Sheet1!A1:G2",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["חודש", "סהכ הכנסות", "סהכ הוצאות", "רווח גולמי", "מעמ לתשלום", "מספר חשבוניות", "לקוחות פעילים"], [period, summary.totalIncome, summary.totalExpenses, summary.profit, summary.vatDue, summary.invoiceCount, summary.activeClientCount]] },
  });
}

async function upsertAccountantReport(organizationId: string, period: string, input: { totalIncome: number; totalExpenses: number; profit: number; vatDue: number; driveUrl: string | null }) {
  await prisma.$executeRawUnsafe(
    'INSERT INTO "AccountantReport" ("id","organizationId","period","totalIncome","totalExpenses","profit","vatDue","driveUrl") VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT ("organizationId","period") DO UPDATE SET "totalIncome"=$4,"totalExpenses"=$5,"profit"=$6,"vatDue"=$7,"driveUrl"=$8',
    `acct_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    organizationId,
    period,
    input.totalIncome,
    input.totalExpenses,
    input.profit,
    input.vatDue,
    input.driveUrl
  );
}

async function buildAnnualSummary(organizationId: string, year: number) {
  const rows = [];
  for (let month = 1; month <= 12; month += 1) {
    const period = `${year}-${String(month).padStart(2, "0")}`;
    const { start, end } = monthRange(period);
    const [income, expenses] = await Promise.all([
      prisma.invoice.aggregate({ where: { organizationId, date: { gte: start, lte: end } }, _sum: { amount: true } }),
      prisma.supplierPayment.aggregate({ where: { organizationId, date: { gte: start, lte: end } }, _sum: { amount: true } }),
    ]);
    rows.push({ period, income: income._sum.amount ?? 0, expenses: expenses._sum.amount ?? 0 });
  }
  return rows;
}

function currentMonth() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
