const exactReasonLabels: Record<string, string> = {
  "supplier name missing or invalid": "שם ספק חסר או לא תקין",
  "invoice number missing": "מספר חשבונית חסר",
  "amount missing or invalid": "סכום חסר או לא תקין",
  amount_unresolved: "סכום חסר",
  "amount.unresolved": "סכום חסר",
  "amount.zero": "סכום חסר",
  "amount.invalid": "סכום חסר",
  "amount.negative": "סכום שלילי דורש בדיקה",
  "amount.arc_missing": "סכום חסר",
  "amount.arc_ambiguous": "דורש בדיקה",
  "amount.arc_rejected": "דורש בדיקה",
  "amount.decimal_shift": "דורש בדיקה — חשד להזזת נקודה עשרונית",
  "amount.source_conflict": "דורש בדיקה — סכומים סותרים",
  "amount.vat_mismatch": "דורש בדיקה — אי התאמה במע״מ",
  "amount.weird_decimals": "דורש בדיקה",
  "amount.threshold_exceeded": "הסכום גבוה ודורש בדיקה",
  "amount.fse_impossible": "דורש בדיקה — סכום לא סביר",
  "supplier.sir_missing": "ספק חסר",
  "supplier.sir_ambiguous": "זיהוי הספק לא ודאי",
  "supplier.sir_rejected": "המערכת זיהתה שזה לא ספק",
  "supplier.sir_weak_evidence": "זיהוי הספק חלש",
  "supplier.generic_single_word": "שם הספק כללי מדי — דרוש אישור",
  "supplier.not_supplier": "זה לא נראה כמו ספק",
  "supplier.placeholder_hebrew": "ספק לא מזוהה",
  "supplier.placeholder_en": "ספק לא מזוהה",
  "supplier.email_or_domain": "הספק נראה כמו אימייל או דומיין",
  "supplier.phone_or_address": "הספק נראה כמו כתובת או טלפון",
  "supplier.ocr_artifact": "שם הספק לא נקרא בבירור",
  "fingerprint.null": "חסר זיהוי מסמך",
  "fingerprint.empty": "חסר זיהוי מסמך",
  "fingerprint.weak_tier": "זיהוי המסמך לא מספיק חזק",
  "fingerprint.none_tier": "לא ניתן לזהות את המסמך בוודאות",
  "fingerprint.legacy_only": "זיהוי מסמך ישן ולא ודאי",
  "fingerprint.missing_tier_fields": "חסרים פרטים לזיהוי החשבונית",
  "fingerprint.file_hash_missing": "חסרים פרטים לזיהוי החשבונית",
  "fingerprint.identity_changed": "פרטי החשבונית השתנו בסריקה חוזרת",
  "fingerprint.force_reprocess": "סריקה חוזרת דורשת בדיקה",
  "fingerprint.confirmed_duplicate": "נמצאה כפילות ודאית",
  "trust.gates_missing": "דורש בדיקה — שערי אמון חסרים",
  "trust.amount_gate_missing": "דורש בדיקה — בדיקת סכום חסרה",
  "trust.supplier_gate_missing": "דורש בדיקה — בדיקת ספק חסרה",
  "trust.fingerprint_gate_missing": "דורש בדיקה — זיהוי מסמך חסר",
  "trust.duplicate_gate_missing": "דורש בדיקה — בדיקת כפילות חסרה",
  "trust.gate_failed": "דורש בדיקה",
  "duplicate.confirmed_match": "נמצאה חשבונית כפולה",
  "duplicate.file_hash_match": "קובץ זה כבר נסרק",
  "duplicate.invoice_amount_match": "חשבונית עם אותו מספר וסכום כבר קיימת",
  "duplicate.semantic_unsure": "ייתכן שמדובר בחשבונית שכבר קיימת",
  "duplicate.email_attachment_match": "קובץ מצורף זה כבר עובד",
  "duplicate.key_mismatch": "זיהוי הכפילות השתנה",
  "duplicate.rescan_identity_changed": "פרטי החשבונית השתנו בסריקה חוזרת",
  "duplicate.rescan_amount_recovered": "סכום חדש זוהה בסריקה חוזרת",
  "duplicate.force_reprocess": "סריקה חוזרת דורשת בדיקה",
  "duplicate.cross_channel_unsure": "ייתכן שמסמך זה הגיע מערוץ אחר",
  "duplicate.none": "ללא כפילות",
  "amount.fse_historical_anomaly": "דורש בדיקה — סכום חריג לספק",
  "amount exceeds review threshold": "הסכום גבוה ודורש בדיקה",
  "invoice date missing or invalid": "תאריך חשבונית חסר או לא תקין",
  "needs review requested by classifier": "המסווג ביקש בדיקה ידנית",
  "no invoice or supplier payment was created": "לא נוצרה חשבונית או תשלום ספק",
  "no valid amount": "לא נמצא סכום תקין",
  "no strict invoice/payment evidence": "לא נמצאה הוכחה ברורה לחשבונית או תשלום",
  "no strong invoice evidence": "לא נמצאה הוכחה חזקה לחשבונית",
  "no explicit payment request evidence": "לא נמצאה בקשת תשלום מפורשת",
  "payment request without attachment": "בקשת תשלום ללא קובץ מצורף",
  "חסרים פרטי ספק, סכום או מספר חשבונית": "חסרים פרטי ספק, סכום או מספר חשבונית",
};

