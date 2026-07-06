import test from "node:test";
import assert from "node:assert/strict";

import { documentReviewAmountLabel, drivePreviewUrl, formatReviewQueueHeadline, presentDocument, type DocumentReviewItem } from "./presentation.js";

const baseItem: DocumentReviewItem = {
  id: "review-1",
  source: "gmail",
  sender: "billing@example.com",
  subject: "Invoice",
  fileName: "invoice.pdf",
  documentType: "tax_invoice",
  supplierName: "אור אלישיב, עו\"ד",
  totalAmount: null,
  currency: "ILS",
  confidenceScore: 0.8,
  uncertaintyReason: "amount.source_conflict",
  driveFileUrl: null,
  reviewStatus: "needs_review",
  createdAt: "2026-07-01T07:36:24.090Z",
};

test("presentDocument uses API amountLabel for conflict row", () => {
  const view = presentDocument({
    ...baseItem,
    displayAmount: 993.33,
    amountLabel: "₪993.33",
    amountResolved: false,
  });
  assert.equal(view.amountLabel, "₪993.33");
});

test("presentDocument keeps needs_review status semantics via uncertainty reason", () => {
  const view = presentDocument({
    ...baseItem,
    displayAmount: 993.33,
    amountLabel: "₪993.33",
    amountResolved: false,
  });
  assert.equal(baseItem.reviewStatus, "needs_review");
  assert.match(view.reason, /אור אלישיב|בדיקה|סכום|ספק/i);
});

test("presentDocument shows סכום חסר when API sends missing label", () => {
  const view = presentDocument({
    ...baseItem,
    supplierName: "לא זוהה",
    uncertaintyReason: "amount.arc_missing",
    amountLabel: "סכום חסר",
    displayAmount: null,
    amountResolved: false,
  });
  assert.equal(view.amountLabel, "סכום חסר");
});

test("documentReviewAmountLabel prefers API amountLabel", () => {
  assert.equal(
    documentReviewAmountLabel({
      ...baseItem,
      totalAmount: null,
      amountLabel: "₪993.33",
    }),
    "₪993.33"
  );
});

test("formatReviewQueueHeadline shows visible slice separate from scan results", () => {
  assert.equal(formatReviewQueueHeadline(5, 144), "מציג 5 מתוך 144 מסמכים שמחכים להחלטה שלך");
  assert.equal(formatReviewQueueHeadline(3, 3), "3 מסמכים מחכים להחלטה שלך");
  assert.equal(formatReviewQueueHeadline(1, 1), "מסמך אחד מחכה להחלטה שלך");
});

test("review queue headline does not use scan language", () => {
  const headline = formatReviewQueueHeadline(5, 144);
  assert.doesNotMatch(headline, /נסרק|סריקה/i);
});

test("drivePreviewUrl resolves local upload paths through API base", () => {
  assert.equal(
    drivePreviewUrl("/uploads/whatsapp-invoices/1_invoice.jpg", "https://api.example.com"),
    "https://api.example.com/uploads/whatsapp-invoices/1_invoice.jpg",
  );
  assert.equal(
    drivePreviewUrl("https://drive.google.com/file/d/abc123/view", "https://api.example.com"),
    "https://drive.google.com/file/d/abc123/preview",
  );
});
