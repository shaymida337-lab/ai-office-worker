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
