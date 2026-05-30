import { Router, type Request, type Response } from "express";
import { createHash, randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import multer from "multer";
import { authMiddleware } from "../lib/auth.js";
import { errorDetails } from "../lib/errors.js";
import { databaseHost, prisma } from "../lib/prisma.js";
import { getDashboardStats, getMissingInvoicesReport } from "../services/dashboard.js";
import { buildDailySummary } from "../services/summary.js";
import {
  getWhatsAppSettings,
  saveWhatsAppSettings,
  sendWhatsAppMessage,
} from "../services/whatsapp.js";
import { testConnection as testGreenInvoiceConnection, type GreenInvoiceEnv } from "../services/green-invoice.js";
import { parseBankStatementFile } from "../services/bank-parser.js";
import { matchTransactions } from "../services/bank-matcher.js";
import { classifyGmailScanCandidate, extractInvoiceAmount } from "../services/gmail-sync.js";
import type { EmailAnalysis } from "../services/claude.js";

export const apiRouter = Router();
const bankUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

apiRouter.post("/leads/webhook", async (req, res) => {
  try {
    const { createCrmLead } = await import("../services/crm.js");
    const body = req.body as { organizationId?: string; name?: string; phone?: string; email?: string; source?: string; message?: string };
    const organization = body.organizationId
      ? await prisma.organization.findUnique({ where: { id: body.organizationId } })
      : await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!organization) {
      res.status(400).json({ error: "Organization is required" });
      return;
    }
    const lead = await createCrmLead(organization.id, {
      name: body.name,
      phone: body.phone,
      email: body.email,
      whatsapp: body.phone,
      source: body.source || "website",
      notes: body.message,
    });
    res.json({ lead });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Lead webhook failed" });
  }
});

apiRouter.use(authMiddleware);

async function debugGmailIntegrationForAuth(auth: { userId: string; organizationId: string; email: string }) {
  const current = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId: auth.organizationId, provider: "gmail" } },
  });
  const fallback = current?.refreshToken
    ? null
    : await prisma.integration.findFirst({
        where: {
          provider: "gmail",
          OR: [
            { organization: { userId: auth.userId } },
            { organization: { user: { email: auth.email } } },
          ],
          refreshToken: { not: null },
        },
        orderBy: { updatedAt: "desc" },
      });

  return current?.refreshToken || current?.accessToken ? current : fallback ?? current;
}

function debugGmailBase(auth: { userId: string; organizationId: string; email: string }, integration: Awaited<ReturnType<typeof debugGmailIntegrationForAuth>>) {
  return {
    connected: Boolean(integration?.refreshToken),
    orgId: auth.organizationId,
    userId: auth.userId,
    integrationOrgId: integration?.organizationId ?? null,
    provider: integration?.provider ?? null,
    hasAccessToken: Boolean(integration?.accessToken),
    hasRefreshToken: Boolean(integration?.refreshToken),
    connectedAt: integration?.connectedAt ?? null,
    emailsFetched: 0,
    emailsSaved: 0,
    clientsFound: 0,
    invoicesFound: 0,
    errors: 0,
  };
}

type DebugPayloadPart = {
  mimeType?: string | null;
  filename?: string | null;
  body?: { data?: string | null; attachmentId?: string | null } | null;
  parts?: DebugPayloadPart[] | null;
};

function decodeGmailBody(data: string) {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function stripDebugHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function collectDebugBody(payload: DebugPayloadPart | undefined, chunks: string[]) {
  if (!payload) return;
  if (payload.body?.data && (payload.mimeType === "text/plain" || payload.mimeType === "text/html" || !payload.parts?.length)) {
    const decoded = decodeGmailBody(payload.body.data);
    chunks.push(payload.mimeType === "text/html" ? stripDebugHtml(decoded) : decoded);
  }
  for (const part of payload.parts ?? []) collectDebugBody(part, chunks);
}

function debugBodyText(payload: DebugPayloadPart | undefined) {
  const chunks: string[] = [];
  collectDebugBody(payload, chunks);
  return chunks.join("\n").trim();
}

function debugAttachmentNames(payload: DebugPayloadPart | undefined): string[] {
  if (!payload) return [];
  return [
    ...(payload.filename ? [payload.filename] : []),
    ...(payload.parts ?? []).flatMap((part) => debugAttachmentNames(part)),
  ];
}

apiRouter.get("/debug/gmail/status", async (req, res) => {
  try {
    const integration = await debugGmailIntegrationForAuth(req.auth!);
    console.log(
      `[debug/gmail/status] user=${req.auth!.userId} org=${req.auth!.organizationId} connected=${Boolean(integration?.refreshToken)} integrationOrg=${integration?.organizationId ?? "none"} hasAccessToken=${Boolean(integration?.accessToken)} hasRefreshToken=${Boolean(integration?.refreshToken)}`
    );
    res.json(debugGmailBase(req.auth!, integration));
  } catch (err) {
    console.error("[debug/gmail/status] failed", errorDetails(err));
    res.status(500).json({
      connected: false,
      orgId: req.auth?.organizationId ?? null,
      userId: req.auth?.userId ?? null,
      hasAccessToken: false,
      hasRefreshToken: false,
      emailsFetched: 0,
      emailsSaved: 0,
      clientsFound: 0,
      invoicesFound: 0,
      errors: 1,
      error: err instanceof Error ? err.message : String(err),
      details: errorDetails(err),
    });
  }
});

apiRouter.get("/debug/invoices", async (req, res) => {
  const startedAt = Date.now();
  const orgId = req.auth!.organizationId;
  const userId = req.auth!.userId;
  const QUERY_TIMEOUT_MS = 1900;

  function withQueryTimeout<T>(label: string, query: Promise<T>) {
    const queryStartedAt = Date.now();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    return Promise.race([
      query.then((result) => {
        console.log(`[debug/invoices] query=${label} org=${orgId} ms=${Date.now() - queryStartedAt} ok=true`);
        return result;
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const ms = Date.now() - queryStartedAt;
          console.error(`[debug/invoices] query=${label} org=${orgId} ms=${ms} ok=false reason=timeout`);
          reject(new Error(`${label} timed out after ${QUERY_TIMEOUT_MS}ms`));
        }, QUERY_TIMEOUT_MS);
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
  }

  try {
    const [
      invoiceCount,
      supplierPaymentCount,
      gmailScanItemCount,
      invoiceScanItemCount,
      badAmountCount,
      lastInvoiceRows,
      lastPaymentRows,
      rejectedInvoiceReasons,
    ] = await Promise.all([
      withQueryTimeout("invoice_count", prisma.invoice.count({ where: { organizationId: orgId } })),
      withQueryTimeout("supplier_payment_count", prisma.supplierPayment.count({ where: { organizationId: orgId } })),
      withQueryTimeout("gmail_scan_item_count", prisma.gmailScanItem.count({ where: { organizationId: orgId } })),
      withQueryTimeout("invoice_scan_item_count", prisma.gmailScanItem.count({
        where: { organizationId: orgId, documentType: { in: ["invoice", "receipt"] } },
      })),
      withQueryTimeout("bad_amount_count", prisma.invoice.count({
        where: { organizationId: orgId, amount: { gt: 10_000_000 } },
      })),
      withQueryTimeout("latest_20_invoices", prisma.invoice.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          clientId: true,
          invoiceNumber: true,
          amount: true,
          currency: true,
          date: true,
          dueDate: true,
          status: true,
          description: true,
          driveUrl: true,
          emailId: true,
          fromEmail: true,
          gmailMessageId: true,
          createdAt: true,
          client: { select: { id: true, name: true, email: true, domain: true } },
        },
      })),
      withQueryTimeout("latest_20_supplier_payments", prisma.supplierPayment.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          supplier: true,
          amount: true,
          currency: true,
          date: true,
          dueDate: true,
          paid: true,
          documentLink: true,
          invoiceLink: true,
          missingInvoice: true,
          subject: true,
          emailMessageId: true,
          createdAt: true,
        },
      })),
      withQueryTimeout("latest_20_rejected_invoice_reasons", prisma.gmailScanItem.findMany({
        where: {
          organizationId: orgId,
          OR: [
            { documentType: { in: ["invoice", "receipt", "unknown_needs_review"] } },
            { reviewStatus: { in: ["needs_review", "failed", "rejected"] } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          gmailMessageId: true,
          subject: true,
          documentType: true,
          reviewStatus: true,
          decisionReason: true,
          createdAt: true,
        },
      })),
    ]);
    const totalMs = Date.now() - startedAt;
    console.log(`[debug/invoices] complete org=${orgId} totalMs=${totalMs}`);

    res.json({
      orgId,
      userId,
      invoiceCount,
      supplierPaymentCount,
      gmailScanItemCount,
      invoiceScanItemCount,
      badAmountCount,
      lastInvoiceRows,
      lastPaymentRows,
      rejectedInvoiceReasons,
    });
  } catch (err) {
    console.error("[debug/invoices] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Invoice debug failed" });
  }
});

apiRouter.get("/debug/invoices/bad-amounts", async (req, res) => {
  const orgId = req.auth!.organizationId;
  const threshold = 10_000_000;
  try {
    const [badInvoiceCount, sampleRows] = await Promise.all([
      prisma.invoice.count({
        where: { organizationId: orgId, amount: { gt: threshold } },
      }),
      prisma.invoice.findMany({
        where: { organizationId: orgId, amount: { gt: threshold } },
        orderBy: { amount: "desc" },
        take: 20,
        select: {
          id: true,
          amount: true,
          invoiceNumber: true,
          description: true,
          gmailMessageId: true,
          createdAt: true,
        },
      }),
    ]);

    res.json({
      orgId,
      threshold,
      badInvoiceCount,
      sampleRows,
    });
  } catch (err) {
    console.error("[debug/invoices/bad-amounts] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Bad invoice amount debug failed" });
  }
});

