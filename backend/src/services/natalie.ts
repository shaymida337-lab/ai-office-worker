import { answerBusinessQuestionWithClaude, type NatalieClaudeResponse } from "./claude.js";
import { findTasksByPartialTitle } from "./tasks.js";
import { prisma } from "../lib/prisma.js";
import { resolveAppointmentDateTime } from "./appointmentService.js";
import { findUpcomingSchedulingForClient, findUpcomingSchedulingForOrganization, findUpcomingSchedulingForOrganizationDetailed, type UpcomingSchedulingItem } from "./scheduling/schedulingFacade.js";
import {
  formatAmbiguousCustomerMessage,
  searchSchedulingCustomers,
} from "./scheduling/schedulingCustomer.js";
import {
  extractActiveCalendarContext,
  findAmbiguousAppointmentNameMatches,
  isPronounCalendarReference,
  resolveAppointmentCustomerName,
  type ActiveCalendarContext,
  normalizeHebrewAppointmentText,
} from "./scheduling/calendarAppointmentResolver.js";
import {
  buildCalendarActionProposal,
  formatAmbiguousAppointmentMessage,
} from "./scheduling/calendarActionProposal.js";
import { maybeBuildAvailabilityResponse } from "./natalieAvailability.js";
import { resolveFinanceDisplayAmount } from "./amount/financeDisplayAmount.js";
import {
  parseCalendarIntent,
  parseHebrewTime,
  validateExtraction,
  extractDayReference as extractCalendarDayReference,
  type CalendarIntentExtraction,
  type CalendarListRange,
} from "./calendar/calendarIntentParser.js";
import { calendarMessages } from "./calendar/calendarMessages.js";
import type { CalendarPendingIntent } from "./calendar/calendarPendingIntent.js";
import {
  buildLastListedAppointmentsPendingAction,
  parseListedAppointmentOrdinalCommand,
  readLastListedAppointments,
  resolveListedAppointmentByOrdinal,
} from "./conversation/lastListedAppointments.js";
import { parseBusinessMemoryIntent } from "./businessMemory/businessMemoryIntentParser.js";
import { runBusinessMemoryLookup } from "./businessMemory/businessMemorySearchService.js";
import { businessMemoryMessages } from "./businessMemory/businessMemoryMessages.js";
import { shouldDeferCalendarClarificationToSession } from "./conversation/calendarConversationState.js";
import { findBestAvailableSlotForOrganization } from "./calendar/availability.js";
import { isBestAvailablePhrase, parseSlotTimeConstraints } from "./calendar/slotRanking.js";

/** Injectable dependencies for deterministic testing of the Natalie brain. */
export type AskNatalieDeps = {
  askClaude?: typeof answerBusinessQuestionWithClaude;
  loadTimezone?: (organizationId: string) => Promise<string>;
  now?: Date;
};

const SHOW_INVOICE_DEBUG = process.env.NATALIE_SHOW_INVOICE_DEBUG === "true";

function logShowInvoiceDebug(label: string, payload: Record<string, unknown>) {
  if (SHOW_INVOICE_DEBUG) {
    console.log(`[SHOW_INVOICE_DEBUG] ${label}`, payload);
  }
}

type ShowInvoiceItem = {
  id: string;
  supplierName: string | null;
  invoiceNumber: string | null;
  amount: number | null;
  amountLabel: string;
  currency: string;
  issueDate: Date;
  dueDate: Date | null;
  status: string;
  driveUrl: string | null;
  pendingReview?: boolean;
};

export async function askNatalieBusinessQuestion(input: {
  organizationId: string;
  question: string;
  requestId?: string | null;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  conversationContext?: {
    pendingAction?: { action: string; proposal: Record<string, unknown> } | null;
    structuredHistory?: Array<{
      role: "user" | "assistant";
      content: string;
      action?: string | null;
      proposal?: Record<string, unknown> | null;
    }>;
  };
}, deps?: AskNatalieDeps): Promise<NatalieClaudeResponse> {
  // Deterministic Hebrew create handler runs FIRST so booking commands never
  // reach Claude (no invented names, no defaulted times, no context bleed).
  const createAppointmentResponse = await maybeBuildCreateAppointmentProposal(
    input.organizationId,
    input.question,
    deps
  );
  if (createAppointmentResponse) return createAppointmentResponse;

  // Deterministic read handler: "מה יש לי מחר ביומן?" / "מה התורים שלי?" never
  // reaches Claude and always reads the unified appointment source of truth.
  const listAppointmentsResponse = await maybeBuildListAppointmentsResponse(
    input.organizationId,
    input.question,
    deps,
    input.requestId ?? null
  );
  if (listAppointmentsResponse) return listAppointmentsResponse;

  const listedFollowUpResponse = await maybeBuildListedAppointmentFollowUp(
    input.organizationId,
    input.question,
    input.conversationContext,
    deps
  );
  if (listedFollowUpResponse) return listedFollowUpResponse;

  // Calendar clarifications are persisted via calendarConversationState slot filling
  // in conversationCalendarContinuation — never answer-only here.

  // Deterministic Reliability Center status: "מה מצב המערכת?" summarizes
  // persistent reliability health for owners/admins before Claude.
  const { maybeBuildReliabilityStatusResponse } = await import(
    "./reliability/center/reliabilityNatalieSummary.js"
  );
  const reliabilityStatusResponse = await maybeBuildReliabilityStatusResponse(
    input.organizationId,
    input.question
  );
  if (reliabilityStatusResponse) return reliabilityStatusResponse;

  // Deterministic Business Memory lookup: "תפתחי לי את החוזה של שרית" /
  // "כמה מסמכים יש לי" resolve against the unified org-isolated repository
  // and never reach Claude. One engine, shared by chat/voice/WhatsApp.
  const businessMemoryResponse = await maybeBuildBusinessMemoryLookupResponse(
    input.organizationId,
    input.question
  );
  if (businessMemoryResponse) return businessMemoryResponse;

  const businessFactsResponse = await maybeBuildBusinessFactsResponse(input.organizationId, input.question);
  if (businessFactsResponse) return businessFactsResponse;

  const showInvoiceResponse = await maybeBuildShowInvoiceResponse(input.organizationId, input.question);
  if (showInvoiceResponse) return showInvoiceResponse;

  const completeTaskResponse = await maybeBuildCompleteTaskProposal(input.organizationId, input.question);
  if (completeTaskResponse) return completeTaskResponse;

  const availabilityResponse = await maybeBuildAvailabilityResponse(input.organizationId, input.question, {
    requestId: input.requestId ?? null,
  });
  if (availabilityResponse) return availabilityResponse;

  const calendarContext = extractActiveCalendarContext({
    history: input.conversationContext?.structuredHistory ?? input.history?.map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    pendingAction: input.conversationContext?.pendingAction ?? null,
  });

  const rescheduleAppointmentResponse = await maybeBuildRescheduleAppointmentProposal(
    input.organizationId,
    input.question,
    calendarContext
  );
  if (rescheduleAppointmentResponse) return rescheduleAppointmentResponse;

  const cancelAppointmentResponse = await maybeBuildCancelAppointmentProposal(
    input.organizationId,
    input.question,
    calendarContext
  );
  if (cancelAppointmentResponse) return cancelAppointmentResponse;

  const conversationalResponse = maybeBuildConversationalResponse(input.question);
  if (conversationalResponse) return conversationalResponse;

  const [stats, richerContext] = await Promise.all([
    getNatalieAskDashboardSnapshot(input.organizationId),
    getNatalieBusinessContext(input.organizationId).catch((err) => {
      console.warn("[natalie] richer business context failed", err instanceof Error ? err.message : String(err));
      return {};
    }),
  ]);

  const askClaude = deps?.askClaude ?? answerBusinessQuestionWithClaude;
  return askClaude({
    question: input.question,
    history: input.history,
    businessContext: {
      dashboardStats: stats,
      richerBusinessData: richerContext,
    },
  });
}

/**
 * Deterministic Business Memory handler. Returns a Natalie answer when the
 * message is a supported document lookup, otherwise null so the dispatch chain
 * continues. Read-only and organization-isolated.
 */
async function maybeBuildBusinessMemoryLookupResponse(
  organizationId: string,
  question: string
): Promise<NatalieClaudeResponse | null> {
  const extraction = parseBusinessMemoryIntent(question);
  if (extraction.intent !== "business_memory_lookup") return null;
  try {
    const lookup = await runBusinessMemoryLookup({ organizationId, text: question, extraction });
    return { answer: lookup.message };
  } catch (err) {
    console.warn(
      "[natalie] business memory lookup failed",
      err instanceof Error ? err.message : String(err)
    );
    return { answer: businessMemoryMessages.processingError() };
  }
}

/** Hebrew day-reference → user-facing label for the confirmation template. */
function formatCreateDayLabel(dayReference: string | null): string {
  if (!dayReference) return "";
  return dayReference;
}

