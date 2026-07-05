import nodeTest from "node:test";
import assert from "node:assert/strict";

import { sanitizePrismaWriteData } from "./postgresTextSanitizer.js";
import { prisma, connectPrisma, databaseHost } from "./prisma.js";

// טסט smoke שדורש PostgreSQL חי עם הסכמה המלאה — רץ רק עם SMOKE_DB=1
// (למשל: SMOKE_DB=1 npx tsx --test src/lib/postgresTextSanitizer.smoke.test.ts).
// בסוויטה הרגילה הוא מדולג כדי לא להיכשל על סביבה בלי DB מתאים.
const SMOKE_ENABLED = process.env.SMOKE_DB === "1";
const test: typeof nodeTest = ((name: string, fn: Parameters<typeof nodeTest>[1]) =>
  nodeTest(name, { skip: SMOKE_ENABLED ? false : "set SMOKE_DB=1 to run DB smoke tests" }, fn)) as typeof nodeTest;

const NUL = "\u0000";
const GMAIL_MESSAGE_ID = "19f17410cc963aaf";
const ORG_ID = "cmqxujfuj034ndy2czu9tjoko";
const DOCUMENT_FINGERPRINT = "20bbe52a32f65d5cd6189cc73761d1d9503aec6458363714";

const PROD_GATES = [
  {
    gate: "amount",
    verdict: "review",
    reasonCode: "amount.vat_mismatch",
    engineVersion: "amount-gate-v1",
    normalizedAmount: 40.01,
  },
  {
    gate: "supplier",
    verdict: "review",
    reasonCode: "supplier.sir_weak_evidence",
    engineVersion: "supplier-gate-v1",
    canonicalSupplierName: "Anthropic PBC #2619 9469 8575",
  },
  {
    gate: "fingerprint",
    tier: "invoice-amount",
    verdict: "pass",
    reasonCode: "fingerprint.resolved",
    engineVersion: "fingerprint-gate-v1",
    documentFingerprint: DOCUMENT_FINGERPRINT,
  },
  {
    gate: "duplicate",
    verdict: "review",
    reasonCode: "duplicate.key_mismatch",
    engineVersion: "duplicate-gate-v1",
    matchStrength: "none",
    matchedReviewId: null,
    matchedPaymentId: null,
  },
] as const;

function productionEquivalentPdfText() {
  return [
    "--- PDF ATTACHMENT TEXT ---",
    "Receipt from Anthropic, PBC",
    `Invoice number PWMBSFD3-0006${NUL}`,
    "Total $40.01",
    "VAT $0.00",
  ].join("\n");
}

function businessSnapshot(payload: {
  amount: number | null;
  supplierName: string;
  documentType: string;
  reviewStatus: string;
  decisionReason: string;
  duplicateKey: string;
  parsedFieldsJson: unknown;
  uncertaintyReason?: string;
}) {
  return {
    amount: payload.amount,
    supplierName: payload.supplierName,
    documentType: payload.documentType,
    reviewStatus: payload.reviewStatus,
    decisionReason: payload.decisionReason,
    duplicateKey: payload.duplicateKey,
    parsedFieldsJson: payload.parsedFieldsJson,
    uncertaintyReason: payload.uncertaintyReason ?? null,
  };
}

function gmailScanItemUpsertPayload() {
  const parsedFieldsJson = { gates: PROD_GATES };
  return {
    organizationId: ORG_ID,
    gmailMessageId: GMAIL_MESSAGE_ID,
    gmailMessageLink: `https://mail.google.com/mail/u/0/#inbox/${GMAIL_MESSAGE_ID}`,
    sender: "Anthropic, PBC <billing@anthropic.com>",
    senderEmail: "billing@anthropic.com",
    subject: "Your receipt from Anthropic, PBC #2619-9469-8575",
    occurredAt: new Date("2026-06-30T06:39:52.222Z"),
    amount: 40.01,
    supplierName: "Anthropic PBC",
    documentType: "unknown_needs_review",
    attachmentFilename: "Receipt-2619-9469-8575.pdf",
    confidenceScore: "low",
    reviewStatus: "needs_review",
    duplicateKey: DOCUMENT_FINGERPRINT,
    decisionReason: "amount.vat_mismatch",
    parsedFieldsJson,
    rawAnalysis: {
      analysis: { supplier: "Anthropic, PBC", amount: 40.01, documentType: "receipt" },
      parsed_fields_json: parsedFieldsJson,
      ocrText: {
        pdfText: productionEquivalentPdfText(),
        visualAttachmentText: "",
      },
      relevant: true,
      hasAttachment: true,
      filenames: ["Receipt-2619-9469-8575.pdf", "Invoice-PWMBSFD3-0006.pdf"],
    },
  };
}

