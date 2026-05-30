import { createHash } from "crypto";
import { prisma } from "../lib/prisma.js";

export async function backfillInvoicesFromGmailScanItems(organizationId: string, limit = 100) {
  const candidates = await prisma.gmailScanItem.findMany({
    where: {
      organizationId,
      documentType: { in: ["invoice", "receipt"] },
      reviewStatus: "auto_saved",
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      emailMessageId: true,
      gmailMessageId: true,
      gmailMessageLink: true,
      senderEmail: true,
      subject: true,
      occurredAt: true,
      amount: true,
      supplierName: true,
      documentType: true,
      driveFileLink: true,
      decisionReason: true,
      confidenceScore: true,
    },
  });

  let created = 0;
  let duplicates = 0;
  let skipped = 0;
  const errors: Array<{ gmailMessageId: string; reason: string }> = [];

  for (const item of candidates) {
    try {
      if (confidencePercent(item.confidenceScore) < 70) {
        skipped++;
        continue;
      }
      const existingByGmail = await prisma.invoice.findFirst({
        where: { organizationId, gmailMessageId: item.gmailMessageId },
        select: { id: true },
      });
      if (existingByGmail) {
        duplicates++;
        continue;
      }

      const emailMessage = item.emailMessageId
        ? await prisma.emailMessage.findFirst({
            where: { id: item.emailMessageId, organizationId },
            select: { id: true, clientId: true, fromAddress: true, receivedAt: true },
          })
        : null;

      const clientId = await ensureInvoiceBackfillClient({
        organizationId,
        existingClientId: emailMessage?.clientId ?? null,
        supplierName: item.supplierName,
        senderEmail: item.senderEmail || extractEmail(emailMessage?.fromAddress ?? ""),
        occurredAt: item.occurredAt,
      });
      if (!clientId) {
        skipped++;
        errors.push({ gmailMessageId: item.gmailMessageId, reason: "missing_client_id" });
        continue;
      }

      const invoiceNumber = extractInvoiceNumber(`${item.subject}\n${item.decisionReason ?? ""}`);
      const invoiceDate = emailMessage?.receivedAt ?? item.occurredAt;
      const amount = item.amount ?? 0;
      const duplicate = await findExistingInvoiceByBusinessKey({
        organizationId,
        clientId,
        supplierName: item.supplierName,
        invoiceNumber,
        amount,
        date: invoiceDate,
      });
      if (duplicate) {
        duplicates++;
        continue;
      }

      const invoice = await prisma.invoice.create({
        data: {
          organizationId,
          clientId,
          invoiceNumber,
          amount,
          currency: "ILS",
          date: invoiceDate,
          status: item.documentType === "receipt" ? "paid" : "pending",
          description: `${item.supplierName} · ${item.subject}\nGmail: ${item.gmailMessageLink}`,
          driveUrl: item.driveFileLink,
          emailId: item.emailMessageId,
          fromEmail: item.senderEmail,
          gmailMessageId: item.gmailMessageId,
        },
      });
      created++;
      console.log(`[invoice-backfill] invoice created org=${organizationId} invoice=${invoice.id} gmail=${item.gmailMessageId} supplier="${item.supplierName}" amount=${amount}`);

      if (item.emailMessageId) {
        await prisma.supplierPayment.updateMany({
          where: {
            organizationId,
            emailMessageId: item.emailMessageId,
            invoiceLink: null,
          },
          data: {
            invoiceLink: item.driveFileLink,
            missingInvoice: false,
          },
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      errors.push({ gmailMessageId: item.gmailMessageId, reason });
      console.error(`[invoice-backfill] failed org=${organizationId} gmail=${item.gmailMessageId}`, err);
    }
  }
  const paymentBackfill = await backfillInvoicesFromSupplierPayments(organizationId, limit);

  return {
    candidates: candidates.length,
    paymentCandidates: paymentBackfill.candidates,
    created: created + paymentBackfill.created,
    duplicates: duplicates + paymentBackfill.duplicates,
    skipped: skipped + paymentBackfill.skipped,
    errors: [...errors, ...paymentBackfill.errors],
  };
}

async function backfillInvoicesFromSupplierPayments(organizationId: string, limit: number) {
  const candidates = await prisma.supplierPayment.findMany({
    where: {
      organizationId,
      invoiceLink: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      clientId: true,
      supplier: true,
      amount: true,
      currency: true,
      date: true,
      dueDate: true,
      paid: true,
      invoiceLink: true,
      documentLink: true,
      emailSender: true,
      subject: true,
      emailMessageId: true,
      createdAt: true,
    },
  });

  let created = 0;
  let duplicates = 0;
  let skipped = 0;
  const errors: Array<{ gmailMessageId: string; reason: string }> = [];

  for (const payment of candidates) {
    try {
      const emailMessage = payment.emailMessageId
        ? await prisma.emailMessage.findFirst({
            where: { id: payment.emailMessageId, organizationId },
            select: { id: true, gmailId: true, clientId: true, fromAddress: true, receivedAt: true },
          })
        : null;
      const gmailMessageId = emailMessage?.gmailId ?? `supplier-payment:${payment.id}`;
      const existingByGmail = await prisma.invoice.findFirst({
        where: { organizationId, gmailMessageId },
        select: { id: true },
      });
      if (existingByGmail) {
        duplicates++;
        continue;
      }

      const clientId = await ensureInvoiceBackfillClient({
        organizationId,
        existingClientId: payment.clientId ?? emailMessage?.clientId ?? null,
        supplierName: payment.supplier,
        senderEmail: extractEmail(payment.emailSender ?? emailMessage?.fromAddress ?? ""),
        occurredAt: payment.date,
      });
      if (!clientId) {
        skipped++;
        errors.push({ gmailMessageId, reason: "missing_client_id" });
        continue;
      }

      const invoiceNumber = extractInvoiceNumber(payment.subject ?? "");
      const duplicate = await findExistingInvoiceByBusinessKey({
        organizationId,
        clientId,
        supplierName: payment.supplier,
        invoiceNumber,
        amount: payment.amount,
        date: payment.date,
      });
      if (duplicate) {
        duplicates++;
        continue;
      }

      const invoice = await prisma.invoice.create({
        data: {
          organizationId,
          clientId,
          invoiceNumber,
          amount: payment.amount,
          currency: payment.currency || "ILS",
          date: payment.date,
          dueDate: payment.dueDate,
          status: payment.paid ? "paid" : "pending",
          description: `${payment.supplier} · ${payment.subject ?? "Supplier invoice"}`,
          driveUrl: payment.invoiceLink ?? payment.documentLink,
          emailId: payment.emailMessageId,
          fromEmail: payment.emailSender,
          gmailMessageId,
        },
      });
      created++;
      console.log(`[invoice-backfill] invoice created from payment org=${organizationId} invoice=${invoice.id} payment=${payment.id} supplier="${payment.supplier}" amount=${payment.amount}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      errors.push({ gmailMessageId: `supplier-payment:${payment.id}`, reason });
      console.error(`[invoice-backfill] payment backfill failed org=${organizationId} payment=${payment.id}`, err);
    }
  }

  return { candidates: candidates.length, created, duplicates, skipped, errors };
}

function confidencePercent(value: string) {
  const numeric = Number(String(value).replace("%", ""));
  if (Number.isFinite(numeric)) return numeric;
  if (value === "high") return 80;
  if (value === "medium") return 55;
  return 0;
}

async function ensureInvoiceBackfillClient(input: {
  organizationId: string;
  existingClientId: string | null;
  supplierName: string;
  senderEmail: string;
  occurredAt: Date;
}) {
  if (input.existingClientId) return input.existingClientId;

  const email = input.senderEmail || `invoice-${stableKey(input.supplierName)}@local.invalid`;
  const domain = email.includes("@") ? email.split("@")[1] : `${stableKey(input.supplierName)}.local`;
  const existing = await prisma.client.findFirst({
    where: {
      organizationId: input.organizationId,
      OR: [{ email }, { domain }],
      isActive: true,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const client = await prisma.client.create({
    data: {
      organizationId: input.organizationId,
      name: input.supplierName || domain,
      email,
      domain,
      firstSeen: input.occurredAt,
      lastSeen: input.occurredAt,
      gmailConnected: false,
      color: "#6366F1",
      isActive: true,
    },
    select: { id: true },
  });
  return client.id;
}

async function findExistingInvoiceByBusinessKey(input: {
  organizationId: string;
  clientId: string;
  supplierName: string;
  invoiceNumber: string | null;
  amount: number;
  date: Date;
}) {
  const dateStart = new Date(input.date);
  dateStart.setHours(0, 0, 0, 0);
  const dateEnd = new Date(input.date);
  dateEnd.setHours(23, 59, 59, 999);

  return prisma.invoice.findFirst({
    where: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      amount: input.amount,
      date: { gte: dateStart, lte: dateEnd },
      ...(input.invoiceNumber
        ? { invoiceNumber: input.invoiceNumber }
        : { description: { contains: input.supplierName, mode: "insensitive" } }),
    },
    select: { id: true },
  });
}

function extractInvoiceNumber(text: string) {
  const patterns = [
    /(?:invoice|receipt|חשבונית|קבלה|מספר)\s*(?:no\.?|number|#|מס׳|מספר)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
    /(?:inv|rcpt)[-_]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/[.,;:]+$/, "").slice(0, 80);
  }
  return null;
}

function extractEmail(value: string) {
  return (value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "").toLowerCase();
}

function stableKey(value: string) {
  const normalized = (value || "supplier").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return normalized || createHash("sha256").update(value || "supplier").digest("hex").slice(0, 10);
}