/** One short, clean, templated clarification — never free LLM text, never guessed values. */
function buildCreateClarification(extraction: CalendarIntentExtraction): string {
  const who = extraction.customerName ? ` ל${extraction.customerName}` : "";
  if (extraction.missingFields.includes("customerName")) {
    return calendarMessages.createMissingCustomer();
  }
  if (extraction.missingFields.includes("time")) {
    return calendarMessages.createMissingTime(who);
  }
  if (extraction.missingFields.includes("date")) {
    return calendarMessages.createMissingDate(who);
  }
  return calendarMessages.createUnclear();
}

/**
 * Pure builder: turn a deterministic calendar extraction into a booking proposal
 * (or a templated clarification). Never returns a booking when values are
 * uncertain, incomplete, or fail the noise/name safety guard.
 */
export function buildCreateAppointmentResponse(
  extraction: CalendarIntentExtraction
): NatalieClaudeResponse | null {
  if (extraction.intent !== "create_appointment") return null;

  const validation = validateExtraction(extraction);
  const uncertain =
    !validation.valid ||
    extraction.confidence !== "high" ||
    extraction.missingFields.length > 0 ||
    !extraction.customerName ||
    !extraction.dayReference ||
    !extraction.time;

  if (uncertain) {
    return { answer: buildCreateClarification(extraction) };
  }

  const dayLabel = formatCreateDayLabel(extraction.dayReference);
  return {
    action: "book_appointment",
    proposal: {
      clientName: extraction.customerName!,
      dayReference: extraction.dayReference!,
      time: extraction.time!,
      ...(extraction.durationMinutes ? { durationMinutes: extraction.durationMinutes } : {}),
    },
    answer: calendarMessages.createConfirmation(extraction.customerName!, dayLabel, extraction.time!),
  };
}

async function maybeBuildCreateAppointmentProposal(
  organizationId: string,
  question: string,
  deps?: AskNatalieDeps
): Promise<NatalieClaudeResponse | null> {
  // Cheap, DB-free intent gate: only act on explicit create commands.
  const preview = parseCalendarIntent(question, { now: deps?.now });
  if (preview.intent !== "create_appointment") return null;

  const loadTimezone = deps?.loadTimezone ?? loadOrganizationTimezone;
  const timeZone = await loadTimezone(organizationId);
  let extraction = parseCalendarIntent(question, { timeZone, now: deps?.now });

  if (
    isBestAvailablePhrase(question) &&
    extraction.customerName &&
    extraction.dayReference &&
    !extraction.time
  ) {
    const best = await findBestAvailableSlotForOrganization({
      organizationId,
      dayReference: extraction.dayReference,
      timeConstraints: parseSlotTimeConstraints(question),
      now: deps?.now,
    });
    if (best) {
      extraction = {
        ...extraction,
        time: best.time,
        missingFields: extraction.missingFields.filter((field) => field !== "time"),
        confidence:
          extraction.customerName && extraction.dayReference ? "high" : extraction.confidence,
      };
    }
  }

  if (shouldDeferCalendarClarificationToSession(extraction)) return null;
  return buildCreateAppointmentResponse(extraction);
}

async function maybeBuildShowInvoiceResponse(organizationId: string, question: string): Promise<NatalieClaudeResponse | null> {
  logShowInvoiceDebug("incoming", { organizationId, question });
  const supplierName = extractShowInvoiceSearchTerm(question);
  logShowInvoiceDebug("extracted supplierName", { supplierName });
  if (!supplierName) return null;

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { businessProfile: true },
  });
  const searchTerms = expandInvoiceSearchTerms(supplierName, organization?.businessProfile);
  logShowInvoiceDebug("searchTerms", { searchTerms });
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
  const remainingSupplierPaymentSlots = Math.max(0, 5 - invoices.length);
  const supplierPayments = remainingSupplierPaymentSlots > 0
    ? await prisma.supplierPayment.findMany({
        where: {
          organizationId,
          OR: searchTerms.flatMap((term) => [
            { supplier: { contains: term, mode: "insensitive" as const } },
            { supplierName: { contains: term, mode: "insensitive" as const } },
            { invoiceNumber: { contains: term, mode: "insensitive" as const } },
          ]),
        },
        select: {
          id: true,
          supplier: true,
          supplierName: true,
          invoiceNumber: true,
          amount: true,
          currency: true,
          date: true,
          dueDate: true,
          paid: true,
          driveFileUrl: true,
          invoiceLink: true,
          documentLink: true,
        },
        orderBy: { createdAt: "desc" },
        take: remainingSupplierPaymentSlots,
      })
    : [];
  const remainingFinancialDocumentReviewSlots = Math.max(0, 5 - invoices.length - supplierPayments.length);
  const financialDocumentReviews = remainingFinancialDocumentReviewSlots > 0
    ? await prisma.financialDocumentReview.findMany({
        where: {
          organizationId,
          reviewStatus: "needs_review",
          documentType: { in: ["tax_invoice", "receipt", "tax_invoice_receipt"] },
          OR: searchTerms.flatMap((term) => [
            { supplierName: { contains: term, mode: "insensitive" as const } },
            { invoiceNumber: { contains: term, mode: "insensitive" as const } },
          ]),
        },
        select: {
          id: true,
          supplierName: true,
          invoiceNumber: true,
          totalAmount: true,
          currency: true,
          documentDate: true,
          dueDate: true,
          driveFileUrl: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: remainingFinancialDocumentReviewSlots,
      })
    : [];
  logShowInvoiceDebug("invoices returned", {
    count: invoices.length,
    supplierNames: invoices.map((invoice) => invoice.supplierName),
  });
  logShowInvoiceDebug("supplier payments returned", {
    count: supplierPayments.length,
    supplierNames: supplierPayments.map((payment) => payment.supplierName ?? payment.supplier),
  });
  logShowInvoiceDebug("financial document reviews returned", {
    count: financialDocumentReviews.length,
    supplierNames: financialDocumentReviews.map((review) => review.supplierName),
  });

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

  const invoiceItems = invoices.map((invoice) => {
    const driveUrl = selectNatalieInvoiceDriveUrl(invoice);
    const fallbackKey = driveUrl ? null : invoicePaymentDriveFallbackKey(invoice.gmailMessageId, invoice.amount);
    const fallback = fallbackKey ? paymentDriveFallbackByInvoiceKey.get(fallbackKey) : undefined;
    const display = resolveFinanceDisplayAmount({
      totalAmount: invoice.amount,
      currency: invoice.currency,
    });
    return {
      id: invoice.id,
      supplierName: invoice.supplierName,
      invoiceNumber: invoice.invoiceNumber,
      amount: display.amount,
      amountLabel: display.amountLabel,
      currency: invoice.currency,
      issueDate: invoice.date,
      dueDate: invoice.dueDate,
      status: invoice.status,
      driveUrl: driveUrl ?? (fallback && !fallback.ambiguous ? fallback.link : null),
    };
  });
  const showInvoiceItems = mergeShowInvoiceItems(
    mergeShowInvoiceItems(invoiceItems, supplierPayments.map(mapSupplierPaymentToShowInvoiceItem), 5),
    financialDocumentReviews.map(mapFinancialDocumentReviewToShowInvoiceItem),
    5,
  );
  if (showInvoiceItems.length === 0) {
    return { answer: `לא מצאתי חשבונית קיימת שמתאימה ל־"${supplierName}".` };
  }

  const first = showInvoiceItems[0];
  return {
    action: "show_invoice",
    invoices: showInvoiceItems,
    answer: buildShowInvoiceAnswer(showInvoiceItems, supplierName, first),
  };
}

