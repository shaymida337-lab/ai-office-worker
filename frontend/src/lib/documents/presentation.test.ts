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
  readinessBlockReasonHebrew,
  specificReviewReasonHebrew,
  type DocumentReviewItem,
} from "./presentation.js";

function decisionOf(
  overrides: Partial<NonNullable<DocumentReviewItem["decision"]>> = {}
): NonNullable<DocumentReviewItem["decision"]> {
  return {
    canApprove: true,
    primaryAction: "approve",
    blockReason: null,
    displaySupplierName: 'אור אלישיב, עו"ד',
    confirmedSupplierName: null,
    supplierNeedsConfirmation: false,
    duplicate: null,
    ...overrides,
  };
}

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
    decision: decisionOf(),
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
  const cases: Array<[string, string | null]> = [
    ["trust.gates_missing", null],
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
    decision: decisionOf(),
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
    decision: decisionOf(),
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

test("low confidence supplier prevents ready state in presentation", () => {
  const action = getReviewPrimaryAction({
    ...baseItem,
    supplierName: "פרייזון",
    supplierDisplayName: "פז",
    rawSupplierName: "פרייזון",
    supplierConfidence: "low",
    supplierNeedsConfirmation: true,
    supplierUncertain: true,
    totalAmount: 215.14,
    displayAmount: 215.14,
    amountLabel: "₪215.14",
    driveFileUrl: "https://drive.google.com/file/d/abc/view",
    documentType: "receipt",
    decision: decisionOf({ canApprove: false, primaryAction: "edit_supplier", blockReason: "supplier.needs_confirmation", supplierNeedsConfirmation: true, displaySupplierName: "פז" }),
  });
  assert.equal(action.primaryLabel, "ערוך ספק");
  assert.equal(action.canApprove, false);
});

test("Paz receipt displays פז not פרייזון in presentation", () => {
  const view = presentDocument({
    ...baseItem,
    supplierName: "פרייזון",
    supplierDisplayName: "פז",
    rawSupplierName: "פרייזון",
    supplierConfidence: "low",
    supplierNeedsConfirmation: true,
    supplierUncertain: true,
    totalAmount: 215.14,
    displayAmount: 215.14,
    amountLabel: "₪215.14",
    driveFileUrl: "https://drive.google.com/file/d/abc/view",
    documentType: "receipt",
    decision: decisionOf({ canApprove: false, primaryAction: "edit_supplier", supplierNeedsConfirmation: true, displaySupplierName: "פז" }),
  });
  assert.equal(view.supplier, "פז");
  assert.equal(view.rawSupplierName, "פרייזון");
});

test("Electric company review displays חברת החשמל", () => {
  const view = presentDocument({
    ...baseItem,
    supplierName: 'חברת החשמל לישראל בע"מ',
    supplierDisplayName: "חברת החשמל",
    rawSupplierName: 'חברת החשמל לישראל בע"מ',
    supplierConfidence: "high",
    supplierNeedsConfirmation: false,
    supplierUncertain: false,
    totalAmount: 326.32,
    displayAmount: 326.32,
    amountLabel: "₪326.32",
    driveFileUrl: "https://drive.google.com/file/d/iec/view",
    documentType: "invoice",
    decision: decisionOf({ displaySupplierName: "חברת החשמל" }),
  });
  assert.equal(view.supplier, "חברת החשמל");
  assert.equal(view.primaryLabel, "אשר והעבר לחשבוניות");
});

test("trust.gates_missing with supplier amount and image shows approve action", () => {
  const item: DocumentReviewItem = {
    ...baseItem,
    supplierName: "פז",
    supplierDisplayName: "פז",
    supplierConfidence: "high",
    supplierNeedsConfirmation: false,
    totalAmount: 215.14,
    displayAmount: 215.14,
    amountLabel: "₪215.14",
    driveFileUrl: "https://drive.google.com/file/d/abc123/view",
    uncertaintyReason: "trust.gates_missing",
    documentType: "receipt",
    decision: decisionOf({ displaySupplierName: "פז" }),
  };
  const view = presentDocument(item);
  assert.equal(view.primaryLabel, "אשר והעבר לחשבוניות");
  assert.equal(view.canApprove, true);
  assert.equal(view.typeLabel, "מוכן לאישור");
  assert.equal(view.reason, "המסמך מוכן לאישור");
});

test("invoice number missing with full data shows approve not השלם פרטים", () => {
  const view = presentDocument({
    ...baseItem,
    supplierName: "חברת החשמל",
    totalAmount: 326.32,
    displayAmount: 326.32,
    amountLabel: "₪326.32",
    driveFileUrl: "/uploads/whatsapp-invoices/inv.jpg",
    fileName: "inv.jpg",
    uncertaintyReason: "invoice number missing",
    documentType: "tax_invoice",
    decision: decisionOf({ displaySupplierName: "חברת החשמל" }),
  });
  assert.equal(view.primaryLabel, "אשר והעבר לחשבוניות");
  assert.doesNotMatch(view.primaryLabel, /השלם/);
});

test("missing document file shows חסר קובץ מסמך", () => {
  const view = presentDocument({
    ...baseItem,
    supplierName: "Rnet",
    totalAmount: 354,
    displayAmount: 354,
    amountLabel: "₪354.00",
    driveFileUrl: null,
    fileName: null,
    documentType: "invoice",
  });
  assert.equal(view.primaryLabel, "השלם פרטים");
  assert.ok(view.missingFields.some((field) => field.labelHebrew === "חסר קובץ מסמך"));
});

test("Hebrew document type label is accepted as valid type", () => {
  const action = getReviewPrimaryAction({
    ...baseItem,
    totalAmount: 4800,
    displayAmount: 4800,
    amountLabel: "₪4,800.00",
    driveFileUrl: "https://drive.google.com/file/d/x/view",
    documentType: "חשבונית מס",
    decision: decisionOf(),
  });
  assert.equal(action.canApprove, true);
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

// --- server-side readiness contract (H fix: single source of truth) ---

test("server contract: canApprove=true shows approve CTA regardless of local uncertainty text", () => {
  const view = presentDocument({
    ...baseItem,
    uncertaintyReason: "supplier.sir_weak_evidence",
    totalAmount: 500,
    displayAmount: 500,
    amountLabel: "₪500.00",
    decision: decisionOf(),
    supplierNeedsConfirmation: false,
    supplierUncertain: false,
  });
  assert.equal(view.canApprove, true);
  assert.equal(view.primaryLabel, "אשר והעבר לחשבוניות");
  assert.equal(view.typeLabel, "מוכן לאישור");
});

test("server contract: edit_supplier shows ערוך ספק and never the approve CTA", () => {
  const view = presentDocument({
    ...baseItem,
    totalAmount: 500,
    displayAmount: 500,
    amountLabel: "₪500.00",
    decision: decisionOf({ canApprove: false, primaryAction: "edit_supplier", blockReason: "supplier.needs_confirmation", supplierNeedsConfirmation: true }),
  });
  assert.equal(view.canApprove, false);
  assert.equal(view.primaryLabel, "ערוך ספק");
  assert.notEqual(view.primaryLabel, "אשר והעבר לחשבוניות");
});

test("server contract: complete_details shows השלם פרטים with Hebrew block reason", () => {
  const view = presentDocument({
    ...baseItem,
    amountLabel: "סכום חסר",
    displayAmount: null,
    totalAmount: null,
    decision: decisionOf({ canApprove: false, primaryAction: "complete_details", blockReason: "amount.unresolved" }),
    supplierNeedsConfirmation: false,
    supplierUncertain: false,
  });
  assert.equal(view.canApprove, false);
  assert.equal(view.primaryLabel, "השלם פרטים");
  assert.match(view.reason, /לא זוהה סכום לתשלום/);
});

test("server contract guard: approve action with open supplier confirmation falls back to ערוך ספק", () => {
  const view = presentDocument({
    ...baseItem,
    totalAmount: 500,
    displayAmount: 500,
    amountLabel: "₪500.00",
    decision: decisionOf({ supplierNeedsConfirmation: true }),
  });
  assert.equal(view.canApprove, false);
  assert.equal(view.primaryLabel, "ערוך ספק");
});

test("readinessBlockReasonHebrew maps contract reasons to Hebrew", () => {
  assert.equal(
    readinessBlockReasonHebrew({ blockReason: "supplier.needs_confirmation" }),
    "יש לאשר או לערוך את שם הספק לפני האישור"
  );
  assert.equal(
    readinessBlockReasonHebrew({ blockReason: "duplicate.semantic_unsure" }),
    "יש חשד שהמסמך כבר קיים"
  );
  assert.equal(readinessBlockReasonHebrew({ blockReason: null }), null);
  assert.equal(
    readinessBlockReasonHebrew({ blockReason: "totally.unknown_code" }),
    "המסמך דורש בדיקה נוספת לפני אישור"
  );
});

test("no server decision => fail-closed: never approve from local heuristics", () => {
  const view = presentDocument({
    ...baseItem,
    totalAmount: 500,
    displayAmount: 500,
    amountLabel: "₪500.00",
    driveFileUrl: "https://drive.google.com/file/d/abc/view",
    supplierNeedsConfirmation: false,
    supplierUncertain: false,
  });
  assert.equal(view.canApprove, false);
  assert.equal(view.primaryLabel, "השלם פרטים");
});

test("blocked_duplicate explains the exact matched duplicate and hides approve", () => {
  const view = presentDocument({
    ...baseItem,
    supplierName: "חברת החשמל",
    totalAmount: 326.32,
    displayAmount: 326.32,
    amountLabel: "₪326.32",
    driveFileUrl: "https://drive.google.com/file/d/iec/view",
    documentType: "tax_invoice",
    decision: decisionOf({
      canApprove: false,
      primaryAction: "blocked_duplicate",
      blockReason: "duplicate.confirmed_match",
      displaySupplierName: "חברת החשמל",
      duplicate: {
        matchedPaymentId: "payment-iec-1",
        supplier: "חברת החשמל",
        amount: 326.32,
        date: "2026-06-15T00:00:00.000Z",
        paid: false,
      },
    }),
  });
  assert.equal(view.canApprove, false);
  assert.notEqual(view.primaryLabel, "אשר והעבר לחשבוניות");
  assert.equal(view.typeLabel, "חשד לכפילות");
  assert.match(view.reason, /חברת החשמל/);
  assert.match(view.reason, /326.32/);
  assert.equal(view.isDuplicate, true);
});
