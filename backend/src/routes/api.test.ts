import test from "node:test";
import assert from "node:assert/strict";
import { filterInvoicesByCompleteness } from "../services/amount/invoiceCompleteness.js";
import {
  buildInvoiceListQueryContext,
  buildInvoiceListWhereInput,
  buildInvoiceMonthsAggregationSql,
  buildPaymentMonthsAggregationSql,
  buildNatalieVoiceCredentials,
  buildReviewCandidateStatuses,
  debugTopPaymentAmountsWhere,
  includeApprovedSupplierPayments,
  invoiceReviewStatusFilter,
  mapDocumentReviewToInvoiceCandidate,
  mapGmailScanItemToInvoiceCandidate,
  mapSupplierPaymentToInvoiceCandidate,
  enrichReviewInvoiceCandidateWithCompleteness,
  mergeInvoiceListCandidates,
  parseInvoiceMonthParam,
  resolveNatalieVoiceSynthesizeProvider,
  summarizeCandidatesByMonth,
  summarizeInvoiceMonthRows,
  sumPaymentMonthCounts,
} from "./api.js";

test("debug top-amounts excludes needs_review supplier payments", () => {
  const where = debugTopPaymentAmountsWhere("org-1");

  assert.equal(where.approvalStatus, "approved");
});

test("debug top-amounts still includes approved supplier payments", () => {
  assert.deepEqual(debugTopPaymentAmountsWhere("org-1"), {
    organizationId: "org-1",
    approvalStatus: "approved",
    paid: false,
    paymentRequired: true,
    amount: { gte: 0, lte: 1_000_000 },
  });
});

test("invoice review status filter recognizes UI review tabs", () => {
  assert.equal(invoiceReviewStatusFilter("approved"), "approved");
  assert.equal(invoiceReviewStatusFilter("needs_review"), "needs_review");
  assert.equal(invoiceReviewStatusFilter("rejected"), "rejected");
  assert.equal(invoiceReviewStatusFilter("paid"), undefined);
});

