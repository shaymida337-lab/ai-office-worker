import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cameraDraftFingerprints,
  ingestCameraDocument,
  type CameraIngestionDeps,
} from "./cameraIngestion.js";

const FILE_BASE64 = Buffer.from("%PDF-1.4 camera test file").toString("base64");

type MockCall = { op: "upsert" | "update"; args: any };

function buildMockDb(calls: MockCall[]) {
  return {
    financialDocumentReview: {
      upsert: async (args: any) => {
        calls.push({ op: "upsert", args });
        return { id: "draft-1", ...args.create };
      },
      update: async (args: any) => {
        calls.push({ op: "update", args });
        return { id: "draft-1" };
      },
    },
  } as unknown as NonNullable<CameraIngestionDeps["prismaClient"]>;
}

const baseInput = {
  organizationId: "org-1",
  filename: "invoice-photo.jpg",
  mimeType: "image/jpeg",
  fileBase64: FILE_BASE64,
};

const noopSaveLocal = async () => "/uploads/camera-invoices/test.jpg";

test("amount=null from extraction still creates a persisted draft", async () => {
  const calls: MockCall[] = [];
  const result = await ingestCameraDocument(baseInput, {
    prismaClient: buildMockDb(calls),
    saveLocalFile: noopSaveLocal,
    analyzeFile: async () => ({ supplier: "Microsoft", amount: null, date: null, invoiceNumber: "G169777544", currency: "USD" }),
  });

  const upsert = calls.find((c) => c.op === "upsert");
  assert.ok(upsert, "draft must be created before extraction result is applied");
  assert.equal(upsert!.args.create.source, "camera");
  assert.equal(upsert!.args.create.reviewStatus, "needs_review");
  assert.equal(result.reviewId, "draft-1");
  assert.match(result.uncertaintyReason, /סכום/);

  const update = calls.find((c) => c.op === "update");
  assert.ok(update, "extraction result must update the same draft");
  assert.equal(update!.args.where.id, "draft-1");
  assert.equal(update!.args.data.totalAmount, undefined, "null amount must not be written as 0");
});

test("supplier=null from extraction still creates a persisted draft", async () => {
  const calls: MockCall[] = [];
  const result = await ingestCameraDocument(baseInput, {
    prismaClient: buildMockDb(calls),
    saveLocalFile: noopSaveLocal,
    analyzeFile: async () => ({ supplier: null, amount: 114, date: "2026-07-10", invoiceNumber: null, currency: "ILS" }),
  });

  assert.ok(calls.some((c) => c.op === "upsert"));
  assert.equal(result.reviewId, "draft-1");
  assert.match(result.uncertaintyReason, /ספק/);
  const update = calls.find((c) => c.op === "update");
  assert.equal(update!.args.data.totalAmount, 114);
  assert.equal(update!.args.data.supplierName, undefined);
});

test("OCR/extraction error still leaves a persisted record with a clear reason", async () => {
  const calls: MockCall[] = [];
  const result = await ingestCameraDocument(baseInput, {
    prismaClient: buildMockDb(calls),
    saveLocalFile: noopSaveLocal,
    analyzeFile: async () => {
      throw new Error("model timeout");
    },
  });

  assert.ok(calls.some((c) => c.op === "upsert"), "draft exists even when OCR throws");
  assert.equal(result.reviewId, "draft-1");
  assert.equal(result.extractionError, "model timeout");
  assert.equal(result.uncertaintyReason, "לא ניתן היה לזהות את כל הפרטים — יש להשלים ידנית");
  const update = calls.find((c) => c.op === "update");
  assert.equal(update!.args.data.uncertaintyReason, "לא ניתן היה לזהות את כל הפרטים — יש להשלים ידנית");
});