function financialDocumentReviewUpsertPayload() {
  const parsedFieldsJson = { gates: PROD_GATES };
  return {
    organizationId: ORG_ID,
    source: "gmail",
    sender: "billing@anthropic.com",
    subject: "Your receipt from Anthropic, PBC #2619-9469-8575",
    fileName: "Receipt-2619-9469-8575.pdf",
    sourceFingerprint: "source-fingerprint-smoke",
    documentFingerprint: DOCUMENT_FINGERPRINT,
    documentType: "receipt",
    supplierName: "Anthropic PBC",
    totalAmount: 40.01,
    vatAmount: 0,
    amountBeforeVat: 40.01,
    confidenceScore: 0.79,
    reviewStatus: "needs_review",
    uncertaintyReason: "amount.vat_mismatch",
    parsedFieldsJson,
    rawAnalysis: {
      analysis: { supplier: "Anthropic, PBC", amount: 40.01 },
      parsed_fields_json: parsedFieldsJson,
      gmailMessageId: GMAIL_MESSAGE_ID,
    },
    gmailMessageId: GMAIL_MESSAGE_ID,
  };
}

function isLocalDatabaseUrl() {
  const raw = process.env.DATABASE_URL ?? "";
  if (!raw) return false;
  if (/neon\.tech|render\.com|prod/i.test(raw)) return false;
  try {
    const host = new URL(raw).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

test("smoke: production-equivalent PDF payload contains embedded NUL before sanitization", () => {
  const payload = gmailScanItemUpsertPayload();
  assert.match(payload.rawAnalysis.ocrText.pdfText, /\u0000/);
});

test("smoke: sanitization preserves all business fields from production fixture", () => {
  const gsiPayload = gmailScanItemUpsertPayload();
  const fdrPayload = financialDocumentReviewUpsertPayload();
  const cleanedGsi = sanitizePrismaWriteData(gsiPayload);
  const cleanedFdr = sanitizePrismaWriteData(fdrPayload);

  assert.deepEqual(businessSnapshot(cleanedGsi), businessSnapshot(gsiPayload));
  assert.equal(cleanedFdr.supplierName, fdrPayload.supplierName);
  assert.equal(cleanedFdr.totalAmount, fdrPayload.totalAmount);
  assert.equal(cleanedFdr.vatAmount, fdrPayload.vatAmount);
  assert.equal(cleanedFdr.amountBeforeVat, fdrPayload.amountBeforeVat);
  assert.equal(cleanedFdr.documentType, fdrPayload.documentType);
  assert.equal(cleanedFdr.reviewStatus, fdrPayload.reviewStatus);
  assert.equal(cleanedFdr.uncertaintyReason, fdrPayload.uncertaintyReason);
  assert.equal(cleanedFdr.documentFingerprint, fdrPayload.documentFingerprint);
  assert.deepEqual(cleanedFdr.parsedFieldsJson, fdrPayload.parsedFieldsJson);
  assert.equal(JSON.stringify(cleanedGsi).includes(NUL), false);
  assert.equal(cleanedGsi.rawAnalysis.ocrText.pdfText.includes(NUL), false);
  assert.match(cleanedGsi.rawAnalysis.ocrText.pdfText, /Total \$40\.01/);
});

test("smoke: unsanitized json payload is rejected by PostgreSQL jsonb cast", async (t) => {
  if (!isLocalDatabaseUrl()) {
    t.skip("local DATABASE_URL not configured");
    return;
  }
  await connectPrisma();
  const contaminated = gmailScanItemUpsertPayload().rawAnalysis;
  await assert.rejects(
    () => prisma.$queryRaw`SELECT ${JSON.stringify(contaminated)}::jsonb AS payload`,
    /null character|22P05|unsupported Unicode|invalid input syntax/i
  );
});

test("smoke: sanitized payloads persist GmailScanItem, FinancialDocumentReview, and EmailMessage.processedAt", async (t) => {
  if (!isLocalDatabaseUrl()) {
    t.skip("local DATABASE_URL not configured");
    return;
  }

  await connectPrisma();
  const gsiPayload = sanitizePrismaWriteData(gmailScanItemUpsertPayload());
  const fdrPayload = sanitizePrismaWriteData(financialDocumentReviewUpsertPayload());

  const sanitizedRoundTrip = await prisma.$queryRaw<Array<{ ok: boolean }>>`
    SELECT ${JSON.stringify(gsiPayload.rawAnalysis)}::jsonb IS NOT NULL AS ok
  `;
  assert.equal(sanitizedRoundTrip[0]?.ok, true);

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) {
    t.skip("local database has no Organization row for persistence smoke");
    return;
  }

  const smokeGmailId = `${GMAIL_MESSAGE_ID}-smoke-${Date.now()}`;
  const duplicateKey = `${DOCUMENT_FINGERPRINT}-${Date.now()}`;
  const gsiCreate = sanitizePrismaWriteData({
    ...gsiPayload,
    organizationId: org.id,
    gmailMessageId: smokeGmailId,
    gmailMessageLink: `https://mail.google.com/mail/u/0/#inbox/${smokeGmailId}`,
    duplicateKey,
  });
  const fdrCreate = sanitizePrismaWriteData({
    ...fdrPayload,
    organizationId: org.id,
    gmailMessageId: smokeGmailId,
    documentFingerprint: duplicateKey,
    sourceFingerprint: `source-${duplicateKey}`,
  });

  let emailMessageId: string | null = null;
  let gsiId: string | null = null;
  let fdrId: string | null = null;

  try {
    const email = await prisma.emailMessage.create({
      data: {
        organizationId: org.id,
        gmailId: smokeGmailId,
        subject: gsiCreate.subject,
        fromAddress: gsiCreate.sender,
        bodyText: "Anthropic receipt body",
        receivedAt: gsiCreate.occurredAt,
      },
    });
    emailMessageId = email.id;

    const gsi = await prisma.gmailScanItem.create({
      data: {
        ...gsiCreate,
        emailMessageId: email.id,
      },
    });
    gsiId = gsi.id;
    assert.notMatch(gsi.decisionReason, /process_save_failed|22P05/);
    assert.equal(gsi.reviewStatus, "needs_review");
    assert.equal(gsi.amount, 40.01);
    assert.deepEqual(gsi.parsedFieldsJson, { gates: PROD_GATES });

    const fdr = await prisma.financialDocumentReview.create({
      data: fdrCreate,
    });
    fdrId = fdr.id;
    assert.equal(fdr.uncertaintyReason, "amount.vat_mismatch");
    assert.equal(fdr.totalAmount, 40.01);

    const processed = await prisma.emailMessage.update({
      where: { id: email.id },
      data: { processedAt: new Date() },
    });
    assert.ok(processed.processedAt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/does not exist in the current database|P2022/.test(message)) {
      t.skip(`local database schema is behind production: ${message}`);
      return;
    }
    throw err;
  } finally {
    if (gsiId) await prisma.gmailScanItem.deleteMany({ where: { id: gsiId } }).catch(() => undefined);
    if (fdrId) await prisma.financialDocumentReview.deleteMany({ where: { id: fdrId } }).catch(() => undefined);
    if (emailMessageId) await prisma.emailMessage.deleteMany({ where: { id: emailMessageId } }).catch(() => undefined);
  }

  console.log(`SMOKE_DB host=${databaseHost()} gmailScanItem=ok financialDocumentReview=ok processedAt=ok`);
});
