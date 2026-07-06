import test from "node:test";
import assert from "node:assert/strict";

import {
  approvalErrorHebrew,
  documentReviewAmountLabel,
  drivePreviewUrl,
  formatReviewQueueHeadline,
  getReviewMissingFields,
  getReviewPrimaryAction,
  presentDocument,
  specificReviewReasonHebrew,
  type DocumentReviewItem,
} from "./presentation.js";

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

test("presentDocument shows ready-to-approve when supplier and amount exist despite source_conflict", () => {
  const view = presentDocument({
    ...baseItem,
    displayAmount: 993.33,
    amountLabel: "₪993.33",
    amountResolved: false,
  });
  assert.equal(view.primaryLabel, "אשר והעבר לחשבוניות");
  assert.equal(view.canApprove, true);
  assert.equal(view.typeLabel, "מוכן לאישור");
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
  assert.equal(view.primaryLabel, "השלם פרטים");
  assert.ok(view.missingFields.some((field) => field.id === "amount"));
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

// --- specific Hebrew review reasons (H fix) ---

test("specificReviewReasonHebrew maps technical reason codes to specific Hebrew", () => {
  const cases: Array<[string, string]> = [
    ["trust.gates_missing", "בדיקות האמון של המסמך לא הושלמו"],
    ["confidence below 80% (70%)", "רמת הביטחון בזיהוי המסמך נמוכה מדי"],
    ["supplier.sir_missing", "לא זוהה ספק בצורה מספיק בטוחה"],
    ["supplier.sir_weak_evidence", "הספק זוהה, אבל הראיות לזיהוי חלשות"],
    ["amount.unresolved", "לא זוהה סכום לתשלום"],
    ["amount.vat_mismatch", "יש אי־התאמה בסכום או במע״מ"],
    ["amount.arc_ambiguous", "נמצאו כמה סכומים אפשריים במסמך"],
    ["duplicate.semantic_unsure", "יש חשד שהמסמך כבר קיים"],
    ["possible duplicate: same supplier and amount", "יש חשד שהמסמך כבר קיים"],
    ["invoice number missing", "חסר מספר חשבונית"],
    ["invoice date missing or invalid", "חסר תאריך מסמך"],
    ["fingerprint.weak_tier", "חסרים פרטים מזהים במסמך (מספר חשבונית או תאריך)"],
  ];
  for (const [code, expected] of cases) {
    assert.equal(
      specificReviewReasonHebrew({ uncertaintyReason: code, reviewStatus: "needs_review" }),
      expected,
      `code: ${code}`
    );
  }
});

test("specificReviewReasonHebrew keeps free Hebrew text as-is", () => {
  assert.equal(
    specificReviewReasonHebrew({
      uncertaintyReason: "חסרים פרטי ספק, סכום או מספר חשבונית",
      reviewStatus: "needs_review",
    }),
    "חסרים פרטי ספק, סכום או מספר חשבונית"
  );
});

test("approved review does not surface old uncertainty reason as an active problem", () => {
  assert.equal(
    specificReviewReasonHebrew({ uncertaintyReason: "supplier.sir_missing", reviewStatus: "approved" }),
    null
  );
  const view = presentDocument({
    ...baseItem,
    uncertaintyReason: "supplier.sir_missing",
    reviewStatus: "approved",
  });
  assert.doesNotMatch(view.reason, /לא זוהה ספק/);
  assert.equal(view.reason, "כבר טיפלתי במסמך הזה.");
});

test("review with supplier amount and image shows approve action", () => {
  const action = getReviewPrimaryAction({
    ...baseItem,
    totalAmount: 500,
    displayAmount: 500,
    amountLabel: "₪500.00",
    driveFileUrl: "https://drive.google.com/file/d/abc/view",
    uncertaintyReason: "invoice number missing",
  });
  assert.equal(action.primaryLabel, "אשר והעבר לחשבוניות");
  assert.equal(action.canApprove, true);

  const view = presentDocument({
    ...baseItem,
    totalAmount: 500,
    displayAmount: 500,
    amountLabel: "₪500.00",
    driveFileUrl: "https://drive.google.com/file/d/abc/view",
    uncertaintyReason: "invoice number missing",
  });
  assert.equal(view.primaryLabel, "אשר והעבר לחשבוניות");
  assert.ok(view.advisoryFields.some((field) => field.id === "invoice_number"));
});

test("review missing amount shows חסר סכום and השלם פרטים", () => {
  const { blocking } = getReviewMissingFields({
    ...baseItem,
    amountLabel: "סכום חסר",
    displayAmount: null,
    totalAmount: null,
  });
  assert.ok(blocking.some((field) => field.labelHebrew === "חסר סכום"));

  const action = getReviewPrimaryAction({
    ...baseItem,
    amountLabel: "סכום חסר",
    displayAmount: null,
    totalAmount: null,
  });
  assert.equal(action.primaryLabel, "השלם פרטים");
  assert.equal(action.canApprove, false);
});

test("invoice number missing does not block approval when supplier and amount exist", () => {
  const view = presentDocument({
    ...baseItem,
    totalAmount: 993.33,
    displayAmount: 993.33,
    amountLabel: "₪993.33",
    uncertaintyReason: "invoice number missing",
  });
  assert.equal(view.canApprove, true);
  assert.doesNotMatch(view.primaryLabel, /השלם/);
  assert.match(view.advisoryFields[0]?.labelHebrew ?? "", /מספר מסמך חסר/);
});

test("specificReviewReasonHebrew falls back to gate reason codes from parsedFieldsJson", () => {
  assert.equal(
    specificReviewReasonHebrew({
      uncertaintyReason: null,
      reviewStatus: "needs_review",
      parsedFieldsJson: {
        gates: [
          { gate: "amount", verdict: "pass", reasonCode: "amount.resolved" },
          { gate: "supplier", verdict: "review", reasonCode: "supplier.sir_weak_evidence" },
        ],
      },
    }),
    "הספק זוהה, אבל הראיות לזיהוי חלשות"
  );
});

test("approvalErrorHebrew translates backend 422 messages to specific Hebrew", () => {
  assert.equal(
    approvalErrorHebrew("לא ניתן לאשר מסמך — בדיקת אמון נכשלה (supplier.sir_missing)"),
    "אי אפשר לאשר את המסמך — לא זוהה ספק בצורה מספיק בטוחה"
  );
  assert.equal(
    approvalErrorHebrew("לא ניתן לאשר מסמך — יצירת תשלום נחסמה (duplicate.confirmed_match)"),
    "אי אפשר לאשר את המסמך — יש חשד שהמסמך כבר קיים"
  );
  assert.equal(
    approvalErrorHebrew("Cannot approve document without a verified total amount"),
    "אי אפשר לאשר כי הסכום לא זוהה בצורה בטוחה"
  );
  assert.equal(
    approvalErrorHebrew("Cannot approve document without a verified supplier name"),
    "אי אפשר לאשר כי הספק לא זוהה"
  );
  // הודעה לא מוכרת נשארת כמו שהיא — לא מוחלפת בגנרי
  assert.equal(approvalErrorHebrew("שגיאה אחרת"), "שגיאה אחרת");
});
