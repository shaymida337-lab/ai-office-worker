import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  attachPreviewToFinancialDocumentReview,
  persistIngestedDocumentPreview,
  reviewIdFromDocumentDecision,
  saveLocalIngestedDocument,
} from "./documentReviewPreview.js";

test("saveLocalIngestedDocument writes under channel-specific uploads folder", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "doc-preview-"));
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    const localPath = await saveLocalIngestedDocument({
      channel: "whatsapp",
      filename: "invoice.jpg",
      buffer: Buffer.from("jpeg-bytes"),
    });
    assert.match(localPath, /^\/uploads\/whatsapp-invoices\//);
    const stored = await readFile(path.join(cwd, localPath), "utf8");
    assert.equal(stored, "jpeg-bytes");
  } finally {
    process.chdir(previous);
  }
});

test("persistIngestedDocumentPreview falls back to local file when Drive is unavailable", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "doc-preview-"));
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    const preview = await persistIngestedDocumentPreview({
      channel: "whatsapp",
      organizationId: "org-1",
      buffer: Buffer.from("jpeg-bytes"),
      filename: "invoice.jpg",
      mimeType: "image/jpeg",
      supplier: "Acme",
      documentType: "invoice",
      fileSha256: "abc123",
      drive: null,
      rootFolderId: null,
    });
    assert.ok(preview.previewUrl?.startsWith("/uploads/whatsapp-invoices/"));
    assert.equal(preview.driveUploadStatus, "pending_retry");
    assert.equal(preview.upload, null);
  } finally {
    process.chdir(previous);
  }
});

test("persistIngestedDocumentPreview uses Drive webViewLink when upload succeeds", async () => {
  const preview = await persistIngestedDocumentPreview({
    channel: "whatsapp",
    organizationId: "org-1",
    buffer: Buffer.from("jpeg-bytes"),
    filename: "invoice.jpg",
    mimeType: "image/jpeg",
    supplier: "Acme",
    documentType: "invoice",
    fileSha256: "abc123",
    drive: {} as never,
    rootFolderId: "root-folder",
    findExistingDriveDocumentFn: async () => null,
    uploadToDriveFn: async () => ({
      fileId: "drive-file-1",
      webViewLink: "https://drive.google.com/file/d/drive-file-1/view",
      clientFolderId: null,
      supplierFolderId: "supplier-folder-1",
      folderId: "folder-1",
      folderPath: "Invoices/Acme",
      folderWebViewLink: null,
      supplierName: "Acme",
      invoiceMonth: 6,
      invoiceYear: 2026,
    }),
  });
  assert.equal(preview.previewUrl, "https://drive.google.com/file/d/drive-file-1/view");
  assert.equal(preview.driveUploadStatus, "uploaded");
  assert.equal(preview.upload?.fileId, "drive-file-1");
});

test("reviewIdFromDocumentDecision extracts review id", () => {
  assert.equal(reviewIdFromDocumentDecision({ action: "needs_review", review: { id: "review-1" } }), "review-1");
  assert.equal(reviewIdFromDocumentDecision({ action: "accepted" }), null);
});

test("attachPreviewToFinancialDocumentReview is exported for shared ingestion pipelines", () => {
  assert.equal(typeof attachPreviewToFinancialDocumentReview, "function");
});