apiRouter.get("/debug/payments/top-amounts", async (req, res) => {
  const orgId = req.auth!.organizationId;
  try {
    const where = {
      organizationId: orgId,
      paid: false,
      paymentRequired: true,
      amount: { gte: 0, lte: 1_000_000 },
    };
    const [summary, rows] = await Promise.all([
      prisma.supplierPayment.aggregate({
        where,
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.supplierPayment.findMany({
        where,
        orderBy: { amount: "desc" },
        take: 10,
        select: {
          id: true,
          amount: true,
          currency: true,
          supplier: true,
          date: true,
          dueDate: true,
          source: true,
          subject: true,
          emailSender: true,
          emailMessageId: true,
          documentLink: true,
          invoiceLink: true,
          createdAt: true,
        },
      }),
    ]);

    res.json({
      orgId,
      countedRows: summary._count.id,
      moneyToPay: summary._sum.amount ?? 0,
      rows,
    });
  } catch (err) {
    console.error("[debug/payments/top-amounts] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Top payment amounts debug failed" });
  }
});

apiRouter.get("/debug/payments/classification-investigation", async (req, res) => {
  const orgId = req.auth!.organizationId;
  try {
    const payments = await prisma.supplierPayment.findMany({
      where: {
        organizationId: orgId,
        paymentRequired: true,
        paid: false,
      },
      orderBy: [{ amount: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
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
        ? prisma.emailMessage.findMany({
            where: {
              organizationId: orgId,
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
        ? prisma.gmailScanItem.findMany({
            where: {
              organizationId: orgId,
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

    const extractDomain = (value: string | null | undefined) => {
      if (!value) return "unknown";
      const match = value.toLowerCase().match(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/);
      if (match?.[1]) return match[1];
      const compact = value.trim().toLowerCase();
      return compact || "unknown";
    };

    const amountRejectedReason = (amount: number | null | undefined) => {
      if (amount == null) return null;
      if (!Number.isFinite(amount) || amount <= 0) return "parsed amount looks invalid";
      if (amount > 1_000_000) return "parsed amount looks invalid/too large";
      return null;
    };

    const analysisFromScanItem = (scanItem: typeof scanItems[number] | undefined, payment: typeof payments[number]): EmailAnalysis => {
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
    };

    const rows = payments.map((payment) => {
      const email = payment.emailMessageId
        ? emailById.get(payment.emailMessageId) ?? emailByGmailId.get(payment.emailMessageId) ?? null
        : null;
      const relatedScanItems = payment.emailMessageId
        ? scanItemsByEmailRef.get(payment.emailMessageId) ?? (email?.gmailId ? scanItemsByEmailRef.get(email.gmailId) : undefined) ?? []
        : [];
      const primaryScanItem = relatedScanItems[0];
      const senderDomain = extractDomain(payment.emailSender ?? email?.fromAddress);
      const textForNewRules = `${email?.subject ?? payment.subject ?? ""}\n${email?.bodyText ?? ""}`;
      const parsedAmount = extractInvoiceAmount(textForNewRules);
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

    res.json({
      orgId,
      countedRows: rows.length,
      moneyToPay: rows.reduce((sum, row) => sum + row.payment.amount, 0),
      cleanupPreviewSummary,
      domainSummary,
      rows,
    });
  } catch (err) {
    console.error("[debug/payments/classification-investigation] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Payment classification investigation debug failed" });
  }
});

type GreenInvoiceConnectBody = {
  apiKeyId?: unknown;
  apiSecret?: unknown;
  env?: unknown;
};

function normalizeGreenInvoiceEnv(value: unknown): GreenInvoiceEnv | null {
  if (value === undefined || value === null || value === "") return "sandbox";
  if (value === "sandbox" || value === "production") return value;
  return null;
}

apiRouter.post("/green-invoice/connect", async (req, res) => {
  const orgId = req.auth!.organizationId;
  const body = (req.body ?? {}) as GreenInvoiceConnectBody;
  const apiKeyId = typeof body.apiKeyId === "string" ? body.apiKeyId.trim() : "";
  const apiSecret = typeof body.apiSecret === "string" ? body.apiSecret.trim() : "";
  const env = normalizeGreenInvoiceEnv(body.env);

  if (!apiKeyId || !apiSecret) {
    res.status(400).json({ success: false, error: "apiKeyId and apiSecret are required" });
    return;
  }
  if (!env) {
    res.status(400).json({ success: false, error: "env must be either sandbox or production" });
    return;
  }

  try {
    const result = await testGreenInvoiceConnection(apiKeyId, apiSecret, env);
    if (!result.success) {
      res.json(result);
      return;
    }

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        greenInvoiceApiKeyId: apiKeyId,
        greenInvoiceApiSecret: apiSecret,
        greenInvoiceEnv: env,
        greenInvoiceConnectedAt: new Date(),
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[green-invoice/connect] failed", errorDetails(err));
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Green Invoice connect failed" });
  }
});

apiRouter.get("/green-invoice/status", async (req, res) => {
  const orgId = req.auth!.organizationId;
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        greenInvoiceApiKeyId: true,
        greenInvoiceEnv: true,
        greenInvoiceConnectedAt: true,
      },
    });

    res.json({
      connected: Boolean(organization?.greenInvoiceApiKeyId && organization.greenInvoiceConnectedAt),
      env: organization?.greenInvoiceEnv ?? "sandbox",
      connectedAt: organization?.greenInvoiceConnectedAt ?? null,
    });
  } catch (err) {
    console.error("[green-invoice/status] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Green Invoice status failed" });
  }
});

apiRouter.post("/green-invoice/test", async (req, res) => {
  const orgId = req.auth!.organizationId;
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        greenInvoiceApiKeyId: true,
        greenInvoiceApiSecret: true,
        greenInvoiceEnv: true,
      },
    });

    const env = normalizeGreenInvoiceEnv(organization?.greenInvoiceEnv);
    if (!organization?.greenInvoiceApiKeyId || !organization.greenInvoiceApiSecret || !env) {
      res.json({ success: false, error: "Green Invoice is not connected" });
      return;
    }

    const result = await testGreenInvoiceConnection(
      organization.greenInvoiceApiKeyId,
      organization.greenInvoiceApiSecret,
      env
    );
    res.json(result);
  } catch (err) {
    console.error("[green-invoice/test] failed", errorDetails(err));
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Green Invoice test failed" });
  }
});

apiRouter.post("/bank/upload", bankUpload.single("file"), async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "Bank statement file is required" });
    return;
  }

  const statement = await prisma.bankStatement.create({
    data: {
      organizationId,
      fileName: file.originalname || "bank-statement",
      status: "processing",
    },
  });

  try {
    const parsed = parseBankStatementFile({
      buffer: file.buffer,
      fileName: file.originalname || "bank-statement",
      mimeType: file.mimetype,
    });
    const suggestions = await matchTransactions(organizationId, parsed.transactions);

    const rows = await prisma.$transaction(
      parsed.transactions.map((transaction, index) => {
        const suggestion = suggestions[index];
        const matchedInvoiceId = suggestion?.matchedRecordType === "invoice" ? suggestion.matchedRecordId : null;
        const matchedSupplierPaymentId = suggestion?.matchedRecordType === "supplierPayment" ? suggestion.matchedRecordId : null;
        const matchStatus = suggestion?.matchType === "suggested" ? "suggested" : "unmatched";

        return prisma.bankTransaction.create({
          data: {
            bankStatementId: statement.id,
            organizationId,
            date: transaction.date,
            amount: transaction.amount,
            description: transaction.description,
            direction: transaction.direction,
            rawData: transaction.rawData,
            matchStatus,
            matchedInvoiceId,
            matchedSupplierPaymentId,
            matchConfidence: suggestion?.confidence ?? null,
          },
        });
      })
    );

    const summary = summarizeBankTransactions(rows.map((row) => row.matchStatus));
    await prisma.bankStatement.update({
      where: { id: statement.id },
      data: {
        status: "ready",
        transactionCount: rows.length,
      },
    });

    res.json({
      statementId: statement.id,
      transactionCount: rows.length,
      summary,
      warnings: parsed.warnings,
    });
  } catch (err) {
    console.error("[bank/upload] failed", errorDetails(err));
    await prisma.bankStatement.update({
      where: { id: statement.id },
      data: { status: "error" },
    }).catch(() => undefined);
    res.status(500).json({ error: err instanceof Error ? err.message : "Bank statement upload failed" });
  }
});

apiRouter.get("/bank/statements", async (req, res) => {
  const organizationId = req.auth!.organizationId;
  try {
    const statements = await prisma.bankStatement.findMany({
      where: { organizationId },
      orderBy: { uploadedAt: "desc" },
      select: {
        id: true,
        fileName: true,
        uploadedAt: true,
        status: true,
        transactionCount: true,
      },
    });
    res.json({ statements });
  } catch (err) {
    console.error("[bank/statements] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Bank statements fetch failed" });
  }
});

apiRouter.get("/bank/statements/:id", async (req, res) => {
  const organizationId = req.auth!.organizationId;
  try {
    const statement = await prisma.bankStatement.findFirst({
      where: { id: req.params.id, organizationId },
      include: {
        transactions: {
          orderBy: { date: "desc" },
        },
      },
    });
    if (!statement) {
      res.status(404).json({ error: "Bank statement not found" });
      return;
    }

    const invoiceIds = statement.transactions
      .map((transaction) => transaction.matchedInvoiceId)
      .filter((id): id is string => Boolean(id));
    const supplierPaymentIds = statement.transactions
      .map((transaction) => transaction.matchedSupplierPaymentId)
      .filter((id): id is string => Boolean(id));

    const [invoices, supplierPayments] = await Promise.all([
      invoiceIds.length
        ? prisma.invoice.findMany({
            where: { organizationId, id: { in: invoiceIds } },
            select: {
              id: true,
              invoiceNumber: true,
              amount: true,
              date: true,
              status: true,
              client: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
      supplierPaymentIds.length
        ? prisma.supplierPayment.findMany({
            where: { organizationId, id: { in: supplierPaymentIds } },
            select: {
              id: true,
              supplier: true,
              amount: true,
              date: true,
              paid: true,
              subject: true,
            },
          })
        : Promise.resolve([]),
    ]);
    const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
    const supplierPaymentById = new Map(supplierPayments.map((payment) => [payment.id, payment]));

    res.json({
      statement: {
        id: statement.id,
        fileName: statement.fileName,
        uploadedAt: statement.uploadedAt,
        status: statement.status,
        transactionCount: statement.transactionCount,
      },
      transactions: statement.transactions.map((transaction) => ({
        ...transaction,
        matchedRecord: transaction.matchedInvoiceId
          ? { type: "invoice", record: invoiceById.get(transaction.matchedInvoiceId) ?? null }
          : transaction.matchedSupplierPaymentId
            ? { type: "supplierPayment", record: supplierPaymentById.get(transaction.matchedSupplierPaymentId) ?? null }
            : null,
      })),
    });
  } catch (err) {
    console.error("[bank/statements/:id] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Bank statement fetch failed" });
  }
});

apiRouter.post("/bank/transactions/:id/confirm", async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const body = (req.body ?? {}) as { matchedRecordType?: unknown; matchedRecordId?: unknown };

  try {
    const transaction = await prisma.bankTransaction.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!transaction) {
      res.status(404).json({ error: "Bank transaction not found" });
      return;
    }

    const overrideType = body.matchedRecordType === "invoice" || body.matchedRecordType === "supplierPayment"
      ? body.matchedRecordType
      : null;
    const overrideId = typeof body.matchedRecordId === "string" && body.matchedRecordId.trim()
      ? body.matchedRecordId.trim()
      : null;

    const targetType = overrideType ?? (transaction.matchedInvoiceId ? "invoice" : transaction.matchedSupplierPaymentId ? "supplierPayment" : null);
    const targetId = overrideId ?? transaction.matchedInvoiceId ?? transaction.matchedSupplierPaymentId;
    if (!targetType || !targetId) {
      res.status(400).json({ error: "No matched record to confirm" });
      return;
    }

    const validTarget = targetType === "invoice"
      ? await prisma.invoice.findFirst({ where: { id: targetId, organizationId }, select: { id: true } })
      : await prisma.supplierPayment.findFirst({ where: { id: targetId, organizationId }, select: { id: true } });
    if (!validTarget) {
      res.status(404).json({ error: "Matched record not found" });
      return;
    }

    const updated = await prisma.bankTransaction.update({
      where: { id: transaction.id },
      data: {
        matchStatus: "matched",
        matchedInvoiceId: targetType === "invoice" ? targetId : null,
        matchedSupplierPaymentId: targetType === "supplierPayment" ? targetId : null,
        matchConfidence: transaction.matchConfidence ?? 1,
      },
    });
    res.json({ transaction: updated });
  } catch (err) {
    console.error("[bank/transactions/confirm] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Bank transaction confirm failed" });
  }
});

