export type LabelDomain = "reviewStatus" | "documentType" | "paymentStatus" | "scanStatus" | "duplicateReason";

const labels: Record<LabelDomain, Record<string, string>> = {
  reviewStatus: {
    approved: "מאושר",
    auto_saved: "נשמר אוטומטית",
    needs_review: "דורש בדיקה",
    failed: "נכשל",
    rejected: "נדחה",
  },
  documentType: {
    invoice: "חשבונית מס",
    tax_invoice: "חשבונית מס",
    receipt: "קבלה",
    tax_invoice_receipt: "חשבונית מס קבלה",
    payment_request: "דרישת תשלום",
    supplier_message: "Supplier Document",
    unknown_needs_review: "Other",
    quote: "הצעת מחיר",
    irrelevant: "מסמך לא רלוונטי",
  },
  paymentStatus: {
    paid: "שולם",
    unpaid: "ממתין לתשלום",
    pending: "ממתין לתשלום",
    missing_invoice: "חסרה חשבונית",
    needs_review: "דורש בדיקה",
  },
  scanStatus: {
    draft: "טיוטה",
    sent: "נשלח",
    approved: "אושר",
    rejected: "נדחה",
    pending: "ממתין",
    completed: "הושלם",
    success: "הושלמה",
    partial: "הושלם עם שגיאות",
    running: "רץ",
    error: "שגיאה",
  },
  duplicateReason: {
    quarantined_invalid_required_invoice_fields: "בהסגר - חסרים שדות חובה",
    supplier_amount_invoice_date: "אותו ספק, סכום ותאריך חשבונית",
    supplier_amount_date: "אותו ספק, סכום ותאריך",
    google_drive_existing_file: "קובץ קיים בדרייב",
    legacy_duplicate_hash: "כפילות לפי מזהה ישן",
    gmail_scan_item_exists: "פריט ג׳ימייל כבר נסרק",
    supplier_payment_exists: "תשלום ספק כבר קיים",
  },
};

export function labelFor(domain: LabelDomain, code: string | null | undefined) {
  if (!code) return humanizeMissingCode(domain);
  const [prefix, details] = code.split(":", 2);
  const label = labels[domain][code] ?? labels[domain][prefix];
  if (label) return details ? `${label} - ${details}` : label;
  console.warn(`MISSING LABEL domain=${domain} code=${code}`);
  return humanizeCode(code);
}

function humanizeMissingCode(domain: LabelDomain) {
  if (domain === "duplicateReason") return "זוהתה";
  return "";
}

function humanizeCode(code: string) {
  return code.replace(/_/g, " ");
}
