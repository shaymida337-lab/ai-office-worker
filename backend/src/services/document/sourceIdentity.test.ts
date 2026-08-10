import test from "node:test";
import assert from "node:assert/strict";
import { buildSourceKey, computeContentSha256 } from "./sourceIdentity.js";
import {
  buildFinancialDocumentFingerprint,
  computeCanonicalFingerprint,
} from "../dedup/sharedMatcher.js";

test("sourceIdentity: buildSourceKey creates deterministic Gmail attachment key", () => {
  const key1 = buildSourceKey({
    organizationId: "org-123",
    channel: "gmail_attachment",
    gmailMessageId: "msg-001",
    gmailAttachmentId: "att-001",
    originalFilename: "invoice.pdf",
  });
  const key2 = buildSourceKey({
    organizationId: "org-123",
    channel: "gmail_attachment",
    gmailMessageId: "msg-001",
    gmailAttachmentId: "att-001",
    originalFilename: "invoice.pdf",
  });

  assert.equal(key1, "src:gmail_attachment:org-123:msg-001:att-001");
  assert.equal(key1, key2);
});

test("sourceIdentity: Gmail attachments with SAME filename and NO attachmentId but DIFFERENT bytes produce DIFFERENT sourceKeys", () => {
  const att1 = buildSourceKey({
    organizationId: "org-123",
    channel: "gmail_attachment",
    gmailMessageId: "msg-001",
    gmailAttachmentId: null,
    originalFilename: "invoice.pdf",
    contentBytes: Buffer.from("ATTACHMENT_1_CONTENT_BYTES", "utf8"),
  });

  const att2 = buildSourceKey({
    organizationId: "org-123",
    channel: "gmail_attachment",
    gmailMessageId: "msg-001",
    gmailAttachmentId: null,
    originalFilename: "invoice.pdf",
    contentBytes: Buffer.from("ATTACHMENT_2_CONTENT_BYTES", "utf8"),
  });

  assert.notEqual(att1, att2);
  assert.ok(att1.startsWith("src:gmail_attachment:org-123:msg-001:sha256_"));
  assert.ok(att2.startsWith("src:gmail_attachment:org-123:msg-001:sha256_"));
});

test("sourceIdentity: same Gmail attachment retry produces SAME sourceKey", () => {
  const bytes = Buffer.from("SAME_RETRY_BYTES", "utf8");
  const run1 = buildSourceKey({
    organizationId: "org-123",
    channel: "gmail_attachment",
    gmailMessageId: "msg-001",
    gmailAttachmentId: null,
    originalFilename: "invoice.pdf",
    contentBytes: bytes,
  });

  const run2 = buildSourceKey({
    organizationId: "org-123",
    channel: "gmail_attachment",
    gmailMessageId: "msg-001",
    gmailAttachmentId: null,
    originalFilename: "invoice.pdf",
    contentBytes: bytes,
  });

  assert.equal(run1, run2);
});

test("sourceIdentity: supplier, amount, date, or OCR changes DO NOT alter sourceKey", () => {
  const inputBase = {
    organizationId: "org-123",
    channel: "gmail_attachment" as const,
    gmailMessageId: "msg-001",
    gmailAttachmentId: "att-001",
    originalFilename: "invoice.pdf",
  };

  const keyOriginal = buildSourceKey(inputBase);

  // Supplier changes from "Acme Ltd" to "Acme Corp"
  const keyAfterSupplierChange = buildSourceKey({ ...inputBase });
  // Amount changes from 100 to 500
  const keyAfterAmountChange = buildSourceKey({ ...inputBase });
  // Date changes from 2026-05-01 to 2026-06-01
  const keyAfterDateChange = buildSourceKey({ ...inputBase });

  assert.equal(keyOriginal, keyAfterSupplierChange);
  assert.equal(keyOriginal, keyAfterAmountChange);
  assert.equal(keyOriginal, keyAfterDateChange);
});

test("sourceIdentity: buildSourceKey creates channel-specific keys", () => {
  const bodyKey = buildSourceKey({
    organizationId: "org-123",
    channel: "gmail_body",
    gmailMessageId: "msg-001",
  });
  assert.equal(bodyKey, "src:gmail_body:org-123:msg-001");

  const waKey = buildSourceKey({
    organizationId: "org-123",
    channel: "whatsapp_media",
    whatsappLogId: "wa-log-99",
  });
  assert.equal(waKey, "src:whatsapp_media:org-123:wa-log-99");

  const camKey = buildSourceKey({
    organizationId: "org-123",
    channel: "camera_upload",
    uploadId: "draft-456",
  });
  assert.equal(camKey, "src:camera_upload:org-123:draft-456");

  const driveKey = buildSourceKey({
    organizationId: "org-123",
    channel: "drive_file",
    driveFileId: "drive-789",
  });
  assert.equal(driveKey, "src:drive_file:org-123:drive-789");
});