apiRouter.post("/bank/transactions/:id/reject", async (req, res) => {
  const organizationId = req.auth!.organizationId;
  try {
    const transaction = await prisma.bankTransaction.findFirst({
      where: { id: req.params.id, organizationId },
      select: { id: true },
    });
    if (!transaction) {
      res.status(404).json({ error: "Bank transaction not found" });
      return;
    }

    const updated = await prisma.bankTransaction.update({
      where: { id: transaction.id },
      data: {
        matchStatus: "unmatched",
        matchedInvoiceId: null,
        matchedSupplierPaymentId: null,
        matchConfidence: null,
      },
    });
    res.json({ transaction: updated });
  } catch (err) {
    console.error("[bank/transactions/reject] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Bank transaction reject failed" });
  }
});

function summarizeBankTransactions(statuses: string[]) {
  return {
    matched: statuses.filter((status) => status === "matched").length,
    suggested: statuses.filter((status) => status === "suggested").length,
    unmatched: statuses.filter((status) => status === "unmatched").length,
  };
}

apiRouter.post("/debug/invoices/fix-bad-amounts", async (req, res) => {
  const orgId = req.auth!.organizationId;
  const threshold = 10_000_000;
  try {
    const result = await prisma.invoice.updateMany({
      where: { organizationId: orgId, amount: { gt: threshold } },
      data: { amount: 0 },
    });

    console.log(`[debug/invoices/fix-bad-amounts] org=${orgId} threshold=${threshold} updated=${result.count}`);
    res.json({
      orgId,
      threshold,
      updatedCount: result.count,
    });
  } catch (err) {
    console.error("[debug/invoices/fix-bad-amounts] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Bad invoice amount cleanup failed" });
  }
});