test("end-to-end shape: upload with amount=null returns success payload with reviewId and a persisted needs_review record", async () => {
  // מדמה את מסלול ה-endpoint המלא: קלט ה-upload כפי שמגיע מהדפדפן,
  // והפלט כפי שה-route מחזיר ללקוח (reviewId = הוכחת persist).
  const calls: MockCall[] = [];
  const result = await ingestCameraDocument(
    { organizationId: "org-e2e", filename: "מסמך-בלי-סכום.pdf", mimeType: "application/pdf", fileBase64: FILE_BASE64 },
    {
      prismaClient: buildMockDb(calls),
      saveLocalFile: noopSaveLocal,
      analyzeFile: async () => ({ supplier: "ספק כלשהו", amount: null, date: null, invoiceNumber: null, currency: "ILS" }),
    }
  );

  // success + reviewId — מה שה-route מחזיר כ-200
  assert.ok(result.reviewId, "response must include reviewId");
  assert.equal(result.extractionError, null);

  // הרשומה שנוצרה: needs_review, source=camera, עם הקובץ וה-MIME
  const upsert = calls.find((c) => c.op === "upsert")!;
  assert.equal(upsert.args.create.reviewStatus, "needs_review");
  assert.equal(upsert.args.create.source, "camera");
  assert.equal(upsert.args.create.fileName, "מסמך-בלי-סכום.pdf");
  assert.equal(upsert.args.create.parsedFieldsJson.camera.mimeType, "application/pdf");
  assert.equal(upsert.args.create.parsedFieldsJson.camera.processingStatus, "processing");

  // עומדת בקריטריוני מסך "השלמת חשבוניות" (documentType נתמך + needs_review)
  assert.equal(upsert.args.create.documentType, "tax_invoice");
});

test("success updates the SAME record — same fingerprint on every ingest of the same file", async () => {
  const calls: MockCall[] = [];
  const deps: CameraIngestionDeps = {
    prismaClient: buildMockDb(calls),
    saveLocalFile: noopSaveLocal,
    analyzeFile: async () => ({ supplier: "בזק", amount: 129.9, date: "2026-07-01", invoiceNumber: "4471", currency: "ILS" }),
  };
  const first = await ingestCameraDocument(baseInput, deps);
  const second = await ingestCameraDocument(baseInput, deps);

  const upserts = calls.filter((c) => c.op === "upsert");
  assert.equal(upserts.length, 2, "re-ingest goes through upsert, never a second create path");
  const fp1 = upserts[0].args.where.organizationId_documentFingerprint.documentFingerprint;
  const fp2 = upserts[1].args.where.organizationId_documentFingerprint.documentFingerprint;
  assert.equal(fp1, fp2, "same file => same fingerprint => same row");
  assert.equal(first.fileSha256, second.fileSha256);

  const update = calls.find((c) => c.op === "update");
  assert.equal(update!.args.where.id, "draft-1");
  assert.equal(update!.args.data.supplierName, "בזק");
  assert.equal(update!.args.data.totalAmount, 129.9);
});

test("draft fingerprint equals the canonical file-tier fingerprint used by the confirm path", () => {
  // מבטיח שאישור מלא (recordManualEntryFinancialDocument עם אותו fileSha256)
  // יבצע upsert על אותה רשומה ולא ייצור שנייה.
  const sha = "a".repeat(64);
  const a = cameraDraftFingerprints("org-1", sha);
  const b = cameraDraftFingerprints("org-1", sha);
  assert.equal(a.documentFingerprint, b.documentFingerprint);
  assert.notEqual(cameraDraftFingerprints("org-2", sha).documentFingerprint, a.documentFingerprint);
});

