import { answerBusinessQuestionWithClaude, type NatalieClaudeResponse } from "./claude.js";
import { getDashboardStats } from "./dashboard.js";
import { findTasksByPartialTitle } from "./tasks.js";
import { prisma } from "../lib/prisma.js";

export async function askNatalieBusinessQuestion(input: {
  organizationId: string;
  question: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<NatalieClaudeResponse> {
  const completeTaskResponse = await maybeBuildCompleteTaskProposal(input.organizationId, input.question);
  if (completeTaskResponse) return completeTaskResponse;

  const [stats, richerContext] = await Promise.all([
    getDashboardStats(input.organizationId),
    getNatalieBusinessContext(input.organizationId).catch((err) => {
      console.warn("[natalie] richer business context failed", err instanceof Error ? err.message : String(err));
      return {};
    }),
  ]);

  return answerBusinessQuestionWithClaude({
    question: input.question,
    history: input.history,
    businessContext: {
      dashboardStats: stats,
      richerBusinessData: richerContext,
    },
  });
}

async function maybeBuildCompleteTaskProposal(organizationId: string, question: string): Promise<NatalieClaudeResponse | null> {
  const title = extractCompleteTaskTitle(question);
  if (!title) return null;

  const matches = await findTasksByPartialTitle({
    organizationId,
    title,
    status: "open",
    limit: 5,
  });

  if (matches.length === 0) {
    return { answer: `לא מצאתי משימה פתוחה שמתאימה ל־"${title}".` };
  }

  if (matches.length > 1) {
    const list = matches.map((task, index) => `${index + 1}. ${task.title}`).join("\n");
    return { answer: `מצאתי כמה משימות פתוחות שמתאימות ל־"${title}":\n${list}\nאיזו מהן לסמן כבוצעה?` };
  }

  const task = matches[0];
  return {
    action: "complete_task",
    proposal: {
      taskId: task.id,
      title: task.title,
    },
    answer: `מצאתי את המשימה "${task.title}". לסמן אותה כבוצעה?`,
  };
}

function extractCompleteTaskTitle(question: string) {
  const quotedTitle = question.match(/["'״׳](.+?)["'״׳]/)?.[1]?.trim();
  if (quotedTitle && isCompleteTaskRequest(question)) return quotedTitle;
  if (!isCompleteTaskRequest(question)) return "";

  return question
    .replace(/^(נטלי\s*,?\s*)?/i, "")
    .replace(/(בבקשה|נא)/g, "")
    .replace(/(תסמני|סמני|לסמן|תסגרי|סגרי|לסגור|תשלימי|השלימי|להשלים|mark|complete|close)/gi, "")
    .replace(/(את|המשימה|משימה|task)/gi, "")
    .replace(/(כבוצעה|כבוצע|בוצעה|בוצע|כהושלמה|כהושלם|להושלמה|להושלם|done|completed|closed)$/gi, "")
    .replace(/[.?!؟,،]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCompleteTaskRequest(question: string) {
  const hasActionVerb = /(תסמני|סמני|לסמן|תסגרי|סגרי|לסגור|תשלימי|השלימי|להשלים|mark|complete|close)/i.test(question);
  const hasCompletionMarker = /(כ?בוצע|כ?בוצעה|הושל|הושלמה|done|completed|closed)/i.test(question);
  const mentionsTask = /(משימה|task)/i.test(question);
  return hasActionVerb || (hasCompletionMarker && mentionsTask);
}

async function getNatalieBusinessContext(organizationId: string) {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [invoices, supplierPayments, customerInvoices] = await Promise.all([
    prisma.invoice.findMany({
      where: { organizationId },
      select: { amount: true, status: true, date: true },
    }),
    prisma.supplierPayment.findMany({
      where: { organizationId, approvalStatus: "approved" },
      select: {
        supplier: true,
        supplierName: true,
        amount: true,
        date: true,
        dueDate: true,
        paid: true,
        paymentRequired: true,
      },
    }),
    prisma.customerInvoice.findMany({
      where: { organizationId },
      select: {
        customer: true,
        amount: true,
        issueDate: true,
        dueDate: true,
        paid: true,
      },
    }),
  ]);

  const invoicesThisMonth = invoices.filter((invoice) => isInRange(invoice.date, thisMonthStart, nextMonthStart));
  const invoicesLastMonth = invoices.filter((invoice) => isInRange(invoice.date, lastMonthStart, thisMonthStart));
  const customerInvoicesThisMonth = customerInvoices.filter((invoice) => isInRange(invoice.issueDate, thisMonthStart, nextMonthStart));
  const openCustomerInvoices = customerInvoices.filter((invoice) => !invoice.paid);
  const openSupplierPayments = supplierPayments.filter((payment) => !payment.paid && payment.paymentRequired && isReasonableMoneyAmount(payment.amount));

  return {
    labels: {
      invoicesThisMonth: "מספר חשבוניות החודש",
      invoicesLastMonth: "מספר חשבוניות בחודש שעבר",
      invoiceAmountThisMonth: "סכום חשבוניות החודש",
      invoiceAmountLastMonth: "סכום חשבוניות בחודש שעבר",
      moneyToReceiveThisMonth: "סכום לגבייה מחשבוניות לקוח שהופקו החודש",
      overdueReceivablesAmount: "סכום גבייה באיחור",
      moneyToPayThisMonth: "סכום תשלומי ספקים פתוחים החודש",
      moneyToPayNext7Days: "סכום תשלומי ספקים לתשלום בשבעת הימים הקרובים",
      topSuppliersByOpenDebt: "חמשת הספקים עם החוב הפתוח הגבוה ביותר",
      topCustomersByOpenDebt: "חמשת הלקוחות עם החוב הפתוח הגבוה ביותר",
      invoiceCountsByStatus: "ספירת חשבוניות לפי סטטוס",
    },
    invoicesThisMonth: invoicesThisMonth.length,
    invoicesLastMonth: invoicesLastMonth.length,
    invoiceAmountThisMonth: sumAmounts(invoicesThisMonth),
    invoiceAmountLastMonth: sumAmounts(invoicesLastMonth),
    moneyToReceiveThisMonth: sumAmounts(customerInvoicesThisMonth.filter((invoice) => !invoice.paid)),
    overdueReceivablesAmount: sumAmounts(openCustomerInvoices.filter((invoice) => invoice.dueDate && invoice.dueDate < now)),
    moneyToPayThisMonth: sumAmounts(openSupplierPayments.filter((payment) => isInRange(payment.date, thisMonthStart, nextMonthStart))),
    moneyToPayNext7Days: sumAmounts(openSupplierPayments.filter((payment) => payment.dueDate && payment.dueDate >= now && payment.dueDate <= next7Days)),
    topSuppliersByOpenDebt: topDebts(
      openSupplierPayments,
      (payment) => payment.supplierName?.trim() || payment.supplier.trim() || "ספק לא ידוע"
    ),
    topCustomersByOpenDebt: topDebts(openCustomerInvoices, (invoice) => invoice.customer.trim() || "לקוח לא ידוע"),
    invoiceCountsByStatus: countBy(invoices, (invoice) => invoice.status || "unknown"),
  };
}

function isInRange(date: Date, start: Date, end: Date) {
  return date >= start && date < end;
}

function isReasonableMoneyAmount(amount: number) {
  return Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000;
}

function sumAmounts(items: Array<{ amount: number }>) {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

function countBy<T>(items: T[], keyFor: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function topDebts<T extends { amount: number }>(items: T[], keyFor: (item: T) => string) {
  const totals = items.reduce<Record<string, { name: string; amount: number; count: number }>>((acc, item) => {
    const name = keyFor(item);
    acc[name] = acc[name] ?? { name, amount: 0, count: 0 };
    acc[name].amount += item.amount;
    acc[name].count += 1;
    return acc;
  }, {});

  return Object.values(totals)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
}