type DriveMergeJobStatus = "running" | "done" | "error";
type DriveMergeFolder = {
  id: string;
  name: string;
  createdTime: string | null;
  parentLabel: string;
};
type DriveMergeChild = {
  id: string;
  name: string;
  mimeType: string | null;
};
type DriveMergeResult = {
  dryRun: boolean;
  rootFolderId: string;
  searchedRoots: Array<{
    id: string;
    name: string;
    matchedCandidateName: string;
    directSupplierFolderCount: number;
    legacySupplierFolderCount: number;
    supplierFolderCount: number;
  }>;
  duplicateGroups: number;
  foldersMerged: number;
  filesMoved: number;
  groups: Array<{
    normalizedName: string;
    keep: DriveMergeFolder;
    duplicates: Array<DriveMergeFolder & { childCount: number; children: DriveMergeChild[] }>;
  }>;
};
type DriveMergeJob = {
  id: string;
  organizationId: string;
  dryRun: boolean;
  status: DriveMergeJobStatus;
  progress: string;
  result?: DriveMergeResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

const driveMergeJobs = new Map<string, DriveMergeJob>();
const supplierParentFolderNames = ["Invoices", "Receipts", "Payment Requests", "Missing Invoices", "Other"];

function updateDriveMergeJob(jobId: string, update: Partial<DriveMergeJob>) {
  const job = driveMergeJobs.get(jobId);
  if (!job) return;
  driveMergeJobs.set(jobId, { ...job, ...update, updatedAt: Date.now() });
}

function cleanupOldDriveMergeJobs() {
  const cutoff = Date.now() - 1000 * 60 * 60;
  for (const [jobId, job] of driveMergeJobs.entries()) {
    if (job.updatedAt < cutoff) driveMergeJobs.delete(jobId);
  }
}

async function runDriveDuplicateFolderMergeJob(jobId: string, organizationId: string, dryRun: boolean) {
  try {
    updateDriveMergeJob(jobId, { progress: "Connecting to Google Drive" });
    const { getGoogleClients } = await import("../services/google.js");
    const {
      INVOICE_DRIVE_FOLDER_NAME,
      normalizedSupplierFolderName,
    } = await import("../services/driveService.js");
    const { config } = await import("../lib/config.js");
    const { drive } = await getGoogleClients(organizationId);

    async function listChildFolders(parentId: string, parentLabel: string): Promise<DriveMergeFolder[]> {
      const folders: DriveMergeFolder[] = [];
      let pageToken: string | undefined;
      do {
        const result = await drive.files.list({
          q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: "nextPageToken, files(id, name, createdTime)",
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        for (const folder of result.data.files ?? []) {
          if (!folder.id || !folder.name) continue;
          if (parentLabel === "Root" && supplierParentFolderNames.includes(folder.name)) continue;
          folders.push({
            id: folder.id,
            name: folder.name,
            createdTime: folder.createdTime ?? null,
            parentLabel,
          });
        }
        pageToken = result.data.nextPageToken ?? undefined;
      } while (pageToken);
      return folders;
    }

    async function findFoldersByName(name: string): Promise<DriveMergeFolder[]> {
      const folders: DriveMergeFolder[] = [];
      let pageToken: string | undefined;
      do {
        const result = await drive.files.list({
          q: `name='${escapeDriveMergeQueryValue(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: "nextPageToken, files(id, name, createdTime)",
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        for (const folder of result.data.files ?? []) {
          if (!folder.id || !folder.name) continue;
          folders.push({
            id: folder.id,
            name: folder.name,
            createdTime: folder.createdTime ?? null,
            parentLabel: "Candidate root",
          });
        }
        pageToken = result.data.nextPageToken ?? undefined;
      } while (pageToken);
      return folders;
    }

    async function listChildren(folderId: string): Promise<DriveMergeChild[]> {
      const children: DriveMergeChild[] = [];
      let pageToken: string | undefined;
      do {
        const result = await drive.files.list({
          q: `'${folderId}' in parents and trashed=false`,
          fields: "nextPageToken, files(id, name, mimeType)",
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        for (const child of result.data.files ?? []) {
          if (!child.id || !child.name) continue;
          children.push({ id: child.id, name: child.name, mimeType: child.mimeType ?? null });
        }
        pageToken = result.data.nextPageToken ?? undefined;
      } while (pageToken);
      return children;
    }

    updateDriveMergeJob(jobId, { progress: "Resolving candidate Drive roots" });
    const candidateRootNames = Array.from(new Set([INVOICE_DRIVE_FOLDER_NAME, config.driveRootFolder].filter(Boolean)));
    const rootCandidates: Array<DriveMergeFolder & { matchedCandidateName: string }> = [];
    const seenRootIds = new Set<string>();

    for (const candidateName of candidateRootNames) {
      const matchingRoots = await findFoldersByName(candidateName);
      for (const root of matchingRoots) {
        if (seenRootIds.has(root.id)) continue;
        seenRootIds.add(root.id);
        rootCandidates.push({ ...root, matchedCandidateName: candidateName });
      }
    }

    updateDriveMergeJob(jobId, { progress: `Listing supplier folders under ${rootCandidates.length} Drive roots` });
    const allFolders: DriveMergeFolder[] = [];
    const searchedRoots: DriveMergeResult["searchedRoots"] = [];
    const excludedDirectFolderNames = new Set([...supplierParentFolderNames, ...candidateRootNames]);

    for (const root of rootCandidates) {
      const rootChildFolders = await listChildFolders(root.id, `${root.name} / Root`);
      const directSupplierFolders = rootChildFolders
        .filter((folder) => !excludedDirectFolderNames.has(folder.name))
        .map((folder) => ({ ...folder, parentLabel: `${root.name} / Root` }));
      const legacyParentFolders = rootChildFolders.filter((folder) => supplierParentFolderNames.includes(folder.name));
      const legacySupplierFolders = (await Promise.all(
        legacyParentFolders.map((folder) => listChildFolders(folder.id, `${root.name} / ${folder.name}`))
      )).flat();

      allFolders.push(...directSupplierFolders, ...legacySupplierFolders);
      searchedRoots.push({
        id: root.id,
        name: root.name,
        matchedCandidateName: root.matchedCandidateName,
        directSupplierFolderCount: directSupplierFolders.length,
        legacySupplierFolderCount: legacySupplierFolders.length,
        supplierFolderCount: directSupplierFolders.length + legacySupplierFolders.length,
      });
    }

    const groups = new Map<string, DriveMergeFolder[]>();
    for (const folder of allFolders) {
      const normalized = normalizedSupplierFolderName(folder.name).toLowerCase();
      const current = groups.get(normalized) ?? [];
      current.push(folder);
      groups.set(normalized, current);
    }

    const duplicatePlans: DriveMergeResult["groups"] = [];
    let foldersMerged = 0;
    let filesMoved = 0;
    let processedGroups = 0;
    const duplicateGroups = Array.from(groups.values()).filter((folders) => folders.length > 1).length;

    for (const [normalizedName, folders] of groups.entries()) {
      if (folders.length < 2) continue;
      processedGroups++;
      updateDriveMergeJob(jobId, { progress: `Processing duplicate group ${processedGroups}/${duplicateGroups}: ${normalizedName}` });
      const sorted = [...folders].sort((a, b) => {
        const aTime = a.createdTime ? new Date(a.createdTime).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.createdTime ? new Date(b.createdTime).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      });
      const keep = sorted[0];
      const duplicates = sorted.slice(1);
      const duplicateDetails: Array<DriveMergeFolder & { childCount: number; children: DriveMergeChild[] }> = [];

      for (const duplicate of duplicates) {
        const children = await listChildren(duplicate.id);
        foldersMerged++;
        filesMoved += children.length;
        duplicateDetails.push({
          ...duplicate,
          childCount: children.length,
          children: children.slice(0, 20),
        });

        if (!dryRun) {
          updateDriveMergeJob(jobId, { progress: `Moving ${children.length} items from ${duplicate.name}` });
          for (const child of children) {
            await drive.files.update({
              fileId: child.id,
              addParents: keep.id,
              removeParents: duplicate.id,
              fields: "id, parents",
              supportsAllDrives: true,
            });
          }
          await drive.files.delete({ fileId: duplicate.id, supportsAllDrives: true });
        }
      }

      duplicatePlans.push({
        normalizedName,
        keep,
        duplicates: duplicateDetails,
      });
    }

    updateDriveMergeJob(jobId, {
      status: "done",
      progress: dryRun ? "Dry-run complete" : "Merge complete",
      result: {
        dryRun,
        rootFolderId: rootCandidates[0]?.id ?? "",
        searchedRoots,
        duplicateGroups: duplicatePlans.length,
        foldersMerged,
        filesMoved,
        groups: duplicatePlans,
      },
    });
  } catch (err) {
    console.error("[debug/drive/merge-duplicate-folders] job failed", errorDetails(err));
    updateDriveMergeJob(jobId, {
      status: "error",
      progress: "Drive duplicate folder merge failed",
      error: err instanceof Error ? err.message : "Drive duplicate folder merge failed",
    });
  }
}

function escapeDriveMergeQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

apiRouter.post("/debug/drive/merge-duplicate-folders", (req, res) => {
  cleanupOldDriveMergeJobs();
  const dryRun = (req.body as { dryRun?: boolean } | undefined)?.dryRun !== false;
  const jobId = randomUUID();
  driveMergeJobs.set(jobId, {
    id: jobId,
    organizationId: req.auth!.organizationId,
    dryRun,
    status: "running",
    progress: dryRun ? "Queued dry-run Drive duplicate folder scan" : "Queued real Drive duplicate folder merge",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  void runDriveDuplicateFolderMergeJob(jobId, req.auth!.organizationId, dryRun);

  res.status(202).json({
    jobId,
    id: jobId,
    dryRun,
    status: "running",
    progress: dryRun ? "Queued dry-run Drive duplicate folder scan" : "Queued real Drive duplicate folder merge",
  });
});

apiRouter.get("/debug/drive/merge-status/:jobId", (req, res) => {
  const job = driveMergeJobs.get(req.params.jobId);
  if (!job || job.organizationId !== req.auth!.organizationId) {
    res.status(404).json({ error: "Drive merge job not found" });
    return;
  }

  res.json({
    jobId: job.id,
    id: job.id,
    dryRun: job.dryRun,
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
  });
});

apiRouter.get("/debug/invoices-auth", async (req, res) => {
  try {
    const organizationId = req.auth!.organizationId;
    const userId = req.auth!.userId;
    const email = req.auth!.email;
    const [invoiceCount, supplierPaymentCount, gmailScanItemCount, invoiceScanItemCount] = await Promise.all([
      prisma.invoice.count({ where: { organizationId } }),
      prisma.supplierPayment.count({ where: { organizationId } }),
      prisma.gmailScanItem.count({ where: { organizationId } }),
      prisma.gmailScanItem.count({ where: { organizationId, documentType: { in: ["invoice", "receipt"] } } }),
    ]);
    const latestInvoiceRows = await prisma.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        organizationId: true,
        clientId: true,
        invoiceNumber: true,
        amount: true,
        currency: true,
        date: true,
        status: true,
        driveUrl: true,
        emailId: true,
        gmailMessageId: true,
        createdAt: true,
        client: { select: { id: true, organizationId: true, name: true, email: true, domain: true } },
      },
    });
    const latestInvoiceScanItems = await prisma.gmailScanItem.findMany({
      where: { organizationId, documentType: { in: ["invoice", "receipt"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        organizationId: true,
        emailMessageId: true,
        gmailMessageId: true,
        subject: true,
        amount: true,
        supplierName: true,
        documentType: true,
        driveFileLink: true,
        reviewStatus: true,
        decisionReason: true,
        createdAt: true,
      },
    });
    const latestGmailScanLogs = await prisma.syncLog.findMany({
      where: { organizationId, type: "gmail_scan" },
      orderBy: { startedAt: "desc" },
      take: 5,
      select: {
        id: true,
        organizationId: true,
        status: true,
        scanMode: true,
        emailsProcessed: true,
        emailsSaved: true,
        invoicesFound: true,
        paymentsCreated: true,
        driveUploaded: true,
        sheetsUpdated: true,
        errorsCount: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true,
      },
    });

    res.json({
      authenticatedUser: { userId, email, organizationId },
      database: { host: databaseHost() },
      counts: {
        invoiceCount,
        supplierPaymentCount,
        gmailScanItemCount,
        invoiceScanItemCount,
      },
      latestInvoiceRows,
      latestInvoiceScanItems,
      latestGmailScanLogs,
    });
  } catch (err) {
    console.error("[debug/invoices-auth] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Invoice auth debug failed" });
  }
});

apiRouter.post("/debug/gmail/test-fetch", async (req, res) => {
  const integration = await debugGmailIntegrationForAuth(req.auth!);
  const base = debugGmailBase(req.auth!, integration);
  if (!integration?.refreshToken) {
    res.status(409).json({ ...base, error: "GMAIL_NOT_CONNECTED", errors: 1 });
    return;
  }

  try {
    const { getGoogleClients } = await import("../services/google.js");
    const { gmail } = await getGoogleClients(integration.organizationId);
    const result = await gmail.users.messages.list({
      userId: "me",
      q: "newer_than:90d -category:promotions -category:social -in:spam -in:trash",
      maxResults: 10,
    });
    const messages = result.data.messages ?? [];
    const firstMessage = messages.find((message) => message.id);
    let trace: Record<string, unknown> = {
      parserRejected: true,
      rejectReason: "NO_MESSAGES_RETURNED",
      dbSaveAttempted: false,
    };
    let emailsSaved = 0;

    if (firstMessage?.id) {
      console.log(`[debug/gmail/test-fetch] trace start org=${integration.organizationId} message=${firstMessage.id}`);
      const full = await gmail.users.messages.get({
        userId: "me",
        id: firstMessage.id,
        format: "full",
      });
      const headers = full.data.payload?.headers ?? [];
      const subject = headers.find((header) => header.name === "Subject")?.value ?? "(no subject)";
      const from = headers.find((header) => header.name === "From")?.value ?? "";
      const dateHeader = headers.find((header) => header.name === "Date")?.value ?? "";
      const receivedAt = dateHeader ? new Date(dateHeader) : new Date();
      const bodyText = debugBodyText(full.data.payload as DebugPayloadPart | undefined);
      const attachmentNames = debugAttachmentNames(full.data.payload as DebugPayloadPart | undefined);
      const parserRejected = bodyText.length === 0 && attachmentNames.length === 0;
      const rejectReason = parserRejected ? "EMPTY_BODY_AND_NO_ATTACHMENTS" : null;

      console.log(`[debug/gmail/test-fetch] message=${firstMessage.id} subject="${subject}" from="${from}" date="${receivedAt.toISOString()}" bodyLength=${bodyText.length} attachments=${attachmentNames.join(",") || "none"} parserRejected=${parserRejected} reason=${rejectReason ?? "accepted"}`);
      console.log(`[debug/gmail/test-fetch] DB save attempt message=${firstMessage.id}`);
      const emailRecord = await prisma.emailMessage.upsert({
        where: {
          organizationId_gmailId: {
            organizationId: integration.organizationId,
            gmailId: firstMessage.id,
          },
        },
        create: {
          organizationId: integration.organizationId,
          gmailId: firstMessage.id,
          threadId: full.data.threadId ?? undefined,
          subject,
          fromAddress: from,
          snippet: full.data.snippet ?? undefined,
          bodyText,
          receivedAt,
          source: "gmail",
        },
        update: {
          subject,
          fromAddress: from,
          snippet: full.data.snippet ?? undefined,
          bodyText,
          receivedAt,
        },
      });
      console.log(`[debug/gmail/test-fetch] DB EmailMessage upsert success message=${firstMessage.id} id=${emailRecord.id}`);

      const duplicateKey = createHash("sha256")
        .update(`${firstMessage.id}|debug-trace`)
        .digest("hex")
        .slice(0, 40);
      const scanItem = await prisma.gmailScanItem.upsert({
        where: {
          organizationId_duplicateKey: {
            organizationId: integration.organizationId,
            duplicateKey,
          },
        },
        create: {
          organizationId: integration.organizationId,
          emailMessageId: emailRecord.id,
          gmailMessageId: firstMessage.id,
          gmailMessageLink: `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(firstMessage.id)}`,
          sender: from || "unknown",
          senderEmail: null,
          subject,
          occurredAt: receivedAt,
          supplierName: from || "unknown",
          documentType: parserRejected ? "unknown_needs_review" : "supplier_message",
          attachmentFilename: attachmentNames[0] ?? null,
          confidenceScore: "low",
          reviewStatus: "needs_review",
          duplicateKey,
          decisionReason: rejectReason ?? "Debug trace accepted message for persistence verification",
          rawAnalysis: {
            debugTrace: true,
            bodyLength: bodyText.length,
            attachments: attachmentNames,
            snippet: full.data.snippet ?? null,
          },
        },
        update: {
          emailMessageId: emailRecord.id,
          subject,
          occurredAt: receivedAt,
          attachmentFilename: attachmentNames[0] ?? null,
          decisionReason: rejectReason ?? "Debug trace accepted message for persistence verification",
          rawAnalysis: {
            debugTrace: true,
            bodyLength: bodyText.length,
            attachments: attachmentNames,
            snippet: full.data.snippet ?? null,
          },
        },
      });
      emailsSaved = 1;
      console.log(`[debug/gmail/test-fetch] DB GmailScanItem upsert success message=${firstMessage.id} id=${scanItem.id}`);
      console.log(`[debug/gmail/test-fetch] Drive upload attempt skipped message=${firstMessage.id} reason=debug_test_fetch_no_attachment_upload`);
      trace = {
        gmailMessageId: firstMessage.id,
        subject,
        from,
        date: receivedAt.toISOString(),
        rawParsedBodyLength: bodyText.length,
        attachmentNames,
        parserRejected,
        rejectReason,
        dbSaveAttempted: true,
        emailMessageId: emailRecord.id,
        gmailScanItemId: scanItem.id,
        driveUploadAttempted: false,
        driveUploadResult: "skipped_debug_test_fetch",
      };
    }

    res.json({
      ...base,
      connected: true,
      emailsFetched: messages.length,
      emailsSaved,
      errors: 0,
      messageIds: messages.map((message) => message.id).filter(Boolean),
      trace,
    });
  } catch (err) {
    console.error("[debug/gmail/test-fetch] trace failed", err);
    res.status(500).json({
      ...base,
      errors: 1,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

apiRouter.post("/debug/gmail/scan-90", async (req, res) => {
  const integration = await debugGmailIntegrationForAuth(req.auth!);
  const base = debugGmailBase(req.auth!, integration);
  if (!integration?.refreshToken) {
    res.status(409).json({ ...base, error: "GMAIL_NOT_CONNECTED", errors: 1 });
    return;
  }

  try {
    const { syncGmailForOrganization } = await import("../services/gmail-sync.js");
    const { scanLog, created } = await createRunningGmailScanLog(integration.organizationId, "manual");
    if (created) {
      void syncGmailForOrganization(integration.organizationId, {
        daysBack: 90,
        forceReprocess: true,
        scanLogId: scanLog.id,
        scanMode: "manual",
      }).catch((err) => {
        console.error(`[debug/gmail/scan-90] background scan failed org=${integration.organizationId} scanId=${scanLog.id}`, err);
      });
    }
    res.json({
      ...base,
      connected: true,
      scanId: scanLog.id,
      status: created ? "started" : "running",
      inProgress: true,
      progressUrl: `/api/gmail/scan/${scanLog.id}`,
    });
  } catch (err) {
    res.status(500).json({
      ...base,
      errors: 1,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});


apiRouter.post("/automation/first-scan", async (req, res) => {
  const { scheduler } = await import("../services/scheduler.js");
  scheduler.runFirstTimeScan(req.auth!.organizationId).catch((err) => {
    console.error("[automation] first-time scan failed", err);
  });
  res.json({ started: true, message: "ברוך הבא! מתחיל סריקה ראשונית..." });
});

apiRouter.get("/automation/scan-status", async (req, res) => {
  type ScanStatusLog = {
    id: string;
    type: string;
    status: string;
    found: number;
    saved: number;
    invoicesFound?: number;
    paymentsFound?: number;
    driveUploaded?: number;
    sheetsUpdated?: number;
    errors: string | null;
    startedAt: Date;
    endedAt: Date | null;
  };

  const [scanLogs, syncLogs] = await Promise.all([
    prisma.$queryRawUnsafe<ScanStatusLog[]>(
    'SELECT "id", "type", "status", "found", "saved", "errors", "startedAt", "endedAt" FROM "ScanLog" WHERE "orgId" = $1 ORDER BY "startedAt" DESC LIMIT 10',
    req.auth!.organizationId
    ),
    prisma.syncLog.findMany({
      where: { organizationId: req.auth!.organizationId, type: "gmail_scan" },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: {
        id: true,
        type: true,
        status: true,
        emailsProcessed: true,
        emailsSaved: true,
        invoicesFound: true,
        paymentsCreated: true,
        tasksCreated: true,
        driveUploaded: true,
        sheetsUpdated: true,
        errorsCount: true,
        scanMode: true,
        nextRetryAt: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true,
      },
    }),
  ]);

  const logs: ScanStatusLog[] = [
    ...scanLogs,
    ...syncLogs.map((log) => ({
      id: log.id,
      type: log.type,
      status: log.status === "error" ? "failed" : log.status,
      found: log.emailsProcessed,
      saved: log.emailsSaved || log.paymentsCreated + log.tasksCreated,
      invoicesFound: log.invoicesFound,
      paymentsFound: log.paymentsCreated,
      driveUploaded: log.driveUploaded,
      sheetsUpdated: log.sheetsUpdated,
      errors: log.errorMessage || (log.errorsCount ? `${log.errorsCount} errors` : null),
      startedAt: log.startedAt,
      endedAt: log.finishedAt,
    })),
  ]
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, 10);

  const last = logs[0] ?? null;
  const nextDaily = new Date();
  nextDaily.setHours(3, 0, 0, 0);
  if (nextDaily <= new Date()) nextDaily.setDate(nextDaily.getDate() + 1);
  res.json({ last, logs, nextScheduledScanAt: nextDaily.toISOString() });
});

apiRouter.post("/help/auto-fix/invoices", async (req, res) => {
  try {
    const { getGoogleClients } = await import("../services/google.js");
    const { syncGmailForOrganization } = await import("../services/gmail-sync.js");
    const { gmail } = await getGoogleClients(req.auth!.organizationId);

    const labelName = "AI Office Worker - חשבוניות";
    const labels = await gmail.users.labels.list({ userId: "me" });
    const existingLabel = labels.data.labels?.find((label) => label.name === labelName);
    let labelCreated = false;
    if (!existingLabel) {
      await gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name: labelName,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        },
      });
      labelCreated = true;
    }

    const { scanLog, created } = await createRunningGmailScanLog(req.auth!.organizationId, "manual");
    if (created) {
      void syncGmailForOrganization(req.auth!.organizationId, {
        daysBack: 90,
        forceReprocess: true,
        scanLogId: scanLog.id,
        scanMode: "manual",
      }).catch((err) => {
        console.error(`[help/auto-fix/invoices] background scan failed org=${req.auth!.organizationId} scanId=${scanLog.id}`, err);
      });
    }
    res.json({
      success: true,
      labelCreated,
      scanId: scanLog.id,
      status: created ? "started" : "running",
      inProgress: true,
      progressUrl: `/api/gmail/scan/${scanLog.id}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auto fix failed";
    if (message === "Gmail not connected") {
      res.status(409).json({ error: "Gmail לא מחובר - לחץ כאן לחיבור", code: "GMAIL_NOT_CONNECTED" });
      return;
    }
    res.status(500).json({ error: `התיקון האוטומטי נכשל: ${message}` });
  }
});

apiRouter.get("/dashboard", async (req, res) => {
  const stats = await getDashboardStats(req.auth!.organizationId);
  res.json(stats);
});

apiRouter.get("/stats", async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const [stats, totalClients, openInvoices] = await Promise.all([
    getDashboardStats(organizationId),
    prisma.client.count({ where: { organizationId, isActive: true } }),
    prisma.invoice.count({ where: { organizationId, status: { not: "paid" } } }),
  ]);

  res.json({
    ...stats,
    totalClients,
    openInvoices,
    amountToReceive: stats.moneyToReceive,
    amountToPay: stats.moneyToPay,
    summary: {
      totalClients,
      openInvoices,
      amountToReceive: stats.moneyToReceive,
      amountToPay: stats.moneyToPay,
      currency: stats.currency,
    },
  });
});

apiRouter.get("/message-scans", async (req, res) => {
  const channel = typeof req.query.channel === "string" ? req.query.channel : undefined;
  const contactType = typeof req.query.contactType === "string" ? req.query.contactType : undefined;
  const urgency = typeof req.query.urgency === "string" ? req.query.urgency : undefined;
  const scans = await prisma.messageScan.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(channel && channel !== "all" && { channel }),
      ...(contactType && contactType !== "all" && { contactType }),
      ...(urgency && urgency !== "all" && { urgency }),
    },
    orderBy: { occurredAt: "desc" },
    take: 200,
  });
  res.json({ scans });
});

apiRouter.get("/message-scans/stats", async (req, res) => {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const scans = await prisma.messageScan.findMany({
    where: { organizationId: req.auth!.organizationId, occurredAt: { gte: since } },
    select: { channel: true, contactType: true, intent: true, urgency: true, sentiment: true },
    take: 5000,
  });
  res.json({
    total: scans.length,
    byChannel: countBy(scans, "channel"),
    byContactType: countBy(scans, "contactType"),
    byIntent: countBy(scans, "intent"),
    urgent: scans.filter((scan) => scan.urgency === "high").length,
    sentiment: countBy(scans, "sentiment"),
  });
});

apiRouter.get("/leads", async (req, res) => {
  const { listCrmLeads } = await import("../services/crm.js");
  res.json(await listCrmLeads(req.auth!.organizationId, req.query));
});

apiRouter.get("/leads/kpis", async (req, res) => {
  const { getCrmKpis } = await import("../services/crm.js");
  res.json(await getCrmKpis(req.auth!.organizationId));
});

apiRouter.get("/leads/templates", async (req, res) => {
  const { listMessageTemplates } = await import("../services/crm.js");
  res.json({ templates: await listMessageTemplates(req.auth!.organizationId) });
});

apiRouter.put("/leads/templates/:id", async (req, res) => {
  try {
    const { updateMessageTemplate } = await import("../services/crm.js");
    res.json(await updateMessageTemplate(req.auth!.organizationId, req.params.id, req.body as { content?: string }));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Template update failed" });
  }
});

apiRouter.get("/leads/:id", async (req, res) => {
  try {
    const { getCrmLead } = await import("../services/crm.js");
    res.json(await getCrmLead(req.auth!.organizationId, req.params.id));
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Lead not found" });
  }
});

apiRouter.post("/leads", async (req, res) => {
  try {
    const { createCrmLead } = await import("../services/crm.js");
    res.json(await createCrmLead(req.auth!.organizationId, req.body as Record<string, unknown>, req.auth!.userId));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Create lead failed" });
  }
});

apiRouter.put("/leads/:id", async (req, res) => {
  try {
    const { updateCrmLead } = await import("../services/crm.js");
    res.json(await updateCrmLead(req.auth!.organizationId, req.params.id, req.body as Record<string, unknown>, req.auth!.userId));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Update lead failed" });
  }
});

apiRouter.post("/leads/:id/timeline", async (req, res) => {
  try {
    const { addLeadTimeline } = await import("../services/crm.js");
    res.json(await addLeadTimeline(req.auth!.organizationId, req.params.id, req.body as { type?: string; content?: string; channel?: string }, req.auth!.userId));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Timeline update failed" });
  }
});

apiRouter.post("/leads/reply", async (req, res) => {
  try {
    const { handleLeadReply } = await import("../services/crm.js");
    const lead = await handleLeadReply(req.auth!.organizationId, req.body as { phone?: string; email?: string; message?: string; channel?: string });
    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    res.json({ lead });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Lead reply failed" });
  }
});

apiRouter.post("/leads/scan-gmail", async (req, res) => {
  try {
    const keywords = ["מעוניין", "פרטים", "מחיר", "interested", "details", "price"];
    const leads = await prisma.emailMessage.findMany({
      where: {
        organizationId: req.auth!.organizationId,
        receivedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        OR: keywords.flatMap((keyword) => [
          { subject: { contains: keyword, mode: "insensitive" as const } },
          { bodyText: { contains: keyword, mode: "insensitive" as const } },
        ]),
      },
      take: 25,
      orderBy: { receivedAt: "desc" },
    });
    const { createCrmLead } = await import("../services/crm.js");
    const created = [];
    for (const email of leads) {
      const phone = email.fromAddress.match(/\+?\d[\d\s-]{7,}/)?.[0]?.replace(/\s/g, "");
      const exists = await prisma.lead.findFirst({
        where: {
          organizationId: req.auth!.organizationId,
          OR: [{ email: email.fromAddress }, ...(phone ? [{ phone }] : [])],
        },
      });
      if (exists) continue;
      created.push(await createCrmLead(req.auth!.organizationId, {
        name: email.fromAddress.replace(/<[^>]+>/g, "").trim() || "ליד ממייל",
        email: email.fromAddress,
        phone,
        source: "email",
        notes: `${email.subject}\n\n${email.bodyText ?? email.snippet ?? ""}`.slice(0, 1000),
      }, req.auth!.userId));
    }
    res.json({ scanned: leads.length, created: created.length, leads: created });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Gmail lead scan failed" });
  }
});

apiRouter.post("/help/ask", async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question : "";
  const { answerHelpQuestion } = await import("../services/helpAI.js");
  res.json({ answer: await answerHelpQuestion(question) });
});

