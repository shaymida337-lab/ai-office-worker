import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { classifyGmailScanCandidate, extractInvoiceAmount } from "./gmail-sync.js";
import type { EmailAnalysis } from "./claude.js";

type DbClient = typeof prisma | Prisma.TransactionClient;

export async function buildPaymentClassificationDebug(organizationId: string, db: DbClient = prisma): Promise<any> {
  const payments = await db.supplierPayment.findMany({
    where: {
      organizationId,
      paymentRequired: true,
      paid: false,
    },
    orderBy: [{ amount: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      organizationId: true,
      supplier: true,
      amount: true,
      currency: true,
      date: true,
      dueDate: true,
      paid: true,
      paymentRequired: true,
      missingInvoice: true,
      subject: true,
      emailSender: true,
      emailMessageId: true,
      documentLink: true,
      invoiceLink: true,
      source: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const emailMessageRefs = payments.map((payment) => payment.emailMessageId).filter((id): id is string => Boolean(id));
  const [emails, scanItems] = await Promise.all([
    emailMessageRefs.length
      ? db.emailMessage.findMany({
          where: {
            organizationId,
            OR: [
              { id: { in: emailMessageRefs } },
              { gmailId: { in: emailMessageRefs } },
            ],
          },
          select: {
            id: true,
            gmailId: true,
            subject: true,
            fromAddress: true,
            snippet: true,
            bodyText: true,
            receivedAt: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
    emailMessageRefs.length
      ? db.gmailScanItem.findMany({
          where: {
            organizationId,
            OR: [
              { emailMessageId: { in: emailMessageRefs } },
              { gmailMessageId: { in: emailMessageRefs } },
            ],
          },
          select: {
            id: true,
            emailMessageId: true,
            gmailMessageId: true,
            sender: true,
            senderEmail: true,
            subject: true,
            amount: true,
            supplierName: true,
            documentType: true,
            confidenceScore: true,
            reviewStatus: true,
            decisionReason: true,
            rawAnalysis: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const emailById = new Map(emails.map((email) => [email.id, email]));
  const emailByGmailId = new Map(emails.map((email) => [email.gmailId, email]));
  const scanItemsByEmailRef = new Map<string, typeof scanItems>();
  for (const item of scanItems) {
    for (const ref of [item.emailMessageId, item.gmailMessageId].filter((id): id is string => Boolean(id))) {
      const current = scanItemsByEmailRef.get(ref) ?? [];
      current.push(item);
      scanItemsByEmailRef.set(ref, current);
    }
  }

  const rows = payments.map((payment) => {
    const email = payment.emailMessageId
      ? emailById.get(payment.emailMessageId) ?? emailByGmailId.get(payment.emailMessageId) ?? null
      : null;
    const relatedScanItems = payment.emailMessageId
      ? scanItemsByEmailRef.get(payment.emailMessageId) ?? (email?.gmailId ? scanItemsByEmailRef.get(email.gmailId) : undefined) ?? []
      : [];
    const primaryScanItem = relatedScanItems[0];
    const senderDomain = extractDomain(payment.emailSender ?? email?.fromAddress);
    const parsedAmount = extractInvoiceAmount(`${email?.subject ?? payment.subject ?? ""}\n${email?.bodyText ?? ""}`);
    const previousAnalysis = analysisFromScanItem(primaryScanItem, payment);
    const analysisAmountRejectedReason = amountRejectedReason(previousAnalysis.amount);
    const wouldBeAmount = parsedAmount.amount ?? (analysisAmountRejectedReason ? null : previousAnalysis.amount);
    const wouldBeClassification = classifyGmailScanCandidate({
      subject: email?.subject ?? payment.subject ?? "",
      bodyText: email?.bodyText ?? "",
      attachmentFilenames: [],
      analysis: previousAnalysis,
      amount: wouldBeAmount,
      supplierName: payment.supplier,
      senderEmail: email?.fromAddress ?? payment.emailSender ?? undefined,
      senderDomain,
      amountRejectedReason: parsedAmount.rejectedReason ?? analysisAmountRejectedReason,
    });
    const wouldRemainInMoneyToPay = wouldBeClassification.reviewStatus === "auto_saved";

    return {
      senderDomain,
      payment,
      email: email
        ? {
            ...email,
            bodyTextPreview: email.bodyText?.slice(0, 1200) ?? null,
            bodyText: undefined,
          }
        : null,
      scanItems: relatedScanItems,
      cleanupPreview: {
        sender: payment.emailSender ?? email?.fromAddress ?? null,
        currentStoredAmount: payment.amount,
        newlyParsedAmount: parsedAmount.amount,
        wouldBeAmount,
        rule1FinancialSenderHold: wouldBeClassification.heldForFinancialSender,
        rule2AutoSaveGateHold: !wouldBeClassification.heldForFinancialSender && wouldBeClassification.reviewStatus !== "auto_saved",
        rule3AmountSanityFlag: Boolean(parsedAmount.rejectedReason ?? analysisAmountRejectedReason) || wouldBeAmount === null,
        amountRejectedReason: parsedAmount.rejectedReason ?? analysisAmountRejectedReason,
        wouldBeDocumentType: wouldBeClassification.documentType,
        wouldBeReviewStatus: wouldBeClassification.reviewStatus,
        wouldBeDecisionReason: wouldBeClassification.decisionReason,
        wouldMoveOutOfMoneyToPay: !wouldRemainInMoneyToPay,
        wouldRemainInMoneyToPay,
      },
    };
  });

  const cleanupPreviewSummary = rows.reduce(
    (acc, row) => {
      acc.currentMoneyToPay += row.payment.amount;
      if (row.cleanupPreview.wouldMoveOutOfMoneyToPay) {
        acc.wouldMoveOutCount += 1;
        acc.amountMovedOut += row.payment.amount;
      } else {
        acc.newMoneyToPay += row.cleanupPreview.wouldBeAmount ?? 0;
      }
      return acc;
    },
    {
      totalRows: rows.length,
      wouldMoveOutCount: 0,
      currentMoneyToPay: 0,
      newMoneyToPay: 0,
      amountMovedOut: 0,
    }
  );

  const domainSummary = Array.from(
    rows.reduce((acc, row) => {
      const existing = acc.get(row.senderDomain) ?? { domain: row.senderDomain, count: 0, totalAmount: 0 };
      existing.count += 1;
      existing.totalAmount += row.payment.amount;
      acc.set(row.senderDomain, existing);
      return acc;
    }, new Map<string, { domain: string; count: number; totalAmount: number }>())
  )
    .map(([, value]) => value)
    .sort((a, b) => b.totalAmount - a.totalAmount);

  const debugRows: any[] = rows.map((row) => {
    const primaryScan = row.scanItems[0];
    const ruleFired = cleanupRuleFired(row);
    return {
      supplierName: row.payment.supplier,
      senderDomain: row.senderDomain,
      amount: row.payment.amount,
      currentReviewStatus: primaryScan?.reviewStatus ?? null,
      newReviewStatus: row.cleanupPreview.wouldBeReviewStatus,
      ruleFired,
      currentDecisionReason: primaryScan?.decisionReason ?? null,
      newDecisionReason: row.cleanupPreview.wouldBeDecisionReason,
    };
  });

  return {
    orgId: organizationId,
    countedRows: rows.length,
    moneyToPay: rows.reduce((sum, row) => sum + row.payment.amount, 0),
    cleanupPreviewSummary,
    plainTextDebug: {
      summary: {
        currentMoneyToPay: cleanupPreviewSummary.currentMoneyToPay,
        newMoneyToPay: cleanupPreviewSummary.newMoneyToPay,
        wouldMoveOut: cleanupPreviewSummary.wouldMoveOutCount,
      },
      rows: debugRows,
    },
    classificationDebug: {
      summary: {
        currentMoneyToPay: cleanupPreviewSummary.currentMoneyToPay,
        newMoneyToPay: cleanupPreviewSummary.newMoneyToPay,
        wouldMoveOut: cleanupPreviewSummary.wouldMoveOutCount,
      },
      rows: debugRows,
    },
    domainSummary,
    rows,
  };
}

export async function applyPaymentClassificationCleanup(organizationId: string) {
  const before = await buildPaymentClassificationDebug(organizationId);
  const rowsToChange = before.rows.filter((row: PaymentDebugRow) => rowNeedsCleanup(row));
  console.log(
    `[payment-cleanup] before org=${organizationId} rows=${before.rows.length} changes=${rowsToChange.length} currentMoneyToPay=${before.cleanupPreviewSummary.currentMoneyToPay}`
  );

  const result = await prisma.$transaction(async (tx) => {
    let changedRows = 0;
    for (const row of rowsToChange) {
      const amount = row.cleanupPreview.wouldBeAmount ?? 0;
      const paymentRequired = row.cleanupPreview.wouldRemainInMoneyToPay;
      await tx.supplierPayment.update({
        where: { id: row.payment.id },
        data: {
          amount,
          paymentRequired,
        },
      });

      const scanItem = row.scanItems[0];
      if (scanItem) {
        await tx.gmailScanItem.update({
          where: { id: scanItem.id },
          data: {
            amount,
            reviewStatus: row.cleanupPreview.wouldBeReviewStatus,
            decisionReason: row.cleanupPreview.wouldBeDecisionReason,
          },
        });
      }
      changedRows++;
    }

    const updatedSummary = await tx.supplierPayment.aggregate({
      where: { organizationId, paymentRequired: true, paid: false },
      _sum: { amount: true },
      _count: { id: true },
    });

    return {
      changedRows,
      newMoneyToPay: updatedSummary._sum.amount ?? 0,
      remainingRows: updatedSummary._count.id,
    };
  });

  console.log(
    `[payment-cleanup] after org=${organizationId} changed=${result.changedRows} newMoneyToPay=${result.newMoneyToPay} remainingRows=${result.remainingRows}`
  );

  return {
    beforeSummary: before.cleanupPreviewSummary,
    plannedChanges: rowsToChange.length,
    ...result,
  };
}

type PaymentDebugRow = any;

function rowNeedsCleanup(row: PaymentDebugRow) {
  const amount = row.cleanupPreview.wouldBeAmount ?? 0;
  const paymentRequired = row.cleanupPreview.wouldRemainInMoneyToPay;
  const scanItem = row.scanItems[0];
  return (
    row.payment.amount !== amount ||
    row.payment.paymentRequired !== paymentRequired ||
    scanItem?.reviewStatus !== row.cleanupPreview.wouldBeReviewStatus ||
    scanItem?.decisionReason !== row.cleanupPreview.wouldBeDecisionReason ||
    scanItem?.amount !== amount
  );
}

function cleanupRuleFired(row: PaymentDebugRow): string {
  return row.cleanupPreview.rule1FinancialSenderHold
    ? "financial-sender"
    : row.cleanupPreview.amountRejectedReason?.includes("too large")
      ? "amount-over-1M"
      : row.cleanupPreview.rule3AmountSanityFlag
        ? "amount-sanity"
        : row.cleanupPreview.wouldBeDocumentType === "receipt"
          ? "receipt-not-auto-saved"
          : row.cleanupPreview.rule2AutoSaveGateHold
            ? "auto-save-gating"
            : "would-remain-auto-saved";
}

function extractDomain(value: string | null | undefined) {
  if (!value) return "unknown";
  const match = value.toLowerCase().match(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/);
  if (match?.[1]) return match[1];
  const compact = value.trim().toLowerCase();
  return compact || "unknown";
}

function amountRejectedReason(amount: number | null | undefined) {
  if (amount == null) return null;
  if (!Number.isFinite(amount) || amount <= 0) return "parsed amount looks invalid";
  if (amount > 1_000_000) return "parsed amount looks invalid/too large";
  return null;
}

function analysisFromScanItem(scanItem: any | undefined, payment: any): EmailAnalysis {
  const raw = scanItem?.rawAnalysis;
  const analysis = raw && typeof raw === "object" && !Array.isArray(raw) && "analysis" in raw
    ? (raw as { analysis?: Partial<EmailAnalysis> }).analysis
    : undefined;
  const confidenceFromScan = scanItem?.confidenceScore === "high" ? 0.9 : scanItem?.confidenceScore === "medium" ? 0.6 : 0.3;
  return {
    supplier: analysis?.supplier || payment.supplier || "לא ידוע",
    amount: typeof analysis?.amount === "number" ? analysis.amount : payment.amount,
    currency: analysis?.currency || payment.currency || "ILS",
    documentType: analysis?.documentType === "invoice" || analysis?.documentType === "payment_request" || analysis?.documentType === "receipt" || analysis?.documentType === "other"
      ? analysis.documentType
      : scanItem?.documentType === "invoice" || scanItem?.documentType === "payment_request" || scanItem?.documentType === "receipt"
        ? scanItem.documentType
        : "other",
    paymentRequired: typeof analysis?.paymentRequired === "boolean" ? analysis.paymentRequired : payment.paymentRequired,
    dueDate: analysis?.dueDate ?? null,
    invoiceDate: analysis?.invoiceDate ?? null,
    invoiceNumber: analysis?.invoiceNumber ?? null,
    tasks: Array.isArray(analysis?.tasks) ? analysis.tasks : [],
    confidence: typeof analysis?.confidence === "number" ? analysis.confidence : confidenceFromScan,
  };
}
