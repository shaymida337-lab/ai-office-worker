import test from "node:test";
import assert from "node:assert/strict";

import { sanitizePrismaWriteData } from "./postgresTextSanitizer.js";

const NUL = "\u0000";

test("prisma write sanitizer handles GmailScanItem upsert-shaped data", () => {
  const create = sanitizePrismaWriteData({
    organizationId: "org-1",
    gmailMessageId: "19f17410cc963aaf",
    subject: "Your receipt from Anthropic, PBC #2619-9469-8575",
    supplierName: "Anthropic PBC",
    documentType: "unknown_needs_review",
    duplicateKey: "20bbe52a32f65d5cd6189cc73761d1d9503aec6458363714",
    decisionReason: "amount.vat_mismatch",
    parsedFieldsJson: {
      gates: [{ gate: "amount", normalizedAmount: 40.01 }],
    },
    rawAnalysis: {
      ocrText: {
        pdfText: `--- PDF ATTACHMENT TEXT ---${NUL}\nTotal $40.01`,
        visualAttachmentText: "",
      },
    },
  });

  assert.equal(create.rawAnalysis.ocrText.pdfText.includes(NUL), false);
  assert.equal(create.parsedFieldsJson.gates[0].normalizedAmount, 40.01);
  assert.equal(create.duplicateKey, "20bbe52a32f65d5cd6189cc73761d1d9503aec6458363714");
});

test("prisma write sanitizer handles createMany arrays", () => {
  const rows = sanitizePrismaWriteData([
    { subject: `one${NUL}` },
    { subject: "two" },
  ]);
  assert.deepEqual(rows, [{ subject: "one" }, { subject: "two" }]);
});