apiRouter.get("/accountant/settings", async (req, res) => {
  const { getAccountantSettings } = await import("../services/accountantReports.js");
  res.json(await getAccountantSettings(req.auth!.organizationId));
});

apiRouter.put("/accountant/settings", async (req, res) => {
  const { updateAccountantSettings } = await import("../services/accountantReports.js");
  res.json(await updateAccountantSettings(req.auth!.organizationId, req.body as Record<string, unknown>));
});

apiRouter.get("/accountant/summary", async (req, res) => {
  const period = typeof req.query.period === "string" ? req.query.period : undefined;
  const { buildAccountantSummary } = await import("../services/accountantReports.js");
  res.json(await buildAccountantSummary(req.auth!.organizationId, period));
});

apiRouter.post("/accountant/generate", async (req, res) => {
  const period = typeof req.body?.period === "string" ? req.body.period : undefined;
  const { generateAccountantReport } = await import("../services/accountantReports.js");
  res.json(await generateAccountantReport(req.auth!.organizationId, period));
});

apiRouter.get("/accountant/download.zip", async (req, res) => {
  const period = typeof req.query.period === "string" ? req.query.period : undefined;
  const { accountantZipBuffer, buildAccountantSummary } = await import("../services/accountantReports.js");
  const buffer = accountantZipBuffer(await buildAccountantSummary(req.auth!.organizationId, period));
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", "attachment; filename=accountant-report.zip");
  res.send(buffer);
});

apiRouter.post("/accountant/send", async (req, res) => {
  const period = typeof req.body?.period === "string" ? req.body.period : undefined;
  const { generateAccountantReport } = await import("../services/accountantReports.js");
  const report = await generateAccountantReport(req.auth!.organizationId, period);
  res.json({ sent: false, reason: "Email provider is not configured yet", report });
});