const junkFilterReasonLabels: Record<string, string> = {
  blocklisted_financial_or_government_sender: "שולח פיננסי או ממשלתי דורש בדיקה",
  technical_platform_system_notification: "התראת מערכת מפלטפורמה טכנית",
  technical_platform_no_business_document: "פלטפורמה טכנית ללא מסמך עסקי",
  customer_action_signal: "זוהתה בקשת פעולה מלקוח",
  business_document_signal: "זוהה סימן למסמך עסקי",
  no_reply_system_alert: "התראת מערכת מכתובת ללא מענה",
  pure_marketing_newsletter: "ניוזלטר או תוכן שיווקי",
  automated_sender_without_business_document: "שולח אוטומטי ללא מסמך עסקי ברור",
  unknown_sender_with_attachment: "שולח לא מוכר עם קובץ מצורף",
  insufficient_signal: "אין מספיק סימנים לזיהוי בטוח",
};

const classifierReasonLabels: Record<string, string> = {
  blocklisted_not_supplier_or_customer: "המסמך משולח חסום ואינו מזוהה כספק או לקוח",
  incoming_without_customer_identity: "מסמך נכנס ללא זיהוי לקוח",
  business_issued_customer_document: "מסמך לקוח שהעסק הנפיק",
  outgoing_supplier_reality_unsure: "לא ברור אם מדובר בספק אמיתי",
  external_document_issued_to_business: "מסמך חיצוני שהונפק לעסק",
  external_supplier_document: "מסמך ספק חיצוני",
  money_direction_unsure: "לא ברור אם הכסף נכנס או יוצא",
};

const evidenceLabels: Record<string, string> = {
  "amount found": "סכום אותר",
  "supplier detected": "ספק זוהה",
  "PDF invoice detected": "זוהתה חשבונית PDF",
  "image invoice detected": "זוהתה חשבונית מתמונה",
  "municipal collection document detected": "זוהה מסמך גבייה עירוני",
  "supplier payment request detected": "זוהתה דרישת תשלום מספק",
  "keyword matched: receipt": "מילת מפתח זוהתה: קבלה",
  "keyword matched: payment request": "מילת מפתח זוהתה: דרישת תשלום",
};

export function reviewReasonLabel(reason: string | null | undefined) {
  const raw = reason?.trim();
  if (!raw) return "רמת ודאות נמוכה";

  const exact = exactReasonLabels[raw];
  if (exact) return exact;

  const confidence = raw.match(/^confidence below 80% \((\d+)%\)$/i);
  if (confidence) return `רמת ודאות נמוכה: ${confidence[1]}%`;

  if (raw.startsWith("junk_filter:")) {
    return `סינון רעש: ${labelCode(raw.slice("junk_filter:".length), junkFilterReasonLabels)}`;
  }

  if (raw.startsWith("classifier:")) {
    return `סיווג דורש בדיקה: ${labelCode(raw.slice("classifier:".length), classifierReasonLabels)}`;
  }

  if (raw.startsWith("possible duplicate:")) {
    return `חשד לכפילות: ${translateFragments(raw.slice("possible duplicate:".length).trim())}`;
  }

  if (raw.startsWith("process_save_failed:")) {
    const detail = raw.slice("process_save_failed:".length).trim();
    return detail ? `שמירת המסמך נכשלה: ${detail}` : "שמירת המסמך נכשלה";
  }

  if (raw.startsWith("Held for review:")) {
    return `נדרש אישור ידני: ${translateFragments(raw.slice("Held for review:".length).trim())}`;
  }

  if (raw.startsWith("Auto-saved:")) {
    return `נשמר אוטומטית: ${translateFragments(raw.slice("Auto-saved:".length).trim())}`;
  }

  return translateFragments(raw);
}

function labelCode(code: string, labels: Record<string, string>) {
  const trimmed = code.trim();
  return labels[trimmed] ?? trimmed;
}

function translateFragments(value: string) {
  const translated = value
    .split(/\s*(?:\/|;|,)\s*/)
    .filter(Boolean)
    .map(translateFragment);
  return translated.length ? translated.join(" · ") : value;
}

function translateFragment(fragment: string) {
  const exact = exactReasonLabels[fragment] ?? evidenceLabels[fragment];
  if (exact) return exact;

  const confidence = fragment.match(/^confidence (?:is )?([a-z]+)$/i);
  if (confidence) return `רמת ודאות: ${confidence[1]}`;

  const confidencePercent = fragment.match(/^confidence=(\d+)%$/i);
  if (confidencePercent) return `רמת ודאות ${confidencePercent[1]}%`;

  const lowConfidence = fragment.match(/^confidence below 80% \((\d+)%\)$/i);
  if (lowConfidence) return `רמת ודאות נמוכה: ${lowConfidence[1]}%`;

  if (fragment.startsWith("keyword matched:")) {
    return `מילת מפתח זוהתה: ${fragment.slice("keyword matched:".length).trim()}`;
  }

  if (fragment.startsWith("documentType is ")) {
    return `סוג מסמך לא נתמך: ${fragment.slice("documentType is ".length).trim()}`;
  }

  if (fragment.startsWith("blocked non-invoice message:")) {
    return `הודעה שאינה חשבונית נחסמה: ${fragment.slice("blocked non-invoice message:".length).trim()}`;
  }

  if (fragment.startsWith("personal email without invoice evidence:")) {
    return `מייל אישי ללא הוכחת חשבונית: ${fragment.slice("personal email without invoice evidence:".length).trim()}`;
  }

  if (fragment.startsWith("ai:")) {
    return `זיהוי AI: ${fragment.slice("ai:".length)}`;
  }

  return fragment;
}