test("gmail scan item maps to needs_review invoice candidate", () => {
  const now = new Date("2026-06-09T09:00:00.000Z");
  const candidate = mapGmailScanItemToInvoiceCandidate({
    id: "scan-1",
    gmailMessageId: "gmail-1",
    emailMessageId: "email-1",
    gmailMessageLink: "https://mail.google.com/mail/u/0/#inbox/gmail-1",
    sender: "supplier@example.com",
    senderEmail: "supplier@example.com",
    subject: "Invoice 123",
    occurredAt: now,
    amount: 120,
    supplierName: "Supplier",
    attachmentFilename: "invoice.pdf",
    driveFileLink: null,
    confidenceScore: "medium",
    reviewStatus: "needs_review",
    decisionReason: "business review required",
    rawAnalysis: { invoiceNumber: "123", invoiceDate: "2026-06-01", analysis: { currency: "ILS" } },
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(candidate.id, "gmail-scan:scan-1");
  assert.equal(candidate.invoiceNumber, "123");
  assert.equal(candidate.status, "needs_review");
  assert.equal(candidate.reviewStatus, "needs_review");
  assert.equal(candidate.source, "gmail_scan_item");
});

test("gmail scan item with null amount does not map to zero", () => {
  const now = new Date("2026-06-09T09:00:00.000Z");
  const candidate = mapGmailScanItemToInvoiceCandidate({
    id: "scan-null-amount",
    gmailMessageId: "gmail-null",
    emailMessageId: "email-null",
    gmailMessageLink: "https://mail.google.com/mail/u/0/#inbox/gmail-null",
    sender: "supplier@example.com",
    senderEmail: "supplier@example.com",
    subject: "Invoice missing amount",
    occurredAt: now,
    amount: null,
    supplierName: "Supplier",
    attachmentFilename: "invoice.pdf",
    driveFileLink: null,
    confidenceScore: "medium",
    reviewStatus: "needs_review",
    decisionReason: "amount_unresolved",
    rawAnalysis: {
      analysis: { totalAmount: 999, currency: "ILS" },
      parsed_fields_json: { amount: 999, arc: { status: "missing", selectedAmount: null } },
    },
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(candidate.amount, null);
  assert.equal(candidate.amountLabel, "סכום חסר");
  assert.equal(candidate.amountResolved, false);
});

test("gmail scan item uses linked FDR totalAmount when GSI amount is null", () => {
  const now = new Date("2026-06-09T09:00:00.000Z");
  const candidate = mapGmailScanItemToInvoiceCandidate(
    {
      id: "scan-fdr-fallback",
      gmailMessageId: "gmail-fdr",
      emailMessageId: "email-fdr",
      gmailMessageLink: "https://mail.google.com/mail/u/0/#inbox/gmail-fdr",
      sender: "billing@anthropic.com",
      senderEmail: "billing@anthropic.com",
      subject: "Invoice",
      occurredAt: now,
      amount: null,
      supplierName: "Anthropic PBC",
      attachmentFilename: "Invoice-PWMBSFD3-0005.pdf",
      driveFileLink: null,
      confidenceScore: "medium",
      reviewStatus: "needs_review",
      decisionReason: null,
      rawAnalysis: { analysis: { currency: "ILS" } },
      createdAt: now,
      updatedAt: now,
    },
    "org-1",
    { totalAmount: 40.05 },
  );

  assert.equal(candidate.amount, 40.05);
  assert.equal(candidate.amountLabel, "₪40.05");
});

test("gmail scan item uses linked FDR totalAmount 354 when GSI amount is null", () => {
  const now = new Date("2026-06-09T09:00:00.000Z");
  const candidate = mapGmailScanItemToInvoiceCandidate(
    {
      id: "scan-fdr-354",
      gmailMessageId: "gmail-354",
      emailMessageId: null,
      gmailMessageLink: "https://mail.google.com/mail/u/0/#inbox/gmail-354",
      sender: "supplier@example.com",
      senderEmail: "supplier@example.com",
      subject: "Invoice",
      occurredAt: now,
      amount: null,
      supplierName: "לא זוהה",
      attachmentFilename: null,
      driveFileLink: null,
      confidenceScore: "medium",
      reviewStatus: "needs_review",
      decisionReason: null,
      rawAnalysis: null,
      createdAt: now,
      updatedAt: now,
    },
    undefined,
    { totalAmount: 354 },
  );

  assert.equal(candidate.amount, 354);
  assert.equal(candidate.amountLabel, "₪354.00");
});

test("gmail scan item with gate review still returns amount when FDR total exists", () => {
  const now = new Date("2026-06-09T09:00:00.000Z");
  const candidate = mapGmailScanItemToInvoiceCandidate(
    {
      id: "scan-gate-review",
      gmailMessageId: "gmail-review",
      emailMessageId: null,
      gmailMessageLink: "https://mail.google.com/mail/u/0/#inbox/gmail-review",
      sender: "supplier@example.com",
      senderEmail: "supplier@example.com",
      subject: "Invoice",
      occurredAt: now,
      amount: null,
      supplierName: "StackBlitz",
      attachmentFilename: "invoice.pdf",
      driveFileLink: null,
      confidenceScore: "medium",
      reviewStatus: "needs_review",
      decisionReason: null,
      rawAnalysis: null,
      createdAt: now,
      updatedAt: now,
    },
    undefined,
    {
      totalAmount: 25,
      parsedFieldsJson: {
        arc: { status: "resolved", selectedAmount: 25, reasonCode: "INVOICE_TOTAL" },
        gates: [
          {
            gate: "amount",
            verdict: "review",
            reasonCode: "amount.vat_mismatch",
            normalizedAmount: 25,
          },
        ],
      },
    },
  );

  assert.equal(candidate.amount, 25);
  assert.equal(candidate.amountLabel, "₪25.00");
  assert.equal(candidate.reviewStatus, "needs_review");
  assert.equal(candidate.amountResolved, false);
});

test("document review candidate uses canonical totalAmount display", () => {
  const now = new Date("2026-06-09T09:00:00.000Z");
  const candidate = mapDocumentReviewToInvoiceCandidate({
    id: "review-1",
    sender: "supplier@example.com",
    subject: "Invoice",
    fileName: "invoice.pdf",
    invoiceNumber: "123",
    documentDate: now,
    dueDate: null,
    totalAmount: 250.5,
    currency: "ILS",
    driveFileUrl: null,
    supplierName: "Supplier",
    confidenceScore: 0.9,
    reviewStatus: "needs_review",
    uncertaintyReason: null,
    emailMessageId: "email-1",
    gmailMessageId: "gmail-1",
    parsedFieldsJson: { arc: { status: "resolved", selectedAmount: 250.5, reasonCode: "INVOICE_TOTAL" } },
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(candidate.amount, 250.5);
  assert.equal(candidate.amountLabel, "₪250.50");
  assert.equal(candidate.amountResolved, true);
});

test("month totals exclude unresolved invoice amounts", () => {
  const june = new Date("2026-06-15T10:00:00.000Z");
  const merged = [
    { date: june, amount: 100, currency: "ILS" },
    { date: june, amount: null as number | null, currency: "ILS" },
    { date: june, amount: 0, currency: "ILS" },
  ];
  const months = summarizeCandidatesByMonth(
    merged.filter((row): row is { date: Date; amount: number; currency: string } => row.amount != null && row.amount > 0),
    (candidate) => candidate.date
  );
  assert.equal(months[0]?.count, 1);
  assert.equal(months[0]?.totalsByCurrency.ILS, 100);
});

test("resolveNatalieVoiceSynthesizeProvider maps supported config providers", () => {
  assert.equal(resolveNatalieVoiceSynthesizeProvider("azure"), "azure");
  assert.equal(resolveNatalieVoiceSynthesizeProvider("elevenlabs"), "elevenlabs");
  assert.equal(resolveNatalieVoiceSynthesizeProvider("openai"), "openai");
  assert.equal(resolveNatalieVoiceSynthesizeProvider("browser"), null);
  assert.equal(resolveNatalieVoiceSynthesizeProvider("unknown"), null);
});

test("buildNatalieVoiceCredentials maps aiVoice config fields for synthesizeSpeech", () => {
  assert.deepEqual(
    buildNatalieVoiceCredentials({
      azure: {
        speechKey: "azure-key",
        speechRegion: "eastus",
        speechVoice: "he-IL-HilaNeural",
      },
      elevenLabsApiKey: "el-key",
      elevenLabsVoiceId: "voice-1",
      elevenLabsModel: "eleven_multilingual_v2",
      openAiApiKey: "sk-key",
      openAiModel: "gpt-4o-mini-tts",
      openAiVoice: "nova",
    }),
    {
      azureSpeechKey: "azure-key",
      azureSpeechRegion: "eastus",
      azureSpeechVoice: "he-IL-HilaNeural",
      elevenLabsApiKey: "el-key",
      elevenLabsVoiceId: "voice-1",
      elevenLabsModel: "eleven_multilingual_v2",
      openAiApiKey: "sk-key",
      openAiModel: "gpt-4o-mini-tts",
      openAiVoice: "nova",
    }
  );
});

test("invoice list query context preserves existing include flags", () => {
  const defaultCtx = buildInvoiceListQueryContext({ organizationId: "org-1" });
  assert.equal(defaultCtx.includeApprovedInvoices, true);
  assert.equal(defaultCtx.includeReviewCandidates, true);
  // שלב 6: auto_saved נכלל תמיד — רשומות שאושרו אוטומטית לא נעלמות מאף טאב
  assert.deepEqual(defaultCtx.reviewCandidateStatuses, ["needs_review", "rejected", "approved", "auto_saved"]);

  const needsReviewCtx = buildInvoiceListQueryContext({ organizationId: "org-1", status: "needs_review" });
  assert.equal(needsReviewCtx.includeApprovedInvoices, false);
  assert.equal(needsReviewCtx.includeReviewCandidates, true);
  assert.deepEqual(needsReviewCtx.reviewCandidateStatuses, ["needs_review"]);

  const approvedCtx = buildInvoiceListQueryContext({ organizationId: "org-1", status: "approved" });
  assert.equal(approvedCtx.includeApprovedInvoices, true);
  assert.equal(approvedCtx.includeReviewCandidates, true);
  assert.deepEqual(approvedCtx.reviewCandidateStatuses, ["approved", "auto_saved"]);

  const paidCtx = buildInvoiceListQueryContext({ organizationId: "org-1", status: "paid" });
  assert.equal(paidCtx.includeApprovedInvoices, true);
  assert.equal(paidCtx.includeReviewCandidates, false);
  assert.equal(paidCtx.paymentStatus, "paid");
});

test("buildReviewCandidateStatuses keeps approved items out of needs_review", () => {
  assert.deepEqual(buildReviewCandidateStatuses("needs_review"), ["needs_review"]);
  // שלב 6: טאב "מאושר" כולל גם auto_saved — רשומות שאושרו אוטומטית לא נעלמות
  assert.deepEqual(buildReviewCandidateStatuses("approved"), ["approved", "auto_saved"]);
  assert.deepEqual(buildReviewCandidateStatuses(undefined), ["needs_review", "rejected", "approved", "auto_saved"]);
});

test("buildInvoiceListWhereInput loads manually approved gmail scan items in approved tab", () => {
  const where = buildInvoiceListWhereInput(
    buildInvoiceListQueryContext({ organizationId: "org-1", status: "approved" })
  );
  // שלב 6: הטאב "מאושר" טוען גם auto_saved (GSI); ל-FDR אין auto_saved — הפילטר in לא מזיק
  assert.deepEqual(where.gmailScanItemWhere.reviewStatus, { in: ["approved", "auto_saved"] });
  assert.deepEqual(where.financialDocumentReviewWhere.reviewStatus, { in: ["approved", "auto_saved"] });
  assert.equal(where.includeApprovedSupplierPayments, true);
  assert.equal(where.supplierPaymentWhere.approvalStatus, "approved");
});

test("buildInvoiceListWhereInput excludes supplier payments on needs_review tab", () => {
  const where = buildInvoiceListWhereInput(
    buildInvoiceListQueryContext({ organizationId: "org-1", status: "needs_review" })
  );
  assert.equal(where.includeApprovedSupplierPayments, false);
});

test("parseInvoiceMonthParam accepts YYYY-MM only", () => {
  assert.deepEqual(parseInvoiceMonthParam("2026-06"), { year: 2026, month: 6 });
  assert.equal(parseInvoiceMonthParam("2026-13"), null);
  assert.equal(parseInvoiceMonthParam("bad"), null);
});

test("buildInvoiceListWhereInput mirrors legacy invoice filters", () => {
  const ctx = buildInvoiceListQueryContext({
    organizationId: "org-1",
    clientId: "client-1",
    search: "acme",
    status: "paid",
  });
  const where = buildInvoiceListWhereInput(ctx);
  assert.equal(where.includeApprovedInvoices, true);
  assert.equal(where.includeReviewCandidates, false);
  assert.deepEqual(where.invoiceWhere, {
    organizationId: "org-1",
    clientId: "client-1",
    status: "paid",
    OR: [
      { invoiceNumber: { contains: "acme", mode: "insensitive" } },
      { description: { contains: "acme", mode: "insensitive" } },
      { supplierName: { contains: "acme", mode: "insensitive" } },
      { fromEmail: { contains: "acme", mode: "insensitive" } },
      { client: { name: { contains: "acme", mode: "insensitive" } } },
    ],
  });
});

test("payment months aggregation sql groups SupplierPayment by normalizedDocumentDate", () => {
  const { sql } = buildPaymentMonthsAggregationSql("org-1", "Asia/Jerusalem");
  assert.match(sql, /"SupplierPayment"/);
  assert.match(sql, /normalizedDocumentDate/);
  assert.match(sql, /approvalStatus/);
  assert.doesNotMatch(sql, /UNION ALL/);
});

test("summarized payment month counts equal total approved rows", () => {
  const rows = [
    { year: 2026, month: 6, currency: "ILS", count: 2, total: 300 },
    { year: 2026, month: 6, currency: "USD", count: 1, total: 50 },
    { year: 2026, month: 5, currency: "ILS", count: 1, total: 100 },
  ];
  const months = summarizeInvoiceMonthRows(rows);
  assert.equal(sumPaymentMonthCounts(months), 4);
  assert.equal(months[0]?.year, 2026);
  assert.equal(months[0]?.month, 6);
  assert.equal(months[0]?.count, 3);
  assert.equal(months[0]?.totalsByCurrency.ILS, 300);
  assert.equal(months[0]?.totalsByCurrency.USD, 50);
});

test("months aggregation sql includes dedup guards across all sources", () => {
  const ctx = buildInvoiceListQueryContext({ organizationId: "org-1" });
  const { sql } = buildInvoiceMonthsAggregationSql(ctx, "Asia/Jerusalem");
  assert.match(sql, /UNION ALL/);
  assert.match(sql, /NOT EXISTS/);
  assert.match(sql, /"GmailScanItem"/);
  assert.match(sql, /"FinancialDocumentReview"/);
  assert.match(sql, /"SupplierPayment"/);
  assert.match(sql, /normalizedDocumentDate/);
});

test("includeApprovedSupplierPayments is false on needs_review tab only", () => {
  assert.equal(includeApprovedSupplierPayments(buildInvoiceListQueryContext({ organizationId: "org-1" })), true);
  assert.equal(
    includeApprovedSupplierPayments(buildInvoiceListQueryContext({ organizationId: "org-1", status: "approved" })),
    true
  );
  assert.equal(
    includeApprovedSupplierPayments(buildInvoiceListQueryContext({ organizationId: "org-1", status: "needs_review" })),
    false
  );
});

test("summarized month counts equal total deduped records", () => {
  const june = new Date("2026-06-10T09:00:00.000Z");
  const may = new Date("2026-05-10T09:00:00.000Z");
  const invoiceRows = [
    {
      id: "inv-1",
      gmailMessageId: "gmail-1",
      emailId: null,
      amount: 100,
      currency: "ILS",
      driveFileUrl: "https://drive/1",
      driveUrl: "https://drive/1",
      createdAt: june,
      date: june,
    },
    {
      id: "inv-2",
      gmailMessageId: "gmail-3",
      emailId: null,
      amount: 50,
      currency: "USD",
      driveFileUrl: null,
      driveUrl: null,
      createdAt: may,
      date: may,
    },
  ];
  const gmailScanItems = [
    {
      id: "scan-dup",
      gmailMessageId: "gmail-1",
      emailMessageId: "email-dup",
      gmailMessageLink: "https://mail.google.com/mail/u/0/#inbox/gmail-1",
      sender: "supplier@example.com",
      senderEmail: "supplier@example.com",
      subject: "Duplicate",
      occurredAt: june,
      amount: 999,
      supplierName: "Supplier",
      attachmentFilename: null,
      driveFileLink: null,
      confidenceScore: "low",
      reviewStatus: "needs_review",
      decisionReason: "dup",
      rawAnalysis: { analysis: { currency: "ILS", totalAmount: 999 } },
      createdAt: june,
      updatedAt: june,
    },
    {
      id: "scan-unique",
      gmailMessageId: "gmail-2",
      emailMessageId: "email-2",
      gmailMessageLink: "https://mail.google.com/mail/u/0/#inbox/gmail-2",
      sender: "other@example.com",
      senderEmail: "other@example.com",
      subject: "Unique",
      occurredAt: june,
      amount: 75,
      supplierName: "Other",
      attachmentFilename: null,
      driveFileLink: null,
      confidenceScore: "medium",
      reviewStatus: "needs_review",
      decisionReason: "review",
      rawAnalysis: { analysis: { currency: "EUR" } },
      createdAt: june,
      updatedAt: june,
    },
  ];
  const documentReviews = [
    {
      id: "review-dup",
      sender: "supplier@example.com",
      subject: "Dup review",
      fileName: null,
      invoiceNumber: "R-1",
      documentDate: june,
      dueDate: null,
      totalAmount: 40,
      currency: "ILS",
      driveFileUrl: null,
      supplierName: "Supplier",
      confidenceScore: 0.5,
      reviewStatus: "needs_review",
      uncertaintyReason: "dup",
      emailMessageId: "email-2",
      gmailMessageId: null,
      createdAt: june,
      updatedAt: june,
    },
  ];

  const merged = mergeInvoiceListCandidates({ invoiceRows, gmailScanItems, documentReviews });
  assert.equal(merged.length, 3);

  const months = summarizeCandidatesByMonth(merged, (candidate) => candidate.date);
  const monthCountTotal = months.reduce((sum, month) => sum + month.count, 0);
  assert.equal(monthCountTotal, merged.length);

  const aggregationRows = summarizeInvoiceMonthRows([
    { year: 2026, month: 6, currency: "ILS", count: 2, total: 175 },
    { year: 2026, month: 5, currency: "USD", count: 1, total: 50 },
  ]);
  assert.equal(aggregationRows.reduce((sum, month) => sum + month.count, 0), 3);
});

test("approved gmail scan items remain visible in merged invoice list", () => {
  const approvedAt = new Date("2026-06-12T09:00:00.000Z");
  const merged = mergeInvoiceListCandidates({
    invoiceRows: [],
    gmailScanItems: [
      {
        id: "scan-approved",
        gmailMessageId: "gmail-approved",
        emailMessageId: "email-approved",
        gmailMessageLink: "https://mail.google.com/mail/u/0/#inbox/gmail-approved",
        sender: "supplier@example.com",
        senderEmail: "supplier@example.com",
        subject: "Approved invoice",
        occurredAt: approvedAt,
        amount: 250,
        supplierName: "Supplier Ltd",
        attachmentFilename: "invoice.pdf",
        driveFileLink: null,
        confidenceScore: "high",
        reviewStatus: "approved",
        decisionReason: "manual approval",
        rawAnalysis: {},
        createdAt: approvedAt,
        updatedAt: approvedAt,
      },
    ],
    documentReviews: [],
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.reviewStatus, "approved");
  assert.equal(merged[0]?.source, "gmail_scan_item");
});

test("approved supplier payment stays visible when linked review is deduped", () => {
  const approvedAt = new Date("2026-07-07T08:00:00.000Z");
  const supplierPayments = [
    {
      id: "payment-ondo",
      supplier: "אונדו",
      supplierName: "אונדו",
      amount: 48,
      totalAmount: 48,
      currency: "ILS",
      date: approvedAt,
      normalizedDocumentDate: approvedAt,
      dueDate: null,
      invoiceNumber: null,
      documentTypeDetailed: "receipt",
      documentLink: "/uploads/gmail-invoices/ondo.pdf",
      invoiceLink: "/uploads/gmail-invoices/ondo.pdf",
      driveFileUrl: null,
      emailSender: "billing@ondo.example",
      emailMessageId: "email-ondo",
      subject: "קבלה",
      confidenceScore: 0.8,
      parsedFieldsJson: null,
      createdAt: approvedAt,
      updatedAt: approvedAt,
    },
  ];
  const documentReviews = [
    {
      id: "review-ondo",
      sender: "billing@ondo.example",
      subject: "קבלה",
      fileName: "ondo.pdf",
      invoiceNumber: null,
      documentDate: approvedAt,
      dueDate: null,
      totalAmount: 48,
      currency: "ILS",
      driveFileUrl: "/uploads/gmail-invoices/ondo.pdf",
      supplierName: "אונדו",
      confidenceScore: 0.8,
      reviewStatus: "approved",
      uncertaintyReason: null,
      emailMessageId: "email-ondo",
      gmailMessageId: "gmail-ondo",
      supplierPaymentId: "payment-ondo",
      normalizedDocumentDate: approvedAt,
      createdAt: approvedAt,
      updatedAt: approvedAt,
    },
  ];
  const gmailScanItems = [
    {
      id: "scan-ondo",
      gmailMessageId: "gmail-ondo",
      emailMessageId: "email-ondo",
      gmailMessageLink: "https://mail.google.com/mail/u/0/#inbox/gmail-ondo",
      sender: "billing@ondo.example",
      senderEmail: "billing@ondo.example",
      subject: "קבלה",
      occurredAt: approvedAt,
      amount: 48,
      supplierName: "אונדו",
      attachmentFilename: "ondo.pdf",
      driveFileLink: null,
      confidenceScore: "medium",
      reviewStatus: "needs_review",
      decisionReason: "trust.amount_gate_missing",
      rawAnalysis: { analysis: { currency: "ILS", totalAmount: 48 } },
      createdAt: approvedAt,
      updatedAt: approvedAt,
    },
  ];

  const merged = mergeInvoiceListCandidates({
    invoiceRows: [],
    gmailScanItems,
    documentReviews,
    supplierPayments,
  });

  const paymentRow = merged.find((row) => row.id === "supplier-payment:payment-ondo");
  assert.ok(paymentRow, "approved supplier payment must appear in invoice list");
  assert.equal(paymentRow?.source, "supplier_payment");
  assert.equal(
    merged.filter((row) => row.id === "document-review:review-ondo").length,
    0,
    "linked review row should not duplicate the supplier payment",
  );
});

test("mapSupplierPaymentToInvoiceCandidate maps approved receipt to invoice row", () => {
  const approvedAt = new Date("2026-07-07T08:00:00.000Z");
  const row = mapSupplierPaymentToInvoiceCandidate({
    id: "payment-1",
    supplier: "אונדו",
    supplierName: "אונדו",
    amount: 48,
    totalAmount: 48,
    currency: "ILS",
    date: approvedAt,
    normalizedDocumentDate: approvedAt,
    dueDate: null,
    invoiceNumber: null,
    documentTypeDetailed: "receipt",
    documentLink: "/uploads/ondo.pdf",
    invoiceLink: "/uploads/ondo.pdf",
    driveFileUrl: null,
    emailSender: "billing@ondo.example",
    emailMessageId: "email-1",
    subject: "קבלה",
    confidenceScore: 0.8,
    parsedFieldsJson: null,
    createdAt: approvedAt,
    updatedAt: approvedAt,
  });
  assert.equal(row.id, "supplier-payment:payment-1");
  assert.equal(row.reviewStatus, "approved");
  assert.equal(row.source, "supplier_payment");
});

test("filterInvoicesByCompleteness keeps complete and incomplete lists disjoint", () => {
  const approvedAt = new Date("2026-07-07T08:00:00.000Z");
  const complete = enrichReviewInvoiceCandidateWithCompleteness({
    id: "supplier-payment:payment-complete",
    clientId: "",
    invoiceNumber: "1",
    amount: 100,
    amountLabel: "₪100.00",
    amountResolved: true,
    currency: "ILS",
    currencyExplicit: true,
    date: approvedAt,
    documentDateExplicit: true,
    dueDate: null,
    status: "approved",
    reviewStatus: "approved",
    source: "supplier_payment",
    reviewSourceId: "payment-complete",
    description: null,
    driveUrl: null,
    driveFileUrl: null,
    client: null,
    supplierName: "ספק תקין",
    fromEmail: null,
    gmailMessageId: null,
    confidenceScore: 0.9,
    decisionReason: null,
    attachmentFilename: null,
    documentType: "tax_invoice",
    parsedFieldsJson: null,
    createdAt: approvedAt,
    updatedAt: approvedAt,
  });
  const incomplete = enrichReviewInvoiceCandidateWithCompleteness({
    id: "gmail-scan:scan-incomplete",
    clientId: "",
    invoiceNumber: null,
    amount: null,
    amountLabel: "סכום חסר",
    amountResolved: false,
    currency: "ILS",
    currencyExplicit: false,
    date: approvedAt,
    documentDateExplicit: false,
    dueDate: null,
    status: "needs_review",
    reviewStatus: "needs_review",
    source: "gmail_scan_item",
    reviewSourceId: "scan-incomplete",
    description: null,
    driveUrl: null,
    driveFileUrl: null,
    client: null,
    supplierName: "unknown",
    fromEmail: null,
    gmailMessageId: "gmail-1",
    confidenceScore: "low",
    decisionReason: "trust.amount_gate_missing",
    attachmentFilename: null,
    documentType: "unknown_needs_review",
    parsedFieldsJson: null,
    createdAt: approvedAt,
    updatedAt: approvedAt,
  });

  const completeOnly = filterInvoicesByCompleteness([complete, incomplete], "complete");
  const incompleteOnly = filterInvoicesByCompleteness([complete, incomplete], "incomplete");
  assert.equal(completeOnly.length, 1);
  assert.equal(incompleteOnly.length, 1);
  assert.equal(completeOnly[0]?.id, complete.id);
  assert.equal(incompleteOnly[0]?.id, incomplete.id);
});