apiRouter.get("/invoices", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(clientId && { clientId }),
      ...(status && status !== "all" && { status }),
      ...(search && {
        OR: [
          { invoiceNumber: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { fromEmail: { contains: search, mode: "insensitive" } },
          { client: { name: { contains: search, mode: "insensitive" } } },
        ],
      }),
    },
    include: { client: { select: { id: true, name: true, color: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ invoices });
});

apiRouter.put("/invoices/:id/status", async (req, res) => {
  const body = req.body as { status?: string };
  if (!body.status || !["paid", "pending", "overdue"].includes(body.status)) {
    res.status(400).json({ error: "Invalid invoice status" });
    return;
  }
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
  });
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const updated = await prisma.invoice.update({ where: { id: invoice.id }, data: { status: body.status } });
  try {
    const { updateInvoiceStatusInSheets } = await import("../services/clientSheetsService.js");
    await updateInvoiceStatusInSheets(invoice.clientId, invoice.sheetsRow, body.status);
  } catch (err) {
    console.error("[invoices] failed to update sheet status", err);
  }
  res.json({ invoice: updated });
});

apiRouter.get("/organizations/:id/invoices/summary", async (req, res) => {
  if (req.params.id !== req.auth!.organizationId) {
    res.status(403).json({ error: "Organization access denied" });
    return;
  }
  const invoices = await prisma.invoice.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: { client: { select: { id: true, name: true } } },
  });
  const byStatus = invoices.reduce<Record<string, number>>((acc, invoice) => {
    acc[invoice.status] = (acc[invoice.status] ?? 0) + invoice.amount;
    return acc;
  }, {});
  const byClient = invoices.reduce<Record<string, { clientId: string; clientName: string; count: number; amount: number }>>((acc, invoice) => {
    const current = acc[invoice.clientId] ?? { clientId: invoice.clientId, clientName: invoice.client.name, count: 0, amount: 0 };
    current.count += 1;
    current.amount += invoice.amount;
    acc[invoice.clientId] = current;
    return acc;
  }, {});
  res.json({ count: invoices.length, byStatus, byClient: Object.values(byClient) });
});

apiRouter.get("/payments", async (req, res) => {
  const payments = await prisma.supplierPayment.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { date: "desc" },
    take: 100,
  });
  res.json(payments);
});

apiRouter.patch("/payments/:id", async (req, res) => {
  const { paid, invoiceLink, documentLink } = req.body as {
    paid?: boolean;
    invoiceLink?: string;
    documentLink?: string;
  };
  const existingPayment = await prisma.supplierPayment.findFirst({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
  });
  if (!existingPayment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }
  const updatedPayment = await prisma.supplierPayment.update({
    where: { id: existingPayment.id },
    data: {
      ...(paid !== undefined && { paid, ...(paid && { missingInvoice: false }) }),
      ...(invoiceLink !== undefined && { invoiceLink, missingInvoice: false }),
      ...(documentLink !== undefined && { documentLink }),
    },
  });
  if ((invoiceLink !== undefined || paid === true) && existingPayment.emailMessageId) {
    await prisma.task.updateMany({
      where: {
        organizationId: req.auth!.organizationId,
        emailMessageId: existingPayment.emailMessageId,
        title: { startsWith: "MissingInvoice:" },
        status: "open",
      },
      data: { status: "completed" },
    });
  }
  try {
    const { appendSupplierPaymentToSheet } = await import("../services/supplierPaymentsSheet.js");
    const email = existingPayment.emailMessageId
      ? await prisma.emailMessage.findFirst({
          where: { id: existingPayment.emailMessageId, organizationId: req.auth!.organizationId },
          select: { gmailId: true },
        })
      : null;
    await appendSupplierPaymentToSheet({
      organizationId: req.auth!.organizationId,
      paymentId: updatedPayment.id,
      supplier: updatedPayment.supplier,
      amount: updatedPayment.amount,
      date: updatedPayment.date,
      dueDate: updatedPayment.dueDate,
      paid: updatedPayment.paid,
      missingInvoice: updatedPayment.missingInvoice,
      documentLink: updatedPayment.documentLink,
      invoiceLink: updatedPayment.invoiceLink,
      gmailLink: email?.gmailId ? `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(email.gmailId)}` : null,
    });
  } catch (err) {
    console.error("[payments] failed to sync payment to sheet", err);
  }
  res.json({ updated: 1, payment: updatedPayment });
});

apiRouter.get("/tasks", async (req, res) => {
  const tasks = await prisma.task.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(tasks);
});

apiRouter.patch("/tasks/:id", async (req, res) => {
  const { status } = req.body as { status?: string };
  const updated = await prisma.task.updateMany({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
    data: { status: status ?? "completed" },
  });
  if (updated.count === 0) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({ ok: true });
});

apiRouter.put("/tasks/:id", async (req, res) => {
  const body = req.body as {
    title?: string;
    description?: string | null;
    dueDate?: string | null;
    priority?: string;
    status?: string;
  };
  const title = body.title?.trim();
  if (!title) {
    res.status(400).json({ error: "Task title is required" });
    return;
  }
  const dueDate = body.dueDate ? new Date(body.dueDate) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    res.status(400).json({ error: "Invalid due date" });
    return;
  }
  const updated = await prisma.task.updateMany({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
    data: {
      title,
      description: body.description?.trim() || null,
      dueDate,
      ...(body.priority && { priority: body.priority }),
      ...(body.status && { status: body.status }),
    },
  });
  if (updated.count === 0) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({ ok: true });
});

apiRouter.delete("/tasks/:id", async (req, res) => {
  const deleted = await prisma.task.deleteMany({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
  });
  if (deleted.count === 0) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({ ok: true });
});

apiRouter.get("/reports/missing-invoices", async (req, res) => {
  const report = await getMissingInvoicesReport(req.auth!.organizationId);
  res.json(report);
});

apiRouter.get("/alerts", async (req, res) => {
  const alerts = await prisma.alert.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  res.json(alerts);
});

apiRouter.get("/summary/daily", async (req, res) => {
  const text = await buildDailySummary(req.auth!.organizationId);
  res.json({ text });
});

async function sendWhatsAppStatus(req: Request, res: Response) {
  res.json(await getWhatsAppSettings(req.auth!.organizationId));
}

async function saveWhatsAppNumber(req: Request, res: Response) {
  const body = req.body as { ownerWhatsApp?: string };
  if (!body.ownerWhatsApp?.trim()) {
    res.status(400).json({ error: "WhatsApp number is required" });
    return;
  }

  await saveWhatsAppSettings(req.auth!.organizationId, body.ownerWhatsApp);
  res.json(await getWhatsAppSettings(req.auth!.organizationId));
}

async function sendWhatsAppTest(req: Request, res: Response) {
  const result = await sendWhatsAppMessage(
    req.auth!.organizationId,
    "✅ AI Office Worker WhatsApp מחובר בהצלחה!"
  );
  if (!result.sent) {
    res.status(400).json({ error: result.reason });
    return;
  }
  res.json(result);
}

apiRouter.get("/integrations/whatsapp/status", sendWhatsAppStatus);
apiRouter.put("/integrations/whatsapp/settings", saveWhatsAppNumber);
apiRouter.get("/whatsapp/status", sendWhatsAppStatus);
apiRouter.post("/settings/whatsapp", saveWhatsAppNumber);
apiRouter.post("/whatsapp/test", sendWhatsAppTest);
apiRouter.post("/integrations/whatsapp/test", sendWhatsAppTest);

apiRouter.get("/whatsapp-assistant/settings", async (req, res) => {
  const { getWhatsAppAssistantSettings } = await import("../services/whatsappAssistant.js");
  res.json(await getWhatsAppAssistantSettings(req.auth!.organizationId));
});

apiRouter.put("/whatsapp-assistant/settings", async (req, res) => {
  const { updateWhatsAppAssistantSettings } = await import("../services/whatsappAssistant.js");
  res.json(await updateWhatsAppAssistantSettings(req.auth!.organizationId, req.body as Record<string, unknown>));
});

apiRouter.get("/whatsapp-assistant/stats", async (req, res) => {
  const { getWhatsAppAssistantStats } = await import("../services/whatsappAssistant.js");
  res.json(await getWhatsAppAssistantStats(req.auth!.organizationId));
});

apiRouter.post("/whatsapp-assistant/test/:type", async (req, res) => {
  const type = req.params.type === "number" ? "number" : "morning";
  const { sendAssistantTest } = await import("../services/whatsappAssistant.js");
  const result = await sendAssistantTest(req.auth!.organizationId, type);
  if (!result.sent) {
    res.status(400).json({ error: result.reason });
    return;
  }
  res.json(result);
});