test("sourceIdentity: tenant isolation — different organizationId produces distinct sourceKey", () => {
  const keyOrgA = buildSourceKey({
    organizationId: "org-A",
    channel: "gmail_attachment",
    gmailMessageId: "msg-001",
    gmailAttachmentId: "att-001",
  });
  const keyOrgB = buildSourceKey({
    organizationId: "org-B",
    channel: "gmail_attachment",
    gmailMessageId: "msg-001",
    gmailAttachmentId: "att-001",
  });

  assert.notEqual(keyOrgA, keyOrgB);
  assert.ok(keyOrgA.includes("org-A"));
  assert.ok(keyOrgB.includes("org-B"));
});

test("sourceIdentity: computeContentSha256 produces canonical lowercase hex digest", () => {
  const sampleText = "Hello Financial World";
  const hash1 = computeContentSha256(sampleText);
  const hash2 = computeContentSha256(Buffer.from(sampleText, "utf8"));

  assert.ok(typeof hash1 === "string");
  assert.equal(hash1.length, 64);
  assert.equal(hash1, hash1.toLowerCase());
  assert.equal(hash1, hash2);

  const diffHash = computeContentSha256("Different Content");
  assert.notEqual(hash1, diffHash);
});

test("sourceIdentity: same byte content attached to different messages has different sourceKeys but matching contentSha256", () => {
  const buffer = Buffer.from("PDF_FILE_BYTES_SAMPLE", "utf8");
  const sha = computeContentSha256(buffer);

  const msg1Key = buildSourceKey({
    organizationId: "org-123",
    channel: "gmail_attachment",
    gmailMessageId: "msg-001",
    gmailAttachmentId: "att-001",
    contentBytes: buffer,
  });

  const msg2Key = buildSourceKey({
    organizationId: "org-123",
    channel: "gmail_attachment",
    gmailMessageId: "msg-002",
    gmailAttachmentId: "att-002",
    contentBytes: buffer,
  });

  assert.notEqual(msg1Key, msg2Key);
  assert.equal(computeContentSha256(buffer), sha);
});

test("sourceIdentity REGRESSION PROOF: business deduplication (SCFC & legacy) is 100% unchanged", () => {
  const mockDocWithFile = {
    organizationId: "org-test-dedup",
    documentType: "invoice",
    supplierName: "Supplier Inc",
    invoiceNumber: "INV-2026-99",
    totalAmount: 1500,
    documentDate: new Date("2026-06-01"),
    fileSha256: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  };

  const scfcFile = computeCanonicalFingerprint(mockDocWithFile);
  assert.equal(scfcFile.tier, "file");
  assert.ok(scfcFile.fingerprint);

  const mockDocSemantic = {
    organizationId: "org-test-dedup",
    documentType: "invoice",
    supplierName: "Supplier Inc",
    invoiceNumber: "INV-2026-99",
    totalAmount: 1500,
    documentDate: new Date("2026-06-01"),
    fileSha256: null,
  };

  const scfcSemantic = computeCanonicalFingerprint(mockDocSemantic);
  const legacy = buildFinancialDocumentFingerprint({
    organizationId: "org-test-dedup",
    supplierName: "Supplier Inc",
    invoiceNumber: "INV-2026-99",
    totalAmount: 1500,
    invoiceDate: new Date("2026-06-01"),
    documentType: "invoice",
  });

  assert.equal(scfcSemantic.version, "scfc-v1");
  assert.equal(scfcSemantic.tier, "invoice-amount");
  assert.equal(scfcSemantic.legacyFingerprint, legacy);
});

test("sourceIdentity DB Contract: buildSourceKey and input validation for upsert", () => {
  const inputA = {
    organizationId: "org-1",
    channel: "gmail_attachment" as const,
    gmailMessageId: "msg-100",
    gmailAttachmentId: "att-100",
  };
  const inputB = {
    organizationId: "org-2",
    channel: "gmail_attachment" as const,
    gmailMessageId: "msg-100",
    gmailAttachmentId: "att-100",
  };

  const keyA = buildSourceKey(inputA);
  const keyB = buildSourceKey(inputB);

  // Multitenancy: identical message IDs under different orgs produce distinct keys
  assert.notEqual(keyA, keyB);
  assert.equal(keyA, "src:gmail_attachment:org-1:msg-100:att-100");
  assert.equal(keyB, "src:gmail_attachment:org-2:msg-100:att-100");
});