test("confirm flow: preview creates reviewId → confirm approves the SAME record exactly once (double-click safe)", async () => {
  const { confirmCameraDocument } = await import("./cameraIngestion.js");

  // --- שלב 1: preview יוצר draft עם fileSha256 ---
  const ingestCalls: MockCall[] = [];
  const ingest = await ingestCameraDocument(baseInput, {
    prismaClient: buildMockDb(ingestCalls),
    saveLocalFile: noopSaveLocal,
    analyzeFile: async () => ({ supplier: "Microsoft", amount: 114, date: "2026-07-10", invoiceNumber: "G169777544", currency: "USD" }),
  });
  assert.equal(ingest.reviewId, "draft-1");

  // --- שלב 2: confirm עם אותו reviewId ---
  let manualEntryCalls = 0;
  const updates: any[] = [];
  const draftRow: Record<string, unknown> = {
    id: "draft-1",
    organizationId: "org-1",
    source: "camera",
    subject: "העלאה ישירה — invoice-photo.jpg",
    fileName: "invoice-photo.jpg",
    fileSize: 25,
    reviewStatus: "needs_review",
    supplierPaymentId: null,
    invoiceNumber: "G169777544",
    documentDate: null,
    currency: "USD",
    driveFileUrl: "/uploads/camera-invoices/test.jpg",
    driveUploadStatus: null,
    parsedFieldsJson: { camera: { fileSha256: ingest.fileSha256 } },
  };
  const confirmDb = {
    financialDocumentReview: {
      findFirst: async () => ({ ...draftRow }),
      update: async (args: any) => {
        updates.push(args);
        Object.assign(draftRow, args.data);
        return { id: "draft-1" };
      },
    },
  } as any;
  const recordManualEntry = async (input: Record<string, unknown>) => {
    manualEntryCalls++;
    // האישור חייב להשתמש באותו fileSha256 מה-draft — אותה טביעת אצבע, אותה רשומה
    assert.equal(input.fileSha256, ingest.fileSha256);
    assert.equal(input.driveFileUrl, "/uploads/camera-invoices/test.jpg");
    return { action: "accepted", payment: { id: "payment-77" } };
  };

  const first = await confirmCameraDocument(
    { organizationId: "org-1", reviewId: "draft-1", supplier: "Microsoft", amount: 114, currency: "USD" },
    { prismaClient: confirmDb, recordManualEntry }
  );
  assert.equal(first.status, "approved");
  assert.equal((first as any).supplierPaymentId, "payment-77");
  assert.equal(manualEntryCalls, 1);
  // אותה רשומה עודכנה — לא נוצרה חדשה
  assert.equal(updates.length, 1);
  assert.equal(updates[0].where.id, "draft-1");
  assert.equal(updates[0].data.reviewStatus, "approved");
  assert.equal(updates[0].data.supplierPaymentId, "payment-77");

  // --- שלב 3: לחיצה כפולה — אידמפוטנטי, בלי עיבוד נוסף ---
  const second = await confirmCameraDocument(
    { organizationId: "org-1", reviewId: "draft-1", supplier: "Microsoft", amount: 114, currency: "USD" },
    { prismaClient: confirmDb, recordManualEntry }
  );
  assert.equal(second.status, "approved");
  assert.equal((second as any).alreadyApproved, true);
  assert.equal(manualEntryCalls, 1, "double click must not re-run the manual-entry pipeline");
  assert.equal(updates.length, 1, "double click must not update the record again");
});

test("date gate: 2024-06-16 on 2026-07-13 does not reject — requires explicit confirmation, document stays saved", async () => {
  const { resolveCameraDateGate } = await import("./cameraIngestion.js");
  const now = new Date("2026-07-13T10:00:00Z").getTime();

  // תאריך ישן מ-שנתיים: לא 400 — דרישת אישור עם אזהרה מפורשת
  const gate = resolveCameraDateGate({ invoiceDate: new Date("2024-06-16"), nowMs: now });
  assert.equal(gate.action, "confirm_required");
  assert.match((gate as any).warning, /2024-06-16/);
  assert.match((gate as any).warning, /תקן את התאריך או אשר/);

  // אישור מפורש של המשתמש ⇒ ממשיכים לשמירה
  const confirmed = resolveCameraDateGate({ invoiceDate: new Date("2024-06-16"), dateConfirmed: true, nowMs: now });
  assert.equal(confirmed.action, "proceed");

  // תאריך בטווח ⇒ ממשיכים כרגיל
  const recent = resolveCameraDateGate({ invoiceDate: new Date("2026-07-01"), nowMs: now });
  assert.equal(recent.action, "proceed");

  // תאריך עתידי חריג ⇒ גם הוא דורש אישור, לא נדחה
  const future = resolveCameraDateGate({ invoiceDate: new Date("2029-01-01"), nowMs: now });
  assert.equal(future.action, "confirm_required");
});