async function scanGmail(req: Request, res: Response) {
  try {
    const { syncGmailForOrganization } = await import("../services/gmail-sync.js");
    const organizationId = req.auth!.organizationId;
    let gmailIntegration = await prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: "gmail" } },
      select: { refreshToken: true, accessToken: true, organizationId: true },
    });
    if (!gmailIntegration?.refreshToken && req.auth?.userId && req.auth?.email) {
      const matchingUserIntegration = await prisma.integration.findFirst({
        where: {
          provider: "gmail",
          OR: [
            { organization: { userId: req.auth.userId } },
            { organization: { user: { email: req.auth.email } } },
          ],
          refreshToken: { not: null },
        },
        orderBy: { updatedAt: "desc" },
      });
      if (matchingUserIntegration && matchingUserIntegration.organizationId !== organizationId) {
        console.warn(`[gmail-scan] moving Gmail integration from org=${matchingUserIntegration.organizationId} to current org=${organizationId} user=${req.auth.userId}`);
        const movedIntegration = await prisma.integration.upsert({
          where: { organizationId_provider: { organizationId, provider: "gmail" } },
          create: {
            organizationId,
            provider: "gmail",
            accessToken: matchingUserIntegration.accessToken,
            refreshToken: matchingUserIntegration.refreshToken,
            expiresAt: matchingUserIntegration.expiresAt,
            metadata: matchingUserIntegration.metadata,
            connectedAt: matchingUserIntegration.connectedAt,
          },
          update: {
            accessToken: matchingUserIntegration.accessToken,
            refreshToken: matchingUserIntegration.refreshToken,
            expiresAt: matchingUserIntegration.expiresAt,
            metadata: matchingUserIntegration.metadata,
          },
          select: { refreshToken: true, accessToken: true, organizationId: true },
        });
        await prisma.integration.deleteMany({
          where: {
            id: matchingUserIntegration.id,
            organizationId: { not: organizationId },
            provider: "gmail",
          },
        });
        gmailIntegration = movedIntegration;
      }
    }
    if (!gmailIntegration?.refreshToken && !gmailIntegration?.accessToken) {
      console.warn(`[gmail-scan] Gmail not connected org=${organizationId}`);
      res.status(409).json({ error: "Please connect Gmail account first", code: "GMAIL_NOT_CONNECTED" });
      return;
    }

    const rawDaysBack = Number(req.body?.daysBack ?? req.query.daysBack);
    const daysBack = Number.isFinite(rawDaysBack) && rawDaysBack > 0 ? Math.ceil(rawDaysBack) : 90;
    console.log(`[gmail-scan] POST /api/gmail/scan org=${organizationId} rawDaysBack=${String(req.body?.daysBack ?? req.query.daysBack ?? "missing")} daysBack=${daysBack}`);
    console.log("[gmail-scan] Step 1: checking Gmail authentication");

    const staleAfterMs = 30 * 60 * 1000;
    const activeLog = await prisma.syncLog.findFirst({
      where: {
        organizationId,
        type: "gmail_scan",
        status: "running",
        finishedAt: null,
      },
      orderBy: { startedAt: "desc" },
    });
    if (activeLog && activeLog.startedAt.getTime() > Date.now() - staleAfterMs) {
      const progress = await buildGmailScanProgress(organizationId, activeLog.id);
      console.log(`[gmail-scan] Existing scan in progress org=${organizationId} scanId=${activeLog.id}`);
      res.json({
        success: true,
        scanId: activeLog.id,
        status: "running",
        inProgress: true,
        daysBack,
        progressUrl: `/api/gmail/scan/${activeLog.id}`,
        summary: progress,
      });
      return;
    }
    if (activeLog) {
      await prisma.syncLog.update({
        where: { id: activeLog.id },
        data: { status: "error", errorMessage: "Stale running scan was reset before starting a new background scan", finishedAt: new Date() },
      });
    }

    const { scanLog, created } = await createRunningGmailScanLog(organizationId, "manual");
    if (!created) {
      const progress = await buildGmailScanProgress(organizationId, scanLog.id);
      res.json({
        success: true,
        scanId: scanLog.id,
        status: "running",
        inProgress: true,
        daysBack,
        progressUrl: `/api/gmail/scan/${scanLog.id}`,
        summary: progress,
      });
      return;
    }
    console.log(`[gmail-scan] Step 2: background scan started org=${organizationId} scanId=${scanLog.id} daysBack=${daysBack}`);
    void syncGmailForOrganization(organizationId, { daysBack, forceReprocess: daysBack >= 90, scanLogId: scanLog.id, scanMode: "manual" })
      .then((backgroundResult) => {
        console.log(`[gmail-scan] Background processing finished org=${organizationId} scanId=${scanLog.id} emails=${backgroundResult.emailsProcessed} saved=${backgroundResult.emailsSavedToGmailScanItem ?? 0} payments=${backgroundResult.paymentsCreated} invoices=${backgroundResult.invoicesCreated} driveUploaded=${backgroundResult.driveUploadsSucceeded ?? 0} rejected=${backgroundResult.parserRejectedCount ?? backgroundResult.ignoredCount ?? 0}`);
      })
      .catch((backgroundError) => {
        console.error(`[gmail-scan] Background processing failed org=${organizationId} scanId=${scanLog.id}`, backgroundError);
      });

    res.json({
      success: true,
      scanId: scanLog.id,
      status: "started",
      inProgress: true,
      daysBack,
      progressUrl: `/api/gmail/scan/${scanLog.id}`,
      message: "Gmail scan started in background",
      summary: {
        totalEmailsChecked: 0,
        emailsScanned: 0,
        emailsFetched: 0,
        emailsSaved: 0,
        invoicesFound: 0,
        supplierPaymentsFound: 0,
        clientsFound: 0,
        uploadedToDrive: 0,
        rejectedReasons: {},
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    const code = classifyGmailScanError(message);
    if (code === "GMAIL_NOT_CONNECTED") {
      console.log("[gmail-scan] Gmail not connected");
      res.status(409).json({ error: "Please connect Gmail account first", code: "GMAIL_NOT_CONNECTED" });
      return;
    }
    console.error("[gmail-scan] Scan failed", err);
    const status = code === "GMAIL_PERMISSION_DENIED" ? 403 : code === "GMAIL_TOKEN_EXPIRED" ? 401 : 500;
    res.status(status).json({ error: `סריקת Gmail נכשלה: ${humanGmailScanError(message, code)}`, code });
  }
}

apiRouter.get("/gmail/scan/:scanId", async (req, res) => {
  try {
    const progress = await buildGmailScanProgress(req.auth!.organizationId, req.params.scanId);
    if (!progress) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }
    res.json(progress);
  } catch (err) {
    console.error("[gmail-scan] progress failed", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load scan progress" });
  }
});

apiRouter.post("/sync/gmail", scanGmail);
apiRouter.post("/gmail-scan", scanGmail);
apiRouter.post("/gmail/scan", scanGmail);

async function createRunningGmailScanLog(organizationId: string, scanMode: string) {
  try {
    const scanLog = await prisma.syncLog.create({
      data: {
        organizationId,
        type: "gmail_scan",
        status: "running",
        scanMode,
      },
    });
    return { scanLog, created: true };
  } catch (err) {
    const active = await prisma.syncLog.findFirst({
      where: {
        organizationId,
        type: "gmail_scan",
        status: "running",
        finishedAt: null,
      },
      orderBy: { startedAt: "desc" },
    });
    if (active) {
      console.warn(`[gmail-scan] DB lock prevented duplicate running scan org=${organizationId} scanId=${active.id}`);
      return { scanLog: active, created: false };
    }
    throw err;
  }
}

async function buildGmailScanProgress(organizationId: string, scanId: string) {
  const log = await prisma.syncLog.findFirst({
    where: { id: scanId, organizationId, type: "gmail_scan" },
  });
  if (!log) return null;

  const start = log.startedAt;
  const end = log.finishedAt ?? new Date();
  const window = { gte: start, lte: end };
  const failedItems = await prisma.gmailScanItem.findMany({
    where: {
      organizationId,
      createdAt: window,
      OR: [
        { reviewStatus: "needs_review" },
        { documentType: "unknown_needs_review" },
        { decisionReason: { contains: "failed", mode: "insensitive" } },
        { decisionReason: { contains: "rejected", mode: "insensitive" } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 25,
    select: {
      id: true,
      gmailMessageId: true,
      gmailMessageLink: true,
      sender: true,
      subject: true,
      documentType: true,
      decisionReason: true,
      reviewStatus: true,
      occurredAt: true,
    },
  });
  const lastSuccessfulScan = await prisma.syncLog.findFirst({
    where: { organizationId, type: "gmail_scan", status: "success", finishedAt: { not: null } },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true },
  });

  const rejectedReasons = failedItems.reduce<Record<string, number>>((acc, item) => {
    const rejected =
      item.reviewStatus === "needs_review" ||
      item.documentType === "unknown_needs_review" ||
      /failed|rejected|no strong signal|empty|skipped/i.test(item.decisionReason);
    if (!rejected) return acc;
    const reason = item.decisionReason || "needs_review";
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});

  const status = log.finishedAt
    ? log.status === "success"
      ? "completed"
      : "error"
    : "running";
  const elapsedMs = Math.max(0, end.getTime() - start.getTime());
  const emailsFetched = log.emailsProcessed;
  const emailsSaved = log.emailsSaved;
  const invoicesFound = log.invoicesFound;
  const supplierPaymentsFound = log.paymentsCreated;
  const uploadedToDrive = log.driveUploaded;
  const processed = emailsFetched;
  const progressPercent =
    status === "completed"
      ? 100
      : status === "error"
        ? Math.min(100, processed > 0 ? 100 : 0)
        : processed > 0
          ? Math.min(95, Math.max(5, Math.round((emailsSaved / Math.max(processed, 1)) * 100)))
          : 5;
  const emailsPerMs = processed > 0 && elapsedMs > 0 ? processed / elapsedMs : 0;
  const estimatedRemainingSeconds =
    status === "running" && emailsPerMs > 0 && progressPercent > 0
      ? Math.max(0, Math.round(((100 - progressPercent) / progressPercent) * (elapsedMs / 1000)))
      : null;

  return {
    scanId: log.id,
    status,
    inProgress: status === "running",
    startedAt: log.startedAt,
    finishedAt: log.finishedAt,
    error: log.status === "error" ? log.errorMessage : null,
    progressPercent,
    estimatedRemainingSeconds,
    lastSuccessfulScanAt: lastSuccessfulScan?.finishedAt ?? null,
    emailsFetched,
    emailsSaved,
    invoicesFound,
    supplierPaymentsFound,
    clientsFound: 0,
    uploadedToDrive,
    sheetsUpdated: log.sheetsUpdated,
    failedItems,
    rejectedReasons,
    finalSummary: log.finishedAt
      ? {
          emailsFetched,
          emailsSaved,
          invoicesFound,
          paymentsFound: supplierPaymentsFound,
          uploadedToDrive,
          sheetsUpdated: log.sheetsUpdated,
          failedItems: failedItems.length,
          errorsCount: log.errorsCount,
          completedAt: log.finishedAt,
        }
      : null,
    summary: {
      totalEmailsChecked: emailsFetched,
      emailsScanned: emailsFetched,
      emailsFetched,
      emailsSaved,
      recordsSaved: emailsSaved,
      invoicesFound,
      supplierPaymentsFound,
      clientsFound: 0,
      uploadedToDrive,
      rejectedReasons,
      paymentsSaved: supplierPaymentsFound,
      errorsCount: log.errorsCount || (log.status === "error" ? 1 : 0),
      progressPercent,
      estimatedRemainingSeconds,
    },
  };
}

function buildGmailScanSummary(result: {
  emailsProcessed: number;
  totalEmailsChecked?: number;
  relevantEmailsFound?: number;
  paymentsCreated?: number;
  invoicesCreated?: number;
  receiptsFound?: number;
  paymentRequestsFound?: number;
  tasksCreated?: number;
  clientsCreated?: number;
  duplicatesSkipped?: number;
  invoiceEmails?: number;
  recordsSaved?: number;
  needsReviewCount?: number;
  errorsCount?: number;
  emailsSavedToGmailScanItem?: number;
  emailsSaved?: number;
  emailRecordsSaved?: number;
  ignoredCount?: number;
  ignoredReasons?: Record<string, number>;
  emailsParsed?: number;
  parserRejectedCount?: number;
  dbEmailMessageUpserts?: number;
  dbGmailScanItemUpserts?: number;
  driveUploadsAttempted?: number;
  driveUploadsSucceeded?: number;
  driveUploadsSkipped?: number;
  driveUploadsFailed?: number;
  invoiceDetectionPositive?: number;
  invoiceDetectionNegative?: number;
}) {
  const businessRecordsSaved = result.recordsSaved ?? ((result.paymentsCreated ?? 0) + (result.invoicesCreated ?? 0) + (result.tasksCreated ?? 0) + (result.clientsCreated ?? 0));
  const emailRecordsSaved = result.emailsSavedToGmailScanItem ?? result.emailRecordsSaved ?? result.emailsSaved ?? 0;
  const recordsSaved = Math.max(businessRecordsSaved, emailRecordsSaved);
  return {
    totalEmailsChecked: result.totalEmailsChecked ?? result.emailsProcessed,
    emailsScanned: result.emailsProcessed,
    relevantEmailsFound: result.relevantEmailsFound ?? result.invoiceEmails ?? 0,
    invoiceOrPaymentEmailsFound: result.relevantEmailsFound ?? result.invoiceEmails ?? 0,
    invoicesFound: result.invoicesCreated ?? 0,
    receiptsFound: result.receiptsFound ?? 0,
    paymentRequestsFound: result.paymentRequestsFound ?? 0,
    recordsSaved,
    businessRecordsSaved,
    emailRecordsSaved,
    emailsSaved: emailRecordsSaved,
    paymentsSaved: result.paymentsCreated ?? 0,
    invoicesSaved: result.invoicesCreated ?? 0,
    duplicatesSkipped: result.duplicatesSkipped ?? 0,
    needsReviewCount: result.needsReviewCount ?? 0,
    errorsCount: result.errorsCount ?? 0,
    emailsSavedToGmailScanItem: result.emailsSavedToGmailScanItem ?? 0,
    emailsParsed: result.emailsParsed ?? 0,
    parserRejectedCount: result.parserRejectedCount ?? 0,
    dbEmailMessageUpserts: result.dbEmailMessageUpserts ?? 0,
    dbGmailScanItemUpserts: result.dbGmailScanItemUpserts ?? 0,
    driveUploadsAttempted: result.driveUploadsAttempted ?? 0,
    driveUploadsSucceeded: result.driveUploadsSucceeded ?? 0,
    driveUploadsSkipped: result.driveUploadsSkipped ?? 0,
    driveUploadsFailed: result.driveUploadsFailed ?? 0,
    invoiceDetectionPositive: result.invoiceDetectionPositive ?? 0,
    invoiceDetectionNegative: result.invoiceDetectionNegative ?? 0,
    ignoredCount: result.ignoredCount ?? 0,
    ignoredReasons: result.ignoredReasons ?? {},
  };
}

function classifyGmailScanError(message: string) {
  const lower = message.toLowerCase();
  if (message === "Gmail not connected" || lower.includes("not connected")) return "GMAIL_NOT_CONNECTED";
  if (lower.includes("invalid_grant") || lower.includes("token") && lower.includes("expired")) return "GMAIL_TOKEN_EXPIRED";
  if (lower.includes("insufficient") || lower.includes("permission") || lower.includes("scope") || lower.includes("forbidden")) return "GMAIL_PERMISSION_DENIED";
  if (lower.includes("database") || lower.includes("prisma") || lower.includes("table") || lower.includes("relation")) return "DATABASE_FAILURE";
  return "GMAIL_SCAN_FAILED";
}

function humanGmailScanError(message: string, code: string) {
  if (code === "GMAIL_TOKEN_EXPIRED") return "החיבור ל-Gmail פג תוקף. חבר Gmail מחדש בהגדרות.";
  if (code === "GMAIL_PERMISSION_DENIED") return "חסרות הרשאות Gmail. חבר Gmail מחדש ואשר הרשאות קריאה ושליחה.";
  if (code === "DATABASE_FAILURE") return "שמירה למסד הנתונים נכשלה. בדוק שהטבלאות קיימות והמיגרציות הורצו.";
  return message;
}

async function safeLeadCount(organizationId: string) {
  try {
    return await prisma.lead.count({ where: { organizationId } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("public.Lead") || message.includes("Lead") && message.includes("does not exist")) {
      console.warn(`[gmail-scan] Lead table is missing; continuing with lead count 0 org=${organizationId}`);
      return 0;
    }
    throw err;
  }
}

async function latestScannedEmails(organizationId: string) {
  const emails = await prisma.emailMessage.findMany({
    where: { organizationId },
    orderBy: { receivedAt: "desc" },
    take: 50,
    select: {
      id: true,
      gmailId: true,
      fromAddress: true,
      subject: true,
      bodyText: true,
      receivedAt: true,
      source: true,
    },
  });

  return emails.map((email) => ({
    id: email.id,
    messageId: email.gmailId,
    from: email.fromAddress,
    subject: email.subject,
    body: email.bodyText,
    date: email.receivedAt,
    source: email.source,
  }));
}

apiRouter.post("/camera/invoices/preview", async (req, res) => {
  try {
    const body = req.body as {
      filename?: string;
      mimeType?: string;
      fileBase64?: string;
    };

    if (!body.fileBase64 || !body.mimeType) {
      res.status(400).json({ error: "Invoice file is required" });
      return;
    }

    if (!["image/jpeg", "image/png", "application/pdf"].includes(body.mimeType)) {
      res.status(400).json({ error: "Only jpg, png and pdf invoices are supported" });
      return;
    }

    const { analyzeInvoiceFile } = await import("../services/claude.js");
    const preview = await analyzeInvoiceFile({
      fileBase64: body.fileBase64,
      mimeType: body.mimeType,
      filename: body.filename,
    });

    res.json(preview);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invoice preview failed";
    res.status(500).json({ error: message });
  }
});

apiRouter.post("/camera/invoices", async (req, res) => {
  try {
    const body = req.body as {
      supplier?: string;
      amount?: number;
      currency?: string;
      invoiceDate?: string;
      invoiceNumber?: string;
      dueDate?: string;
      filename?: string;
      mimeType?: string;
      fileBase64?: string;
    };

    if (!body.supplier || typeof body.amount !== "number") {
      res.status(400).json({ error: "Supplier and amount are required" });
      return;
    }
    const invoiceDate = body.invoiceDate ? new Date(body.invoiceDate) : new Date();
    const dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (Number.isNaN(invoiceDate.getTime()) || (dueDate && Number.isNaN(dueDate.getTime()))) {
      res.status(400).json({ error: "Invalid invoice date" });
      return;
    }

    let documentLink: string | undefined;
    if (body.fileBase64 && body.filename) {
      const uploadDir = path.join(process.cwd(), "uploads", "camera-invoices");
      await mkdir(uploadDir, { recursive: true });
      const safeName = body.filename.replace(/[\\/:*?"<>|]/g, "-");
      const storedName = `${Date.now()}_${safeName}`;
      await writeFile(path.join(uploadDir, storedName), Buffer.from(body.fileBase64, "base64"));
      documentLink = `/uploads/camera-invoices/${storedName}`;
    }

    const payment = await prisma.supplierPayment.create({
      data: {
        organizationId: req.auth!.organizationId,
        supplier: body.supplier,
        amount: body.amount,
        currency: body.currency || "ILS",
        date: invoiceDate,
        dueDate,
        paid: false,
        documentLink,
        invoiceLink: documentLink,
        paymentRequired: true,
        missingInvoice: false,
        source: "camera",
        subject: body.invoiceNumber
          ? `Camera invoice scan #${body.invoiceNumber}`
          : "Camera invoice scan",
      },
    });

    res.json(payment);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Camera scan failed";
    res.status(500).json({ error: message });
  }
});

async function sendBusinessHealth(req: Request, res: Response) {
  const stats = await getDashboardStats(req.auth!.organizationId);
  const score = stats.businessHealthScore;
  const recommendations: string[] = [];

  if (stats.missingInvoicesCount > 0) {
    recommendations.push("לטפל בחשבוניות חסרות מול ספקים.");
  }
  if (stats.overdueCustomerInvoices > 0) {
    recommendations.push("לשלוח תזכורות גבייה ללקוחות באיחור.");
  }
  if (stats.upcomingPaymentsCount > 0) {
    recommendations.push("לבדוק תשלומי ספקים קרובים לשבוע הקרוב.");
  }
  if (recommendations.length === 0) {
    recommendations.push("המצב נראה תקין. המשך לעקוב אחרי תשלומים פתוחים.");
  }

  res.json({
    score,
    status: score >= 80 ? "good" : score >= 60 ? "warning" : "risk",
    recommendations,
    metrics: {
      moneyToPay: stats.moneyToPay,
      moneyToReceive: stats.moneyToReceive,
      missingInvoices: stats.missingInvoicesCount,
      overdueCustomerInvoices: stats.overdueCustomerInvoices,
      overdueSupplierPayments: stats.overdueSupplierPayments,
      hoursSavedThisWeek: stats.hoursSavedThisWeek,
    },
  });
}

apiRouter.get("/business-health", async (req, res) => {
  await sendBusinessHealth(req, res);
});

apiRouter.get("/health-score", async (req, res) => {
  await sendBusinessHealth(req, res);
});

apiRouter.get("/customer-invoices", async (req, res) => {
  const invoices = await prisma.customerInvoice.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { dueDate: "asc" },
  });
  res.json(invoices);
});

apiRouter.post("/customer-invoices", async (req, res) => {
  const body = req.body as {
    customer?: string;
    amount?: number;
    dueDate?: string;
    notes?: string;
  };

  if (!body.customer || typeof body.amount !== "number") {
    res.status(400).json({ error: "Customer and amount are required" });
    return;
  }

  const invoice = await prisma.customerInvoice.create({
    data: {
      organizationId: req.auth!.organizationId,
      customer: body.customer,
      amount: body.amount,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      notes: body.notes,
    },
  });

  res.json(invoice);
});

apiRouter.patch("/customer-invoices/:id", async (req, res) => {
  const body = req.body as { paid?: boolean; reminderSent?: boolean };
  const invoice = await prisma.customerInvoice.updateMany({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
    data: {
      ...(body.paid !== undefined && { paid: body.paid }),
      ...(body.reminderSent && { reminderSentAt: new Date() }),
    },
  });
  res.json({ updated: invoice.count });
});

apiRouter.post("/customer-invoices/:id/reminder", async (req, res) => {
  const invoice = await prisma.customerInvoice.findFirst({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
  });
  if (!invoice) {
    res.status(404).json({ error: "Customer invoice not found" });
    return;
  }

  await prisma.customerInvoice.update({
    where: { id: invoice.id },
    data: { reminderSentAt: new Date() },
  });

  res.json({
    message: `שלום ${invoice.customer}, מזכירים שקיימת חשבונית פתוחה על סך ₪${invoice.amount}. נשמח להסדרת התשלום בהקדם. תודה.`,
  });
});

apiRouter.get("/social-drafts", async (req, res) => {
  const drafts = await prisma.socialDraft.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(drafts);
});

apiRouter.post("/social-drafts", async (req, res) => {
  const body = req.body as {
    platform?: string;
    topic?: string;
    tone?: string;
  };

  const platform = body.platform || "facebook";
  const topic = body.topic || "טיפ עסקי";
  const tone = body.tone || "מקצועי וידידותי";
  const content = buildSocialDraft(platform, topic, tone);

  const draft = await prisma.socialDraft.create({
    data: {
      organizationId: req.auth!.organizationId,
      platform,
      topic,
      content,
    },
  });

  res.json(draft);
});

apiRouter.patch("/social-drafts/:id", async (req, res) => {
  const body = req.body as { status?: string; content?: string };
  const draft = await prisma.socialDraft.updateMany({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
    data: {
      ...(body.status && { status: body.status }),
      ...(body.content && { content: body.content }),
    },
  });
  res.json({ updated: draft.count });
});

function buildSocialDraft(platform: string, topic: string, tone: string) {
  const hashtags =
    platform === "instagram"
      ? "\n\n#עסקים #ניהולעסק #טיפיםלעסקים #ישראל"
      : "\n\nמה דעתכם? כתבו לנו בתגובות.";

  return `פוסט ${platform === "instagram" ? "לאינסטגרם" : "לפייסבוק"} בנושא: ${topic}

בטון ${tone}:

ניהול עסק קטן דורש סדר, מעקב ותגובה מהירה. ${topic} הוא אחד הדברים שיכולים לעזור לבעל העסק לחסוך זמן, לצמצם טעויות ולקבל החלטות טובות יותר.

טיפ קצר: התחילו ממעקב פשוט וקבוע, ואז שפרו אותו בהדרגה עם אוטומציה.${hashtags}`;
}

function countBy<T extends Record<string, string>>(items: T[], key: keyof T) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const value = item[key] || "unknown";
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}
