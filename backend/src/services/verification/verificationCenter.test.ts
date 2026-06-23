import test from "node:test";
import assert from "node:assert/strict";
import {
  VERIFICATION_CENTER_ROUTE_PATH,
  VERIFICATION_CENTER_VERSION,
  decodeVerificationCursor,
  encodeVerificationCursor,
  getVerificationCenterForOrganization,
  mapVerificationDocument,
  parseVerificationQuery,
  verificationResponseContainsForbiddenFields,
  type VerificationDb,
} from "./verificationCenter.js";

const fixtureParsedFields = {
  amount: 1180,
  invoiceNumber: "INV-2026-001",
  confidence: 0.86,
  arc: {
    selectedAmount: 1180,
    confidence: 0.91,
    status: "resolved",
    reasonCode: "ARC_RESOLVED",
    reason: "Resolved labeled total",
  },
  sir: {
    supplierName: "Acme Supplies",
    canonicalSupplier: "Acme Supplies",
    status: "resolved",
    confidence: 0.88,
    reasonCode: "SIR_RESOLVED",
    reason: "Registry match",
  },
  fse: {
    trustScore: 0.82,
    overallStatus: "valid",
    recommendation: "accept",
  },
  trust: {
    confidence: 90,
    decision: "AUTO_SAVE",
    reasonCode: "TE_STRONG_AGREEMENT",
  },
  outcome: {
    status: "SAVED",
    reasonCode: "OE_SAVED",
    reason: "All engines aligned",
    timeline: [
      { name: "Received", engine: "received", status: "completed", explanation: "Document entered pipeline." },
      { name: "AI Analysis", engine: "ai", status: "completed", explanation: "AI extracted fields." },
      { name: "SCFC", engine: "scfc", status: "completed", explanation: "Fingerprint tier=strong" },
      { name: "ARC", engine: "arc", status: "completed", explanation: "ARC resolved amount=1180" },
      { name: "SIR", engine: "sir", status: "completed", explanation: "SIR resolved supplier=Acme" },
      { name: "FSE", engine: "fse", status: "completed", explanation: "FSE valid trustScore=82" },
      { name: "Trust Engine", engine: "trust", status: "completed", explanation: "Trust AUTO_SAVE confidence=90" },
      { name: "Final Decision", engine: "outcome", status: "completed", explanation: "Saved" },
    ],
  },
  performance: {
    processingMs: 950,
    aiMs: 410,
    ocrMs: 180,
  },
};

test("verification: parseVerificationQuery defaults and filters", () => {
  assert.deepEqual(parseVerificationQuery({}), {
    days: 30,
    limit: 25,
    cursor: null,
    outcome: null,
    review: null,
    supplier: null,
    blocked: false,
    duplicate: false,
    confidence: null,
    search: null,
  });
  assert.equal(parseVerificationQuery({ days: "7", limit: "200", outcome: "saved" }).days, 7);
  assert.equal(parseVerificationQuery({ limit: "200" }).limit, 100);
  assert.equal(parseVerificationQuery({ blocked: "true" }).blocked, true);
});

test("verification: cursor roundtrip", () => {
  const createdAt = new Date("2026-03-01T10:00:00.000Z");
  const cursor = encodeVerificationCursor(createdAt, "gsi_123");
  assert.deepEqual(decodeVerificationCursor(cursor), { createdAt, id: "gsi_123" });
});

test("verification: mapVerificationDocument maps engines and masks invoice number", () => {
  const doc = mapVerificationDocument({
    id: "gsi:abc",
    source: "gmail_scan_item",
    createdAt: new Date("2026-03-01T10:00:00.000Z"),
    amount: 1180,
    supplierName: "Acme Supplies",
    documentType: "invoice",
    reviewStatus: "auto_saved",
    parsedFieldsJson: fixtureParsedFields,
    gmailMessageId: "msg1234567890",
  });

  assert.equal(doc.outcomeStatus, "SAVED");
  assert.equal(doc.trustConfidence, 0.9);
  assert.equal(doc.arcConfidence, 0.91);
  assert.equal(doc.sirConfidence, 0.88);
  assert.equal(doc.fseTrust, 0.82);
  assert.equal(doc.goldenMatch, null);
  assert.equal(doc.invoiceNumberMasked, "INV-****");
  assert.equal(doc.gmailMessageIdPrefix, "msg1…7890");
  assert.equal(doc.timeline.length, 8);
  assert.equal(doc.timeline[3]?.id, "arc");
});

test("verification: response forbids raw analysis fields", () => {
  assert.equal(verificationResponseContainsForbiddenFields({ documents: [{ rawAnalysis: {} }] }), "rawAnalysis");
  assert.equal(verificationResponseContainsForbiddenFields({ documents: [{ supplier: "Acme" }] }), null);
});

test("verification: route path is internal", () => {
  assert.equal(VERIFICATION_CENTER_ROUTE_PATH, "/internal/verification");
});

test("verification: getVerificationCenterForOrganization returns sanitized documents", async () => {
  const db: VerificationDb = {
    gmailScanItem: {
      findMany: async () => [
        {
          id: "row1",
          createdAt: new Date("2026-03-01T10:00:00.000Z"),
          amount: 1180,
          supplierName: "Acme Supplies",
          documentType: "invoice",
          reviewStatus: "auto_saved",
          parsedFieldsJson: fixtureParsedFields,
          gmailMessageId: "msg1234567890",
        },
      ],
    },
  } as unknown as VerificationDb;

  const response = await getVerificationCenterForOrganization(db, "org-1", parseVerificationQuery({ limit: "10" }));
  assert.equal(response.version, VERIFICATION_CENTER_VERSION);
  assert.equal(response.documents.length, 1);
  assert.equal(response.documents[0]?.outcomeStatus, "SAVED");
  assert.equal(response.totalReturned, 1);
});

test("verification: outcome filter excludes non-matching documents", async () => {
  const db: VerificationDb = {
    gmailScanItem: {
      findMany: async () => [
        {
          id: "row1",
          createdAt: new Date("2026-03-01T10:00:00.000Z"),
          amount: 1180,
          supplierName: "Acme Supplies",
          documentType: "invoice",
          reviewStatus: "auto_saved",
          parsedFieldsJson: fixtureParsedFields,
          gmailMessageId: "msg1234567890",
        },
      ],
    },
  } as unknown as VerificationDb;

  const response = await getVerificationCenterForOrganization(
    db,
    "org-1",
    parseVerificationQuery({ outcome: "DUPLICATE", limit: "10" })
  );
  assert.equal(response.documents.length, 0);
});