export function extractShowInvoiceSearchTerm(question: string) {
  if (!isShowInvoiceRequest(question)) return "";

  const supplier = extractSupplierSearchTerm(question);
  if (supplier) return supplier;

  const candidate = question.replace(
    /(תראי|תראה|תוציאי|תוציא|תציגי|תציג|הציגי|הראי|הראה|חפשי|חפש|מצא לי|מצא|מצאי|למצוא|לראות|לפתוח|להציג|חשבוניות|חשבונית|קבלות|קבלה|invoices?|receipts?|בבקשה|נא|נטלי|לי|את|the|me|for|of|show|open|find|search|display|latest|אחרונה|האחרונה|החדשה|החדש ביותר)/gi,
    ""
  );

  return candidate
    .replace(/(בבקשה|נא|חשבוניות|חשבונית|קבלות|קבלה|invoices?|receipts?|את|לי|של|מספק|ספק|invoice|the|of|for|me|show|open|find|search|display|latest|אחרונה|האחרונה|החדשה|החדש ביותר)/gi, "")
    .replace(/[.?!؟,،]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractSupplierSearchTerm(question: string): string {
  const quotedName = question.match(/["'״׳](.+?)["'״׳]/)?.[1]?.trim();
  if (quotedName) return normalizeSupplierSearchTerm(quotedName);

  const patterns = [
    /(?:^|\s)של\s+(.+?)[?.!]?$/i,
    /(?:^|\s)מספק\s+(.+?)[?.!]?$/i,
    /\sמ(?!ה(?:חשבונית|\s))([^\s?.,]+)/i,
    /ל(?!י(?:\s|[?.!]|$))([^\s?.,]+?)(?:\s+(?:החודש|השנה|בחודש|בשנה))?(?:[?.!]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = question.match(pattern);
    const raw = match?.[1]?.trim();
    if (!raw) continue;
    const normalized = normalizeSupplierSearchTerm(raw);
    if (normalized) return normalized;
  }

  return "";
}

function normalizeSupplierSearchTerm(term: string): string {
  return term
    .replace(/[?.!,،]+/g, "")
    .replace(/\s+(החודש|השנה|בחודש|בשנה)$/i, "")
    .replace(/^(ה|את|האחרונה|הכי יקרה)$/i, "")
    .trim();
}

export function isShowInvoiceRequest(question: string) {
  if (/כמה\s+/i.test(question)) return false;
  if (/מה\s+החשבונית/i.test(question)) return false;

  const mentionsDocument = /(חשבוניות|חשבונית|invoices?|קבלות?|קבלה|receipts?)/i.test(question);
  const hasShowVerb =
    /(תראי|תראה|הראי|הראה לי|הראה|תראה לי|תציגי|תציג|הציגי|הציג|תפתחי|פתחי|תמצאי|מצאי|מצא לי|מצא|חפשי|חפש|להציג|לראות|לפתוח|show|open|find|search|display|תוציאי|תוציא|תציעי|תציע|תביאי|תביא)/i.test(
      question
    );
  const hasOwnershipPattern = /יש\s+לי\s+(?:חשבוניות|חשבונית|קבלות?|קבלה)/i.test(question);
  return mentionsDocument && (hasShowVerb || hasOwnershipPattern);
}

async function maybeBuildBusinessFactsResponse(
  organizationId: string,
  question: string
): Promise<NatalieClaudeResponse | null> {
  const q = question.trim();
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const nextYearStart = new Date(now.getFullYear() + 1, 0, 1);
  const supplierTerm = extractSupplierSearchTerm(q);

  if (supplierTerm && isSupplierPaidAmountQuestion(q)) {
    const searchTerms = await resolveInvoiceSearchTerms(organizationId, supplierTerm);
    const range = resolvePaidAmountDateRange(q, now);
    const sum = await prisma.supplierPayment.aggregate({
      where: {
        organizationId,
        paid: true,
        date: { gte: range.start, lt: range.end },
        OR: buildSupplierPaymentSearchFilter(searchTerms),
      },
      _sum: { amount: true },
    });
    const total = sum._sum.amount ?? 0;
    return { answer: `שילמת ${formatMoney(total)} ₪ ל${supplierTerm} ${range.label}.` };
  }

  if (supplierTerm && isSupplierInvoiceCountQuestion(q)) {
    const searchTerms = await resolveInvoiceSearchTerms(organizationId, supplierTerm);
    const [invoiceCount, paymentCount, reviewCount] = await Promise.all([
      prisma.invoice.count({
        where: { organizationId, OR: buildInvoiceSearchFilter(searchTerms) },
      }),
      prisma.supplierPayment.count({
        where: { organizationId, OR: buildSupplierPaymentSearchFilter(searchTerms) },
      }),
      prisma.financialDocumentReview.count({
        where: {
          organizationId,
          reviewStatus: "needs_review",
          OR: buildInvoiceSearchFilter(searchTerms),
        },
      }),
    ]);
    const total = invoiceCount + paymentCount + reviewCount;
    return { answer: `יש לך ${total} חשבוניות של ${supplierTerm} במערכת.` };
  }

  if (supplierTerm && isSupplierHighestInvoiceQuestion(q)) {
    const searchTerms = await resolveInvoiceSearchTerms(organizationId, supplierTerm);
    const [topInvoice, topPayment] = await Promise.all([
      prisma.invoice.findFirst({
        where: { organizationId, OR: buildInvoiceSearchFilter(searchTerms) },
        orderBy: { amount: "desc" },
        select: { supplierName: true, amount: true },
      }),
      prisma.supplierPayment.findFirst({
        where: { organizationId, OR: buildSupplierPaymentSearchFilter(searchTerms) },
        orderBy: { amount: "desc" },
        select: { supplierName: true, supplier: true, amount: true },
      }),
    ]);
    const invoiceAmount = topInvoice?.amount ?? 0;
    const paymentAmount = topPayment?.amount ?? 0;
    const topAmount = Math.max(invoiceAmount, paymentAmount);
    if (!topAmount) {
      return { answer: `לא מצאתי חשבוניות של ${supplierTerm} במערכת.` };
    }
    return { answer: `החשבונית הכי יקרה של ${supplierTerm} היא ${formatMoney(topAmount)} ₪.` };
  }

  if (isPaymentCountThisMonthQuestion(q)) {
    const count = await prisma.supplierPayment.count({
      where: {
        organizationId,
        date: { gte: thisMonthStart, lt: nextMonthStart },
      },
    });
    return { answer: `יש לך ${count} תשלומי ספקים החודש.` };
  }

  if (isTotalInvoiceCountQuestion(q)) {
    const count = await prisma.invoice.count({ where: { organizationId } });
    return { answer: `יש לך ${count} חשבוניות שמורות במערכת.` };
  }

  if (isHighestSupplierQuestion(q)) {
    const top = await findHighestInvoiceSupplier(organizationId);
    if (!top) return { answer: "אין עדיין חשבוניות שמורות במערכת." };
    return { answer: `הספק עם החשבונית הגבוהה ביותר הוא ${top.name} — ${formatMoney(top.amount)} ₪.` };
  }

  if (isUnapprovedInvoicesQuestion(q)) {
    const [invoiceCount, reviewCount] = await Promise.all([
      prisma.invoice.count({
        where: { organizationId, status: "needs_review" },
      }),
      prisma.financialDocumentReview.count({
        where: { organizationId, reviewStatus: "needs_review" },
      }),
    ]);
    const total = invoiceCount + reviewCount;
    if (total === 0) return { answer: "אין כרגע חשבוניות שממתינות לאישור." };
    return { answer: `יש ${total} חשבוניות שממתינות לאישור שלך (${invoiceCount} שמורות ו-${reviewCount} מסמכים לבדיקה).` };
  }

  return null;
}

function isPaymentCountThisMonthQuestion(question: string) {
  return /כמה\s+תשלומים/i.test(question) && /(?:ה)?חודש/i.test(question);
}

function isSupplierPaidAmountQuestion(question: string) {
  return /כמה\s+שילמתי/i.test(question);
}

function isSupplierInvoiceCountQuestion(question: string) {
  return /כמה\s+חשבוניות/i.test(question) && !!extractSupplierSearchTerm(question);
}

function isSupplierHighestInvoiceQuestion(question: string) {
  return /(?:מה\s+)?החשבונית\s+הכי\s+יקר/i.test(question) && !!extractSupplierSearchTerm(question);
}

function isTotalInvoiceCountQuestion(question: string) {
  return (
    /כמה\s+חשבוניות/i.test(question) &&
    !isSupplierInvoiceCountQuestion(question) &&
    !isShowInvoiceRequest(question)
  );
}

function isHighestSupplierQuestion(question: string) {
  return /(?:מי\s+)?(?:ה)?ספק\s+הכי\s+יקר/i.test(question) || /הספק\s+הכי\s+יקר/i.test(question);
}

function isUnapprovedInvoicesQuestion(question: string) {
  return (
    /חשבוניות?.{0,24}(?:לא\s+אושרו|ממתינות|דורשות|לא\s+אושר)/i.test(question) ||
    /(?:לא\s+אושרו|ממתינות\s+לאישור)/i.test(question)
  );
}

async function findHighestInvoiceSupplier(organizationId: string) {
  const [topInvoice, topPayment] = await Promise.all([
    prisma.invoice.findFirst({
      where: { organizationId },
      orderBy: { amount: "desc" },
      select: { supplierName: true, amount: true },
    }),
    prisma.supplierPayment.findFirst({
      where: { organizationId },
      orderBy: { amount: "desc" },
      select: { supplierName: true, supplier: true, amount: true },
    }),
  ]);

  const invoiceCandidate = topInvoice
    ? { name: topInvoice.supplierName?.trim() || "ספק לא ידוע", amount: topInvoice.amount }
    : null;
  const paymentCandidate = topPayment
    ? {
        name: topPayment.supplierName?.trim() || topPayment.supplier.trim() || "ספק לא ידוע",
        amount: topPayment.amount,
      }
    : null;

  if (!invoiceCandidate) return paymentCandidate;
  if (!paymentCandidate) return invoiceCandidate;
  return paymentCandidate.amount > invoiceCandidate.amount ? paymentCandidate : invoiceCandidate;
}

function formatMoney(amount: number) {
  return Number.isFinite(amount) ? amount.toLocaleString("he-IL", { maximumFractionDigits: 2 }) : "0";
}

async function resolveInvoiceSearchTerms(organizationId: string, supplierTerm: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { businessProfile: true },
  });
  return expandInvoiceSearchTerms(supplierTerm, organization?.businessProfile);
}

function buildInvoiceSearchFilter(searchTerms: string[]) {
  return searchTerms.flatMap((term) => [
    { supplierName: { contains: term, mode: "insensitive" as const } },
    { invoiceNumber: { contains: term, mode: "insensitive" as const } },
  ]);
}

function buildSupplierPaymentSearchFilter(searchTerms: string[]) {
  return searchTerms.flatMap((term) => [
    { supplier: { contains: term, mode: "insensitive" as const } },
    { supplierName: { contains: term, mode: "insensitive" as const } },
    { invoiceNumber: { contains: term, mode: "insensitive" as const } },
  ]);
}

function resolvePaidAmountDateRange(question: string, now: Date) {
  if (/(?:ה)?שנה/i.test(question)) {
    return {
      start: new Date(now.getFullYear(), 0, 1),
      end: new Date(now.getFullYear() + 1, 0, 1),
      label: "השנה",
    };
  }
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    label: "החודש",
  };
}

export function expandInvoiceSearchTerms(term: string, businessProfile?: string | null) {
  const terms = new Set([term]);
  const knownAliases: Record<string, string[]> = {
    "וולט": ["Wolt"],
    wolt: ["וולט"],
    "פנגו": ["Pango"],
    pango: ["פנגו"],
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

export function mapFinancialDocumentReviewToShowInvoiceItem(review: {
  id: string;
  supplierName: string | null;
  invoiceNumber: string | null;
  totalAmount: number | null;
  currency: string;
  documentDate: Date | null;
  dueDate: Date | null;
  driveFileUrl: string | null;
  createdAt: Date;
  parsedFieldsJson?: unknown;
}): ShowInvoiceItem {
  const display = resolveFinanceDisplayAmount({
    totalAmount: review.totalAmount,
    parsedFieldsJson: review.parsedFieldsJson,
    currency: review.currency,
  });
  return {
    id: `financial-document-review:${review.id}`,
    supplierName: review.supplierName,
    invoiceNumber: review.invoiceNumber,
    amount: display.amount,
    amountLabel: display.amountLabel,
    currency: review.currency,
    issueDate: review.documentDate ?? review.createdAt,
    dueDate: review.dueDate,
    status: "needs_review",
    driveUrl: review.driveFileUrl,
    pendingReview: true,
  };
}

function buildShowInvoiceAnswer(showInvoiceItems: ShowInvoiceItem[], supplierName: string, first: ShowInvoiceItem) {
  if (showInvoiceItems.length === 1) {
    if (first.pendingReview) {
      return `מצאתי מסמך של ${first.supplierName ?? supplierName}${first.invoiceNumber ? ` מספר ${first.invoiceNumber}` : ""} ממתינה לאישור.`;
    }
    return `מצאתי חשבונית של ${first.supplierName ?? supplierName}${first.invoiceNumber ? ` מספר ${first.invoiceNumber}` : ""}.`;
  }

  const pendingReviewCount = showInvoiceItems.filter((item) => item.pendingReview).length;
  if (pendingReviewCount > 0) {
    return `מצאתי ${showInvoiceItems.length} חשבוניות שמתאימות ל־"${supplierName}" (${pendingReviewCount} ממתינות לאישור).`;
  }
  return `מצאתי ${showInvoiceItems.length} חשבוניות שמתאימות ל־"${supplierName}".`;
}

export function mapSupplierPaymentToShowInvoiceItem(payment: {
  id: string;
  supplier: string;
  supplierName: string | null;
  invoiceNumber: string | null;
  amount: number;
  currency: string;
  date: Date;
  dueDate: Date | null;
  paid: boolean;
  driveFileUrl: string | null;
  invoiceLink: string | null;
  documentLink: string | null;
}): ShowInvoiceItem {
  const display = resolveFinanceDisplayAmount({
    totalAmount: payment.amount,
    currency: payment.currency,
  });
  return {
    id: `supplier-payment:${payment.id}`,
    supplierName: payment.supplierName ?? payment.supplier,
    invoiceNumber: payment.invoiceNumber,
    amount: display.amount,
    amountLabel: display.amountLabel,
    currency: payment.currency,
    issueDate: payment.date,
    dueDate: payment.dueDate,
    status: payment.paid ? "paid" : "pending",
    driveUrl: payment.driveFileUrl ?? payment.invoiceLink ?? payment.documentLink ?? null,
  };
}

export function mergeShowInvoiceItems(invoiceItems: ShowInvoiceItem[], supplierPaymentItems: ShowInvoiceItem[], limit: number) {
  const merged: ShowInvoiceItem[] = [];
  const seenIds = new Set<string>();
  const addItem = (item: ShowInvoiceItem) => {
    if (merged.length >= limit || seenIds.has(item.id)) return;
    seenIds.add(item.id);
    merged.push(item);
  };

  for (const item of invoiceItems) addItem(item);
  for (const item of supplierPaymentItems) {
    if (hasInvoiceDuplicate(merged, item)) continue;
    addItem(item);
  }
  return merged.slice(0, limit);
}

function hasInvoiceDuplicate(invoiceItems: ShowInvoiceItem[], candidate: ShowInvoiceItem) {
  if (!candidate.supplierName || !candidate.invoiceNumber || !Number.isFinite(candidate.amount)) return false;
  const candidateDate = dateFingerprint(candidate.issueDate);
  if (!candidateDate) return false;
  return invoiceItems.some((item) => {
    if (!item.supplierName || !item.invoiceNumber || !Number.isFinite(item.amount)) return false;
    return (
      item.supplierName === candidate.supplierName &&
      item.invoiceNumber === candidate.invoiceNumber &&
      item.amount === candidate.amount &&
      dateFingerprint(item.issueDate) === candidateDate
    );
  });
}

function dateFingerprint(date: Date) {
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
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

export function isLikelyConversationalQuestion(question: string): boolean {
  const normalized = question.trim().replace(/\s+/g, " ");
  if (!normalized) return false;
  if (
    /(כמה|חשבונית|חשבוניות|תור|תורים|תשלום|ספק|לקוח|משימה|גבייה|מייל|סריק|invoice|payment|appointment|calendar|gmail|whatsapp)/i.test(
      normalized
    )
  ) {
    return false;
  }
  return /(שלום|היי|מה שלומך|מה נשמע|בוקר טוב|ערב טוב|תודה|תודה רבה|איך הולך|נעים להכיר)/i.test(
    normalized
  );
}

function maybeBuildConversationalResponse(question: string): NatalieClaudeResponse | null {
  if (!isLikelyConversationalQuestion(question)) return null;
  if (/תודה/i.test(question)) {
    return { answer: "בכיף! אני כאן אם תצטרך עוד משהו." };
  }
  return { answer: "שלום! אני כאן לעזור לך עם העסק. במה אוכל לסייע?" };
}

async function getNatalieAskDashboardSnapshot(organizationId: string) {
  const now = new Date();
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [
    openTasks,
    totalInvoices,
    scansCompleted,
    driveUploads,
    clients,
    unreadAlerts,
    supplierPaymentsCount,
    paidPayments,
    unpaidPayments,
    moneyToPayAgg,
    moneyToReceiveAgg,
    missingInvoicesCount,
    upcomingPaymentsCount,
    overdueSupplierPayments,
    overdueCustomerInvoices,
    invoicesFromGmail,
    invoicesFromWhatsApp,
    suspiciousPaymentsCount,
    customerInvoiceCount,
  ] = await Promise.all([
    prisma.task.count({ where: { organizationId, status: "open" } }),
    prisma.invoice.count({ where: { organizationId } }),
    prisma.syncLog.count({ where: { organizationId, type: "gmail_scan", status: "success" } }),
    prisma.emailAttachment.count({ where: { driveLink: { not: null }, emailMessage: { organizationId } } }),
    prisma.client.count({ where: { organizationId } }),
    prisma.alert.count({ where: { organizationId, read: false } }),
    prisma.supplierPayment.count({ where: { organizationId, approvalStatus: "approved" } }),
    prisma.supplierPayment.count({ where: { organizationId, approvalStatus: "approved", paid: true } }),
    prisma.supplierPayment.count({
      where: { organizationId, approvalStatus: "approved", paid: false },
    }),
    prisma.supplierPayment.aggregate({
      where: {
        organizationId,
        approvalStatus: "approved",
        paid: false,
        paymentRequired: true,
        amount: { gte: 0, lte: 1_000_000 },
      },
      _sum: { amount: true },
    }),
    prisma.customerInvoice.aggregate({
      where: { organizationId, paid: false },
      _sum: { amount: true },
    }),
    prisma.supplierPayment.count({
      where: {
        organizationId,
        approvalStatus: "approved",
        missingInvoice: true,
        paid: false,
        duplicateDetected: false,
      },
    }),
    prisma.supplierPayment.count({
      where: {
        organizationId,
        approvalStatus: "approved",
        paid: false,
        paymentRequired: true,
        dueDate: { gte: now, lte: in7days },
        amount: { gte: 0, lte: 1_000_000 },
      },
    }),
    prisma.supplierPayment.count({
      where: {
        organizationId,
        approvalStatus: "approved",
        paid: false,
        paymentRequired: true,
        dueDate: { lt: now },
        amount: { gte: 0, lte: 1_000_000 },
      },
    }),
    prisma.customerInvoice.count({
      where: { organizationId, paid: false, dueDate: { lt: now } },
    }),
    prisma.supplierPayment.count({
      where: {
        organizationId,
        OR: [
          { source: "gmail" },
          { source: "both" },
          { firstSource: "gmail" },
          { lastSource: "gmail" },
        ],
      },
    }),
    prisma.supplierPayment.count({
      where: {
        organizationId,
        OR: [
          { source: "whatsapp" },
          { source: "both" },
          { firstSource: "whatsapp" },
          { lastSource: "whatsapp" },
        ],
      },
    }),
    prisma.supplierPayment.count({
      where: {
        organizationId,
        approvalStatus: "approved",
        OR: [{ amount: { lt: 0 } }, { amount: { gt: 1_000_000 } }],
      },
    }),
    prisma.customerInvoice.count({ where: { organizationId } }),
  ]);

  const moneyToPay = moneyToPayAgg._sum.amount ?? 0;
  const moneyToReceive = moneyToReceiveAgg._sum.amount ?? 0;
  const businessHealthScore = Math.max(
    0,
    Math.min(
      100,
      100 -
        missingInvoicesCount * 8 -
        overdueSupplierPayments * 10 -
        overdueCustomerInvoices * 10 -
        Math.min(openTasks, 10) * 2
    )
  );

  return {
    moneyToPay,
    moneyToReceive,
    pendingInvoices: unpaidPayments,
    missingInvoicesCount,
    upcomingPaymentsCount,
    openTasks,
    unreadAlerts,
    businessHealthScore,
    overdueCustomerInvoices,
    overdueSupplierPayments,
    supplierPaymentsCount,
    totalInvoices,
    unpaidPayments,
    paidPayments,
    scansCompleted,
    driveUploads,
    documentsInDrive: driveUploads,
    invoicesFromGmail,
    invoicesFromWhatsApp,
    clients,
    suspiciousPaymentsCount,
    hoursSavedThisWeek: Math.round((supplierPaymentsCount + customerInvoiceCount + openTasks) * 0.25),
    currency: "ILS",
  };
}

async function loadOrganizationTimezone(organizationId: string): Promise<string> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  return organization?.timezone?.trim() || "Asia/Jerusalem";
}

function formatAppointmentWhen(startTime: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(startTime);
}

function formatAppointmentListLine(
  item: UpcomingSchedulingItem,
  index: number,
  timeZone: string
): string {
  const when = formatAppointmentWhen(item.startTime, timeZone);
  const service = item.serviceName?.trim();
  return `${index + 1}. ${when}${service ? ` — ${service}` : ""}`;
}

/** YYYY-MM-DD wall-clock date in the business timezone. */
function localDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** HH:MM wall-clock time in the business timezone. */
function formatTimeOnly(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

const HEBREW_SHORT_WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Local date (YYYY-MM-DD) of the coming Saturday, i.e. end of the current Hebrew week. */
function endOfCurrentWeekLocalDate(now: Date, timeZone: string): string {
  const weekdayShort = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
  const dayOfWeek = HEBREW_SHORT_WEEKDAY_TO_INDEX[weekdayShort] ?? 0;
  const daysUntilSaturday = 6 - dayOfWeek;
  return localDateInTimeZone(new Date(now.getTime() + daysUntilSaturday * 86_400_000), timeZone);
}

/**
 * Filter merged upcoming items to the requested list window. Deterministic and
 * timezone-aware. Items are already upcoming (>= now) from the read repository.
 */
function filterAppointmentsForListRange(
  items: Array<UpcomingSchedulingItem & { clientId?: string }>,
  params: { rangeType?: CalendarListRange; dayReference: string | null; timeZone: string; now: Date }
): Array<UpcomingSchedulingItem & { clientId?: string }> {
  if (params.rangeType === "week") {
    const endLocal = endOfCurrentWeekLocalDate(params.now, params.timeZone);
    return items.filter((item) => localDateInTimeZone(item.startTime, params.timeZone) <= endLocal);
  }
  if (params.dayReference) {
    const target = resolveAppointmentDateTime({
      dayReference: params.dayReference,
      time: "12:00",
      timeZone: params.timeZone,
      now: params.now,
    });
    if (!target) return items;
    const targetLocal = localDateInTimeZone(target, params.timeZone);
    return items.filter((item) => localDateInTimeZone(item.startTime, params.timeZone) === targetLocal);
  }
  return items;
}

/** Hebrew label for the list header/empty message based on the requested window. */
function listRangeLabel(rangeType: CalendarListRange | undefined, dayReference: string | null): {
  header: string;
  empty: string;
  includeDate: boolean;
} {
  if (rangeType === "week") {
    return { header: calendarMessages.listHeaderWeek(), empty: calendarMessages.listEmptyWeek(), includeDate: true };
  }
  if (dayReference) {
    return {
      header: calendarMessages.listHeaderDay(dayReference),
      empty: calendarMessages.listEmptyDay(dayReference),
      includeDate: false,
    };
  }
  return { header: calendarMessages.listHeaderAll(), empty: calendarMessages.listEmptyAll(), includeDate: true };
}

function formatListEntry(
  item: UpcomingSchedulingItem,
  timeZone: string,
  includeDate: boolean
): string {
  const when = includeDate
    ? formatAppointmentWhen(item.startTime, timeZone)
    : formatTimeOnly(item.startTime, timeZone);
  return calendarMessages.listEntry({
    when,
    clientName: item.clientName,
    serviceName: item.serviceName,
  });
}

/**
 * Deterministic read handler for "what's on my calendar" questions. Runs before
 * Claude, reads the unified source of truth (both Appointment + CalendarEvent),
 * and never writes anything.
 */
async function maybeBuildListAppointmentsResponse(
  organizationId: string,
  question: string,
  deps?: AskNatalieDeps,
  requestId?: string | null
): Promise<NatalieClaudeResponse | null> {
  const now = deps?.now ?? new Date();
  const intent = parseCalendarIntent(question, { now });
  if (intent.intent !== "list_appointments") return null;

  const loadTimezone = deps?.loadTimezone ?? loadOrganizationTimezone;
  const timeZone = await loadTimezone(organizationId);

  let detailed: Awaited<ReturnType<typeof findUpcomingSchedulingForOrganizationDetailed>>;
  try {
    detailed = await findUpcomingSchedulingForOrganizationDetailed({ organizationId });
  } catch (err) {
    console.error("[natalie/list-appointments] scheduling read failed", err);
    return {
      answer: "לא הצלחתי לקרוא את היומן כרגע. נסי שוב בעוד רגע.",
    };
  }
  const items = detailed.items;
  const filtered = filterAppointmentsForListRange(items, {
    rangeType: intent.rangeType,
    dayReference: intent.dayReference,
    timeZone,
    now,
  });

  const { header, empty, includeDate } = listRangeLabel(intent.rangeType, intent.dayReference);
  const googleWarning = detailed.googleReadWarningHe;
  const sourceLine =
    detailed.googleReadStatus === "full"
      ? calendarMessages.listSourceFull()
      : detailed.googleReadStatus === "partial"
        ? calendarMessages.listSourcePartial(googleWarning)
        : detailed.googleReadStatus === "local_only"
          ? calendarMessages.listSourceLocalOnly()
          : calendarMessages.listSourceUnavailable(googleWarning);

  console.info("[natalie/google-truth] list", {
    requestId: requestId ?? null,
    organizationId,
    googleStatus: detailed.googleReadStatus,
    degraded: detailed.googleReadDegraded,
    reason: detailed.googleReadReason ?? null,
    statusCode: detailed.googleReadStatusCode ?? null,
    sourceUsed: detailed.googleReadStatus === "full" ? "google+local" : "local_or_partial",
  });

  if (filtered.length === 0) {
    if (detailed.googleReadStatus !== "full") {
      return {
        answer: `${calendarMessages.listCannotGuaranteeEmpty(googleWarning)}\n\n${sourceLine}`,
      };
    }
    const answer = googleWarning
      ? calendarMessages.listEmptyWithGoogleWarning(empty, googleWarning)
      : empty;
    return { answer: `${answer}\n\n${sourceLine}` };
  }

  const lines = filtered.map((item) => formatListEntry(item, timeZone, includeDate));
  const answer = googleWarning
    ? calendarMessages.listWithGoogleWarning(header, lines.join("\n"), googleWarning)
    : `${header}\n${lines.join("\n")}`;
  const answerWithSource = `${answer}\n\n${sourceLine}`;
  const listedPending = buildLastListedAppointmentsPendingAction(filtered);
  return {
    action: "last_listed_appointments",
    proposal: listedPending!.proposal as {
      items: Array<{
        appointmentId: string;
        source: "appointment" | "calendar_event" | "google_calendar";
        startTime: string;
        endTime: string;
        customerName: string;
        serviceName?: string;
        clientId?: string | null;
      }>;
      listedAt?: string;
    },
    answer: answerWithSource,
  };
}

async function maybeBuildListedAppointmentFollowUp(
  organizationId: string,
  question: string,
  conversationContext:
    | {
        pendingAction?: { action: string; proposal: Record<string, unknown> } | null;
        structuredHistory?: Array<{
          role: "user" | "assistant";
          content: string;
          action?: string | null;
          proposal?: Record<string, unknown> | null;
        }>;
      }
    | undefined,
  deps?: AskNatalieDeps
): Promise<NatalieClaudeResponse | null> {
  const command = parseListedAppointmentOrdinalCommand(question);
  if (!command) return null;

  const listed = readLastListedAppointments({
    pendingAction: conversationContext?.pendingAction ?? null,
    structuredHistory: (conversationContext?.structuredHistory ?? []).map((turn) => ({
      id: "legacy",
      role: turn.role,
      text: turn.content,
      action: turn.action ?? null,
      proposal: turn.proposal ?? null,
      channel: "web_chat" as const,
      at: new Date().toISOString(),
    })),
  });

  if (listed.length === 0) {
    return {
      answer: "אין לי רשימת תורים מהשיחה האחרונה. שאלי קודם מה יש ביומן, ואז אפשר לבחור ראשון/שני/אחרון.",
    };
  }

  const item = resolveListedAppointmentByOrdinal(listed, command.ordinal);
  if (!item) {
    return {
      answer: `יש לי רק ${listed.length} תורים ברשימה האחרונה. לאיזה מהם התכוונת?`,
    };
  }

  const loadTimezone = deps?.loadTimezone ?? loadOrganizationTimezone;
  const timeZone = await loadTimezone(organizationId);
  const when = formatAppointmentWhen(new Date(item.startTime), timeZone);

  if (command.intent === "inspect") {
    const service = item.serviceName?.trim();
    return {
      answer: service
        ? `האחרון ברשימה: ${item.customerName} ב${when} — ${service}.`
        : `האחרון ברשימה: ${item.customerName} ב${when}.`,
    };
  }

  if (item.source === "google_calendar") {
    return {
      answer:
        "את האירוע הזה אני רואה ב-Google Calendar, אבל אני לא יכולה לבטל או להעביר אותו מכאן. בחרי תור שנשמר אצלי.",
    };
  }

  if (command.intent === "cancel_appointment") {
    return {
      action: "cancel_appointment",
      proposal: {
        appointmentId: item.appointmentId,
        clientName: item.customerName,
        ...(item.clientId ? { clientId: item.clientId } : {}),
        when,
        ...(item.serviceName ? { serviceName: item.serviceName } : {}),
      },
      answer: calendarMessages.cancelConfirmation(item.customerName, when),
    };
  }

  const dayReference = extractCalendarDayReference(question);
  const time = parseHebrewTime(question);
  if (!dayReference || !time) {
    if (!dayReference) return { answer: calendarMessages.rescheduleMissingDate() };
    return { answer: calendarMessages.rescheduleMissingTime() };
  }

  const resolvedStartTime = resolveAppointmentDateTime({
    dayReference,
    time,
    timeZone,
  });
  if (!resolvedStartTime) {
    return { answer: calendarMessages.rescheduleBadDatetime() };
  }
  const newWhen = formatAppointmentWhen(resolvedStartTime, timeZone);
  return {
    action: "reschedule_appointment",
    proposal: {
      appointmentId: item.appointmentId,
      clientName: item.customerName,
      ...(item.clientId ? { clientId: item.clientId } : {}),
      newDayReference: dayReference,
      newTime: time,
      newWhen,
    },
    answer: calendarMessages.rescheduleConfirmation(item.customerName, newWhen),
  };
}

/**
 * One short templated clarification for incomplete move/cancel commands — never
 * Claude prose, never guessed values.
 */
function maybeBuildPartialCalendarClarification(question: string): NatalieClaudeResponse | null {
  const intent = parseCalendarIntent(question);
  if (intent.intent === "move_appointment") {
    // Move with a clean customer + time but NO target day (e.g. "תעבירי את התור
    // של שרית לשלוש"): ask which day rather than silently defaulting to "היום".
    // Must run before the reschedule handler, which would otherwise guess today.
    if (
      intent.customerName &&
      intent.missingFields.includes("date") &&
      !extractCalendarDayReference(question)
    ) {
      return { answer: calendarMessages.rescheduleMissingDate() };
    }
    // Let the reschedule handler (incl. fuzzy name resolution) run when we already
    // parsed a target — even if the deterministic intent lost the customer name.
    if (extractRescheduleAppointment(question)) return null;
    if (!intent.customerName) return { answer: calendarMessages.rescheduleMissingCustomer() };
    if (intent.missingFields.includes("date")) return { answer: calendarMessages.rescheduleMissingDate() };
    if (intent.missingFields.includes("time")) return { answer: calendarMessages.rescheduleMissingTime() };
    return null;
  }
  if (
    intent.intent === "cancel_appointment" &&
    !intent.customerName &&
    !extractCancelAppointmentClientName(question) &&
    !isCancelPronounCommand(question) &&
    !intent.cancelTarget
  ) {
    return { answer: calendarMessages.cancelMissingCustomer() };
  }
  return null;
}

const TRAILING_TIME_PHRASE_PATTERNS = [
  /\s+(?:ו)?\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\s*$/u,
  /\s+(?:ו)?בשעה\s+\d{1,2}(?::\d{2})?\s*$/iu,
  /\s+(?:ו)?ב-\d{1,2}(?::\d{2})?\s*$/iu,
  /\s+(?:ו)?ב\s+\d{1,2}(?::\d{2})?\s*$/iu,
  /\s+(?:ו)?ביום\s+(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)\s*$/iu,
  /\s+(?:ו)?יום\s+(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)\s*$/iu,
  /\s+(?:ו)?מחרתיים\s*$/iu,
  /\s+(?:ו)?שבוע\s+הבא\s*$/iu,
  /\s+(?:ו)?מחר\s*$/iu,
  /\s+(?:ו)?היום\s*$/iu,
  /\s+(?:ו)?השבוע\s*$/iu,
] as const;

function stripTrailingTimePhrase(name: string): string {
  let result = name.trim();

  while (true) {
    let changed = false;
    for (const pattern of TRAILING_TIME_PHRASE_PATTERNS) {
      const next = result.replace(pattern, "");
      if (next !== result) {
        result = next.trim();
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }

  return result.replace(/\s+ו\s*$/u, "").trim();
}

function extractCancelAppointmentClientName(question: string): string | null {
  const normalized = question.trim().replace(/\s+/g, " ");
  if (/(?:תעביר|תעבירי|תדחי|תדחה|תשני|תשנה|שנה\s+מועד)/iu.test(normalized)) {
    return null;
  }
  if (isPronounCalendarReference(normalized)) {
    return null;
  }

  const patterns = [
    /(?:בטל|בטלי|תבטל|תבטלי|תמחק|תמחקי|תוריד|תורידי)\s+(?:לי\s+)?(?:את\s+)?(?:ה)?(?:תור|פגישה)\s+(?:של|ל)\s+(.+?)(?:\s*[.?!]|$)/iu,
    /תבטלי\s+(?:תור|פגישה)\s+(?:של|ל|-)?\s*(.+?)(?:\s*[.?!]|$)/iu,
    /ביטול\s+(?:ה)?(?:תור|פגישה)\s+(?:של|ל)\s+(.+?)(?:\s*[.?!]|$)/iu,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const rawClientName = match?.[1]?.trim().replace(/[.?!]+$/, "");
    if (!rawClientName) continue;
    const clientName = stripTrailingTimePhrase(rawClientName);
    if (clientName && !isPronounCalendarReference(clientName)) return clientName;
  }

  return null;
}

function isCancelPronounCommand(question: string): boolean {
  const normalized = question.trim().replace(/\s+/g, " ");
  if (/(?:תעביר|תעבירי|תשני|תשנה|שנה\s+מועד)/iu.test(normalized)) return false;
  return /(?:תבטל|תבטלי|בטל|בטלי)\s+(?:אותו|אותה|לו|לה)(?:\s*[.?!]|$)/iu.test(normalized);
}

async function resolveCalendarCommandCustomer(input: {
  organizationId: string;
  question: string;
  spokenName: string | null;
  activeContext: ActiveCalendarContext | null;
  /** When set, narrow the customer's appointments to the referenced day. */
  filterDayReference?: string | null;
}) {
  const upcomingAppointments = (
    await findUpcomingSchedulingForOrganization({
      organizationId: input.organizationId,
    })
  ).filter((item) => item.source !== "google_calendar");
  const nameResolution = await resolveAppointmentCustomerName({
    organizationId: input.organizationId,
    spokenName: input.spokenName,
    originalTranscript: input.question,
    upcomingAppointments,
    activeContext: input.activeContext,
  });
  if (!nameResolution) {
    if (input.spokenName) {
      const ambiguousCustomers = await searchSchedulingCustomers({
        organizationId: input.organizationId,
        query: input.spokenName,
      });
      if (ambiguousCustomers.length > 1) {
        return { kind: "ambiguous" as const, spokenName: input.spokenName, clients: ambiguousCustomers };
      }
      const ambiguousAppointments = findAmbiguousAppointmentNameMatches(
        input.spokenName,
        upcomingAppointments
      );
      if (ambiguousAppointments.kind === "ambiguous") {
        return {
          kind: "ambiguous_appointments" as const,
          spokenName: input.spokenName,
          candidates: ambiguousAppointments.candidates,
        };
      }
      return { kind: "not_found" as const, spokenName: input.spokenName };
    }
    return { kind: "not_found" as const, spokenName: "" };
  }

  const allClientAppointments = nameResolution.clientId
    ? await findUpcomingSchedulingForClient({
        organizationId: input.organizationId,
        clientId: nameResolution.clientId,
        limit: 10,
      })
    : upcomingAppointments.filter(
        (item) =>
          normalizeHebrewAppointmentText(item.clientName) ===
          normalizeHebrewAppointmentText(nameResolution.clientName)
      );

  // Day-scoping: "תבטלי את התור של שרית מחר" must target only tomorrow's
  // appointment. A single unambiguous appointment is kept even if the parsed day
  // doesn't match (so cross-day moves and loose phrasing still work).
  let appointments = allClientAppointments;
  if (input.filterDayReference && allClientAppointments.length > 0) {
    const timeZone = await loadOrganizationTimezone(input.organizationId);
    const sameDay = filterAppointmentsForListRange(allClientAppointments, {
      dayReference: input.filterDayReference,
      timeZone,
      now: new Date(),
    });
    if (sameDay.length >= 1) {
      appointments = sameDay;
    } else if (allClientAppointments.length > 1) {
      appointments = sameDay; // empty → force a clean "no appointment that day" answer
    }
  }

  if (appointments.length === 0 && input.activeContext?.appointmentId) {
    const contextual = upcomingAppointments.find(
      (item) => item.id === input.activeContext?.appointmentId && item.clientId === nameResolution.clientId
    );
    if (contextual) {
      return {
        kind: "resolved" as const,
        nameResolution,
        appointments: [contextual],
      };
    }
  }

  return {
    kind: "resolved" as const,
    nameResolution,
    appointments,
  };
}

async function buildCancelAllAppointmentsProposal(
  organizationId: string,
  dayReference: string
): Promise<NatalieClaudeResponse> {
  const timeZone = await loadOrganizationTimezone(organizationId);
  const now = new Date();
  const items = (await findUpcomingSchedulingForOrganization({ organizationId })).filter(
    (item) => item.source !== "google_calendar"
  );
  const filtered = filterAppointmentsForListRange(items, {
    dayReference,
    timeZone,
    now,
  });

  if (filtered.length === 0) {
    return { answer: calendarMessages.cancelEmptyDay(dayReference) };
  }

  const summary = filtered
    .map((item) => `${formatTimeOnly(item.startTime, timeZone)} ${item.clientName}`)
    .join(", ");

  return {
    action: "cancel_appointments",
    proposal: {
      appointmentIds: filtered.map((item) => item.id),
      dayReference,
      cancelTarget: "all",
      appointmentResolution: {
        source: "exact",
        matchScore: 1,
        spokenName: "כולם",
        matchedName: "כולם",
        fuzzyIdentityConfirmationPending: false,
        identityConfirmed: true,
      },
    },
    answer: calendarMessages.cancelAllConfirmation(dayReference, filtered.length, summary),
  } as NatalieClaudeResponse;
}

function buildSyntheticCancelQuestion(intent: CalendarPendingIntent): string {
  const day = intent.dayReference ? ` ${intent.dayReference}` : "";
  return `תבטלי את התור של ${intent.customerName}${day}`;
}

function buildSyntheticMoveQuestion(intent: CalendarPendingIntent): string {
  const day = intent.dayReference ?? "מחר";
  const time = intent.time ?? "16:00";
  return `תעבירי את התור של ${intent.customerName} ${day} ל-${time}`;
}

function buildCreateResponseFromPendingIntent(
  intent: CalendarPendingIntent
): NatalieClaudeResponse {
  const extraction: CalendarIntentExtraction = {
    intent: "create_appointment",
    customerName: intent.customerName,
    dayReference: intent.dayReference,
    date: intent.date,
    time: intent.time,
    durationMinutes: null,
    serviceName: null,
    notes: null,
    confidence:
      intent.customerName && intent.dayReference && intent.time ? "high" : "low",
    missingFields: recomputeCreateMissingFields(intent),
    rawText: intent.originalUserText,
  };
  return (
    buildCreateAppointmentResponse(extraction) ?? {
      answer: buildCreateClarification(extraction),
    }
  );
}

function recomputeCreateMissingFields(intent: CalendarPendingIntent): string[] {
  const missing: string[] = [];
  if (!intent.customerName) missing.push("customerName");
  if (!intent.dayReference) missing.push("date");
  if (!intent.time) missing.push("time");
  return missing;
}

export async function fulfillCalendarPendingIntent(
  organizationId: string,
  intent: CalendarPendingIntent,
  activeContext: ActiveCalendarContext | null
): Promise<NatalieClaudeResponse> {
  if (intent.action === "cancel_appointments" && intent.cancelTarget === "all" && intent.dayReference) {
    return buildCancelAllAppointmentsProposal(organizationId, intent.dayReference);
  }
  if (intent.intent === "cancel_appointment" && intent.customerName) {
    return (
      (await maybeBuildCancelAppointmentProposal(
        organizationId,
        buildSyntheticCancelQuestion(intent),
        activeContext
      )) ?? { answer: calendarMessages.cancelMissingCustomer() }
    );
  }
  if (intent.intent === "move_appointment") {
    return (
      (await maybeBuildRescheduleAppointmentProposal(
        organizationId,
        buildSyntheticMoveQuestion(intent),
        activeContext
      )) ?? { answer: calendarMessages.rescheduleMissingCustomer() }
    );
  }
  if (intent.intent === "create_appointment") {
    return buildCreateResponseFromPendingIntent(intent);
  }
  return { answer: calendarMessages.unsupportedCalendar() };
}

async function maybeBuildCancelAppointmentProposal(
  organizationId: string,
  question: string,
  activeContext: ActiveCalendarContext | null
): Promise<NatalieClaudeResponse | null> {
  const cancelIntent = parseCalendarIntent(question);
  if (
    cancelIntent.intent === "cancel_appointment" &&
    cancelIntent.cancelTarget === "all" &&
    cancelIntent.dayReference
  ) {
    return buildCancelAllAppointmentsProposal(organizationId, cancelIntent.dayReference);
  }
  const pronounCommand = isCancelPronounCommand(question);
  const clientName = extractCancelAppointmentClientName(question) ?? cancelIntent.customerName;
  if (cancelIntent.intent !== "cancel_appointment" && !clientName && !pronounCommand) return null;
  if (
    cancelIntent.intent === "cancel_appointment" &&
    !clientName &&
    !pronounCommand &&
    cancelIntent.cancelTarget !== "all"
  ) {
    return null;
  }

  const resolved = await resolveCalendarCommandCustomer({
    organizationId,
    question,
    spokenName: clientName,
    activeContext,
    filterDayReference: cancelIntent.dayReference,
  });

  if (resolved.kind === "ambiguous") {
    return { answer: formatAmbiguousCustomerMessage(resolved.spokenName, resolved.clients) };
  }
  if (resolved.kind === "ambiguous_appointments") {
    return { answer: formatAmbiguousAppointmentMessage(resolved.spokenName, resolved.candidates) };
  }
  if (resolved.kind === "not_found") {
    if (pronounCommand) {
      return { answer: calendarMessages.cancelPronounNotFound() };
    }
    return { answer: calendarMessages.notFoundNamed(resolved.spokenName) };
  }

  const { nameResolution, appointments } = resolved;
  if (appointments.length === 0) {
    return { answer: calendarMessages.noUpcomingForClient(nameResolution.clientName) };
  }

  const timeZone = await loadOrganizationTimezone(organizationId);
  if (appointments.length > 1) {
    const list = appointments
      .map((appointment, index) => formatAppointmentListLine(appointment, index, timeZone))
      .join("\n");
    return { answer: calendarMessages.chooseCancel(nameResolution.clientName, list) };
  }

  const appointment = appointments[0]!;
  const when = formatAppointmentWhen(appointment.startTime, timeZone);
  return buildCalendarActionProposal({
    action: "cancel_appointment",
    appointment,
    nameResolution,
    timeZone,
    when,
    defaultAnswer: calendarMessages.cancelConfirmation(nameResolution.clientName, when),
  });
}

export function parseRescheduleDayAndTime(target: string): { dayReference: string; time: string } | null {
  const normalized = target.trim().replace(/\s+/g, " ");
  // Single deterministic Hebrew time parser (ב-3/בשלוש → 15:00, ב-4 → 16:00,
  // ב-8 בערב → 20:00, ב-10 → 10:00) — replaces the old logic that padded ב-3 → 03:00.
  const time = parseHebrewTime(normalized);
  if (!time) return null;

  const dayReference = extractCalendarDayReference(normalized) ?? "היום";
  return { dayReference, time };
}

export function extractRescheduleAppointment(
  question: string
): { clientName: string | null; dayReference: string; time: string } | null {
  // Deterministic Hebrew parser handles complex "from ... to ..." phrasing
  // (e.g. "תזיזי את התור של שרית ממחר בשלוש למחר בארבע") without Claude, using
  // the TO day/time as the reschedule target. Only trust it when it cleanly
  // extracted a customer name (the "של <שם>" form); otherwise fall through to
  // the regex path below, which also handles "תעביר את <שם>" and pronoun/fuzzy
  // cases resolved downstream.
  const intent = parseCalendarIntent(question);
  if (
    intent.intent === "move_appointment" &&
    intent.customerName &&
    intent.time
  ) {
    return {
      clientName: intent.customerName,
      dayReference: intent.dayReference ?? extractCalendarDayReference(question) ?? "היום",
      time: intent.time,
    };
  }

  const normalized = question.trim().replace(/\s+/g, " ");
  const pronounPatterns = [
    /(?:תעביר|תעבירי|תדחי|תדחה|תזיז|תזיזי|תשני|תשנה|שנה\s+מועד|תקדים|תקדימי)\s+(?:לי\s+)?(?:את\s+)?(?:ה)?(?:תור|פגישה\s+)?(?:אותו|אותה|לו|לה)\s+ל(?:ש|-)?\s*(.+)$/iu,
    /(?:תעביר|תעבירי|תדחי|תדחה|תזיז|תזיזי|תשני|תשנה|שנה\s+מועד|תקדים|תקדימי)\s+(?:לי\s+)?(?:את\s+)?(?:ה)?(?:תור|פגישה)\s+ל(?:ש|-)?\s*(.+)$/iu,
  ];
  for (const pattern of pronounPatterns) {
    const match = normalized.match(pattern);
    const parsedTarget = match?.[1] ? parseRescheduleDayAndTime(match[1]) : null;
    if (parsedTarget) {
      return { clientName: null, dayReference: parsedTarget.dayReference, time: parsedTarget.time };
    }
  }

  const namedPatterns = [
    /(?:תעביר|תעבירי|תדחי|תדחה|תשני|תשנה|שנה\s+מועד|תקדים|תקדימי)\s+(?:לי\s+)?(?:את\s+)?(?:ה)?(?:תור|פגישה)\s+(?:של|ל)\s+(.+?)\s+ל(?:ש|-)?\s*(.+)$/iu,
    /(?:תעביר|תעבירי|תדחי|תדחה|תזיז|תזיזי|תקדים|תקדימי)\s+(?:לי\s+)?(?:את\s+)?(.+?)\s+ל(?:ש|-)?\s*(.+)$/iu,
  ];
  for (const pattern of namedPatterns) {
    const match = normalized.match(pattern);
    if (!match?.[1] || !match[2]) continue;
    const clientName = stripTrailingTimePhrase(match[1].trim().replace(/[.?!]+$/, ""));
    const parsedTarget = parseRescheduleDayAndTime(match[2]);
    if (!clientName || !parsedTarget || isPronounCalendarReference(clientName)) continue;
    return {
      clientName,
      dayReference: parsedTarget.dayReference,
      time: parsedTarget.time,
    };
  }

  return null;
}

/**
 * Which day identifies the EXISTING appointment in a move command.
 * - Explicit "מ<day>" form → that from-day.
 * - "...ל<day> <time>" target form → the day (if any) BEFORE the target clause.
 * - Otherwise ("ביום שני לשלוש") → the single day mentioned.
 * Returns null when only a target day is present, so the existing appointment
 * isn't accidentally filtered out (multi-appointment ambiguity is preserved).
 */
function extractExistingMoveDayReference(question: string): string | null {
  const intent = parseCalendarIntent(question);
  if (intent.fromDayReference) return intent.fromDayReference;

  const parts = question.split(/(?:^|\s)ל(?=מחר|מחרתיים|היום|יום\s)/u);
  if (parts.length > 1) {
    const beforeTarget = parts.slice(0, -1).join(" ");
    return extractCalendarDayReference(beforeTarget);
  }
  return extractCalendarDayReference(question);
}

async function maybeBuildRescheduleAppointmentProposal(
  organizationId: string,
  question: string,
  activeContext: ActiveCalendarContext | null
): Promise<NatalieClaudeResponse | null> {
  const parsed = extractRescheduleAppointment(question);
  if (!parsed) return null;

  const resolved = await resolveCalendarCommandCustomer({
    organizationId,
    question,
    spokenName: parsed.clientName,
    activeContext,
    filterDayReference: extractExistingMoveDayReference(question),
  });

  if (resolved.kind === "ambiguous") {
    return { answer: formatAmbiguousCustomerMessage(resolved.spokenName, resolved.clients) };
  }
  if (resolved.kind === "ambiguous_appointments") {
    return { answer: formatAmbiguousAppointmentMessage(resolved.spokenName, resolved.candidates) };
  }
  if (resolved.kind === "not_found") {
    if (!parsed.clientName) {
      return { answer: calendarMessages.reschedulePronounNotFound() };
    }
    return { answer: calendarMessages.notFoundNamed(parsed.clientName) };
  }

  const { nameResolution, appointments } = resolved;
  if (appointments.length === 0) {
    return { answer: calendarMessages.noUpcomingForClient(nameResolution.clientName) };
  }

  const timeZone = await loadOrganizationTimezone(organizationId);
  if (appointments.length > 1) {
    const list = appointments
      .map((appointment, index) => formatAppointmentListLine(appointment, index, timeZone))
      .join("\n");
    return { answer: calendarMessages.chooseReschedule(nameResolution.clientName, list) };
  }

  const appointment = appointments[0]!;
  const resolvedStartTime = resolveAppointmentDateTime({
    dayReference: parsed.dayReference,
    time: parsed.time,
    timeZone,
  });
  if (!resolvedStartTime) {
    return { answer: calendarMessages.rescheduleBadDatetime() };
  }

  const newWhen = formatAppointmentWhen(resolvedStartTime, timeZone);
  return buildCalendarActionProposal({
    action: "reschedule_appointment",
    appointment,
    nameResolution,
    timeZone,
    when: formatAppointmentWhen(appointment.startTime, timeZone),
    reschedule: {
      newDayReference: parsed.dayReference,
      newTime: parsed.time,
      newWhen,
    },
    defaultAnswer: calendarMessages.rescheduleConfirmation(nameResolution.clientName, newWhen),
  });
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
      select: { businessProfile: true, timezone: true },
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
  const timezone = organization?.timezone?.trim() || "Asia/Jerusalem";

  return {
    ...(businessProfile
      ? {
          businessProfile: {
            label: "מידע על העסק (זיכרון קבוע):",
            text: businessProfile,
          },
        }
      : {}),
    currentTime: formatCurrentTimeInTimezone(now, timezone),
    currentWeekday: formatWeekdayInTimezone(now, timezone),
    timezone,
    labels: {
      currentTime: "הזמן הנוכחי עם offset (לפרשנות תאריכים יחסיים כמו מחר/בעוד שעה)",
      currentWeekday: "היום בשבוע לפי אזור הזמן של העסק",
      timezone: "אזור זמן של העסק",
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

function formatCurrentTimeInTimezone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  const localDateTime = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
  return `${localDateTime}${getTimezoneOffsetForDate(date, timeZone)}`;
}

function formatWeekdayInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone, weekday: "long" }).format(date);
}

function getTimezoneOffsetForDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const getNumber = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtcMs = Date.UTC(
    getNumber("year"),
    getNumber("month") - 1,
    getNumber("day"),
    getNumber("hour"),
    getNumber("minute"),
    getNumber("second")
  );
  const offsetMinutes = Math.round((asUtcMs - date.getTime()) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minutes = String(absoluteMinutes % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
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
