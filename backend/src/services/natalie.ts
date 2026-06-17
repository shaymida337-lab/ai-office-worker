import { answerBusinessQuestionWithClaude, type NatalieClaudeResponse } from "./claude.js";
import { getDashboardStats } from "./dashboard.js";
import { findTasksByPartialTitle } from "./tasks.js";
import { prisma } from "../lib/prisma.js";

export async function askNatalieBusinessQuestion(input: {
  organizationId: string;
  question: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<NatalieClaudeResponse> {
  const showInvoiceResponse = await maybeBuildShowInvoiceResponse(input.organizationId, input.question);
  if (showInvoiceResponse) return showInvoiceResponse;

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

async function maybeBuildShowInvoiceResponse(organizationId: string, question: string): Promise<NatalieClaudeResponse | null> {
  console.log("[SHOW_INVOICE_DEBUG] incoming", { organizationId, question });
  const supplierName = extractShowInvoiceSearchTerm(question);
  console.log("[SHOW_INVOICE_DEBUG] extracted supplierName", { supplierName });
  if (!supplierName) return null;

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { businessProfile: true },
  });
  const searchTerms = expandInvoiceSearchTerms(supplierName, organization?.businessProfile);
  console.log("[SHOW_INVOICE_DEBUG] searchTerms", { searchTerms });
  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId,
      OR: searchTerms.flatMap((term) => [
        { supplierName: { contains: term, mode: "insensitive" as const } },
        { invoiceNumber: { contains: term, mode: "insensitive" as const } },
      ]),
    },
    select: {
      id: true,
      supplierName: true,
      invoiceNumber: true,
      amount: true,
      currency: true,
      date: true,
      dueDate: true,
      status: true,
      driveUrl: true,
      driveFileUrl: true,
      gmailMessageId: true,
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  console.log("[SHOW_INVOICE_DEBUG] invoices returned", {
    count: invoices.length,
    supplierNames: invoices.map((invoice) => invoice.supplierName),
  });

  if (invoices.length === 0) {
    return { answer: `לא מצאתי חשבונית קיימת שמתאימה ל־"${supplierName}".` };
  }

  const missingDriveInvoiceGmailIds = Array.from(new Set(
    invoices
      .filter((invoice) => !selectNatalieInvoiceDriveUrl(invoice) && invoice.gmailMessageId)
      .map((invoice) => invoice.gmailMessageId!)
  ));
  const paymentDriveFallbackByInvoiceKey = new Map<string, { link: string | null; ambiguous: boolean }>();
  const invoicePaymentDriveFallbackKey = (gmailMessageId: string | null | undefined, amount: number | null | undefined) => {
    const normalizedAmount = Number(amount);
    return gmailMessageId && Number.isFinite(normalizedAmount) ? `${gmailMessageId}:${normalizedAmount.toFixed(2)}` : null;
  };
  if (missingDriveInvoiceGmailIds.length > 0) {
    const emailMessagesForDriveFallback = await prisma.emailMessage.findMany({
      where: {
        organizationId,
        gmailId: { in: missingDriveInvoiceGmailIds },
      },
      select: { id: true, gmailId: true },
    });
    const gmailIdByEmailMessageId = new Map(emailMessagesForDriveFallback.map((email) => [email.id, email.gmailId]));
    const emailMessageIds = emailMessagesForDriveFallback.map((email) => email.id);
    const supplierPaymentsWithDrive = emailMessageIds.length > 0
      ? await prisma.supplierPayment.findMany({
          where: {
            organizationId,
            emailMessageId: { in: emailMessageIds },
            OR: [
              { driveFileUrl: { not: null } },
              { invoiceLink: { not: null } },
              { documentLink: { not: null } },
            ],
          },
          select: {
            emailMessageId: true,
            amount: true,
            driveFileUrl: true,
            invoiceLink: true,
            documentLink: true,
          },
        })
      : [];
    for (const payment of supplierPaymentsWithDrive) {
      const gmailMessageId = payment.emailMessageId ? gmailIdByEmailMessageId.get(payment.emailMessageId) : null;
      const fallbackKey = invoicePaymentDriveFallbackKey(gmailMessageId, Number(payment.amount));
      const link = payment.driveFileUrl ?? payment.invoiceLink ?? payment.documentLink ?? null;
      if (!fallbackKey || !link) continue;
      const existing = paymentDriveFallbackByInvoiceKey.get(fallbackKey);
      paymentDriveFallbackByInvoiceKey.set(fallbackKey, existing ? { link: null, ambiguous: true } : { link, ambiguous: false });
    }
  }

  const first = invoices[0];
  return {
    action: "show_invoice",
    invoices: invoices.map((invoice) => {
      const driveUrl = selectNatalieInvoiceDriveUrl(invoice);
      const fallbackKey = driveUrl ? null : invoicePaymentDriveFallbackKey(invoice.gmailMessageId, invoice.amount);
      const fallback = fallbackKey ? paymentDriveFallbackByInvoiceKey.get(fallbackKey) : undefined;
      return {
        id: invoice.id,
        supplierName: invoice.supplierName,
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.amount,
        currency: invoice.currency,
        issueDate: invoice.date,
        dueDate: invoice.dueDate,
        status: invoice.status,
        driveUrl: driveUrl ?? (fallback && !fallback.ambiguous ? fallback.link : null),
      };
    }),
    answer:
      invoices.length === 1
        ? `מצאתי חשבונית של ${first.supplierName ?? supplierName}${first.invoiceNumber ? ` מספר ${first.invoiceNumber}` : ""}.`
        : `מצאתי ${invoices.length} חשבוניות שמתאימות ל־"${supplierName}".`,
  };
}

function extractShowInvoiceSearchTerm(question: string) {
  const quotedName = question.match(/["'״׳](.+?)["'״׳]/)?.[1]?.trim();
  if (quotedName && isShowInvoiceRequest(question)) return quotedName;
  if (!isShowInvoiceRequest(question)) return "";

  const afterOf = question.match(/(?:^|\s)של\s+(.+)$/i)?.[1];
  const candidate =
    afterOf ??
    question.replace(
      /(תראי|תראה|תוציאי|תציגי|הציגי|הראי|הראה|חפשי|חפש|מצא|מצאי|למצוא|לראות|לפתוח|להציג|חשבונית|invoice|בבקשה|נא|נטלי|לי|את|the|me|for|of)/gi,
      ""
    );

  return candidate
    .replace(/(בבקשה|נא|חשבונית|את|לי|של|invoice|the|of|for|me)/gi, "")
    .replace(/[.?!؟,،]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isShowInvoiceRequest(question: string) {
  const mentionsInvoice = /(חשבונית|invoice)/i.test(question);
  const hasShowVerb = /(תראי|תראה|הראי|הראה לי|הראה|תראה לי|תציגי|הציגי|תפתחי|פתחי|תמצאי|חפשי|להציג|לראות|לפתוח|show|open|find|search|display|תוציאי|תוציא|תציעי|תציע|תביאי|תביא)/i.test(question);
  return mentionsInvoice && hasShowVerb;
}

function expandInvoiceSearchTerms(term: string, businessProfile?: string | null) {
  const terms = new Set([term]);
  const knownAliases: Record<string, string[]> = {
    "וולט": ["Wolt"],
    wolt: ["וולט"],
  };
  for (const alias of knownAliases[term.toLowerCase()] ?? knownAliases[term] ?? []) terms.add(alias);

  for (const line of businessProfile?.split(/\r?\n/) ?? []) {
    if (!line.toLowerCase().includes(term.toLowerCase()) || !/[=:]/.test(line)) continue;
    for (const part of line.split(/[=:]/)) {
      const alias = part.trim();
      if (alias && alias.length <= 40) terms.add(alias);
    }
  }

  return [...terms].filter(Boolean);
}

export function selectNatalieInvoiceDriveUrl(input: {
  driveUrl: string | null;
  driveFileUrl?: string | null;
}) {
  return input.driveFileUrl ?? input.driveUrl ?? null;
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

  const [organization, invoices, supplierPayments, customerInvoices] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { businessProfile: true },
    }),
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
  const businessProfile = organization?.businessProfile?.trim();

  return {
    ...(businessProfile
      ? {
          businessProfile: {
            label: "מידע על העסק (זיכרון קבוע):",
            text: businessProfile,
          },
        }
      : {}),
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