test("tenant-safe confirm: full path under ACTIVE ingestion containment (org A ok, org B 403, guard stays up)", async () => {
  const prevFlag = process.env.FINANCIAL_INGESTION_CONTAINMENT;
  process.env.FINANCIAL_INGESTION_CONTAINMENT = "on";
  try {
    const { confirmCameraDocument } = await import("./cameraIngestion.js");
    const { assertFinancialIngestionAllowed } = await import("../p0/financialContainment.js");

    // הוכחה שה-guard פעיל גלובלית: קריאה רגילה (בלי scope מאומת) נחסמת
    assert.throws(
      () => assertFinancialIngestionAllowed("org-a"),
      /temporarily blocked/,
      "global ingestion guard must stay active"
    );
    // scope מזויף עם ארגון לא תואם — עדיין נחסם (אין bypass כללי)
    assert.throws(() =>
      assertFinancialIngestionAllowed("org-b", {
        tenantScopeVerified: true,
        organizationId: "org-a",
        source: "camera",
        reviewId: "r1",
      })
    );

    // (א) preview יוצר draft בארגון A — כתיבת draft ישירה, לא דרך שרשרת ה-ingestion
    const ingestCalls: MockCall[] = [];
    const ingest = await ingestCameraDocument(
      { ...baseInput, organizationId: "org-a" },
      {
        prismaClient: buildMockDb(ingestCalls),
        saveLocalFile: noopSaveLocal,
        analyzeFile: async () => ({ supplier: "בזק", amount: 250, date: "2026-07-01", invoiceNumber: "77", currency: "ILS" }),
      }
    );
    assert.ok(ingest.reviewId);

    // DB מדומה עם מצב אמיתי של הרשומה
    const payments: string[] = [];
    const draftRow: Record<string, unknown> = {
      id: "draft-1",
      organizationId: "org-a",
      source: "camera",
      subject: "העלאה ישירה",
      fileName: "invoice-photo.jpg",
      fileSize: 25,
      reviewStatus: "needs_review",
      supplierPaymentId: null,
      invoiceNumber: "77",
      documentDate: null,
      currency: "ILS",
      driveFileUrl: "/uploads/camera-invoices/test.jpg",
      driveUploadStatus: null,
      parsedFieldsJson: { camera: { fileSha256: ingest.fileSha256 } },
    };
    const confirmOps: string[] = [];
    const confirmDb = {
      financialDocumentReview: {
        findFirst: async (args: any) => {
          confirmOps.push("findFirst");
          return args.where.id === "draft-1" ? { ...draftRow } : null;
        },
        update: async (args: any) => {
          confirmOps.push("update");
          Object.assign(draftRow, args.data);
          return { id: "draft-1" };
        },
        upsert: async () => {
          confirmOps.push("upsert");
          throw new Error("confirm must never create another review");
        },
      },
    } as any;
    // ה-mock מפעיל את ה-guard האמיתי עם ה-scope שהועבר בשרשרת — בדיוק כמו
    // recordFinancialDocumentDecision בפרודקשן. אם ההקשר אובד בדרך — הטסט נופל.
    const recordManualEntry = async (input: Record<string, unknown>) => {
      assertFinancialIngestionAllowed(
        input.organizationId as string,
        input.verifiedTenantScope as Parameters<typeof assertFinancialIngestionAllowed>[1]
      );
      payments.push(input.organizationId as string);
      return { action: "accepted", payment: { id: "pay-1" } };
    };

    // (ב+ג+ד) confirm כארגון A — עובר את ה-containment, מאשר את אותה רשומה
    const first = await confirmCameraDocument(
      { organizationId: "org-a", reviewId: "draft-1", supplier: "בזק", amount: 250, currency: "ILS" },
      { prismaClient: confirmDb, recordManualEntry }
    );
    assert.equal(first.status, "approved");
    assert.equal((first as any).supplierPaymentId, "pay-1");
    assert.equal(payments.length, 1, "exactly one SupplierPayment created");
    assert.equal(payments[0], "org-a");
    assert.equal(draftRow.reviewStatus, "approved");
    assert.equal(draftRow.supplierPaymentId, "pay-1");

    // (ה) confirm חוזר — 200 בלי כפילות
    const again = await confirmCameraDocument(
      { organizationId: "org-a", reviewId: "draft-1", supplier: "בזק", amount: 250, currency: "ILS" },
      { prismaClient: confirmDb, recordManualEntry }
    );
    assert.equal(again.status, "approved");
    assert.equal((again as any).alreadyApproved, true);
    assert.equal((again as any).supplierPaymentId, "pay-1");
    assert.equal(payments.length, 1, "retry must not create a second payment");

    // (ו) confirm של אותה רשומה כארגון B — forbidden (403), בלי לגעת ברשומה
    const asOrgB = await confirmCameraDocument(
      { organizationId: "org-b", reviewId: "draft-1", supplier: "בזק", amount: 250, currency: "ILS" },
      { prismaClient: confirmDb, recordManualEntry }
    );
    assert.equal(asOrgB.status, "forbidden");
    assert.equal(payments.length, 1);

    // (ז) review לא קיים — not_found (404)
    const missing = await confirmCameraDocument(
      { organizationId: "org-a", reviewId: "no-such-id", supplier: "בזק", amount: 250, currency: "ILS" },
      { prismaClient: confirmDb, recordManualEntry }
    );
    assert.equal(missing.status, "not_found");

    // (ח) אין OCR, אין שמירת קובץ, אין draft נוסף במהלך ה-confirm
    assert.ok(!confirmOps.includes("upsert"), "no new review during confirm");
  } finally {
    if (prevFlag === undefined) delete process.env.FINANCIAL_INGESTION_CONTAINMENT;
    else process.env.FINANCIAL_INGESTION_CONTAINMENT = prevFlag;
  }
});
