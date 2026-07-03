/**
 * מדיניות סטטוסי ביקורת — מקור אמת אחד (שלב 6: "החשבונית הנעלמת").
 *
 * העיקרון: כל רשומה מופיעה בדיוק במקום אחד ב-UI, תמיד. אפס "לא מופיע בכלל".
 *
 * טבלת המדיניות:
 * | סטטוס (איפה נכתב)                  | טאב ב-UI                                  |
 * |------------------------------------|--------------------------------------------|
 * | auto_saved   (GmailScanItem)       | "מאושר" — המערכת אישרה אוטומטית            |
 * | approved     (GSI + FDR)           | "מאושר"                                    |
 * | needs_review (GSI + FDR)           | "דורש בדיקה"                               |
 * | rejected     (FDR)                 | "נדחה"                                     |
 * | duplicate    (FDR)                 | מראה של תשלום קיים — מיוצג ע"י התשלום      |
 * | סטטוס לא מוכר                      | "דורש בדיקה" (ברירת מחדל שמרנית — לא נעלם) |
 */

export type ReviewTab = "approved" | "needs_review" | "rejected";

/** סטטוסים שנכתבים בפועל ע"י הצינור (מתועדים במפת הצינור, שלב 0). */
export const GMAIL_SCAN_ITEM_STATUSES = ["auto_saved", "approved", "needs_review"] as const;
export const DOCUMENT_REVIEW_STATUSES = ["approved", "needs_review", "rejected", "duplicate"] as const;

/**
 * לאיזה טאב שייך סטטוס. "mirror_of_payment" מוחזר רק ל-duplicate של FDR —
 * הרשומה מייצגת תשלום קיים שכבר מוצג ברשימת התשלומים (הצגה כפולה = כפילות ויזואלית).
 */
export function reviewTabForStatus(status: string | null | undefined): ReviewTab | "mirror_of_payment" {
  const normalized = (status ?? "").trim().toLowerCase();
  if (normalized === "auto_saved" || normalized === "approved") return "approved";
  if (normalized === "rejected") return "rejected";
  if (normalized === "duplicate") return "mirror_of_payment";
  // needs_review וכל סטטוס לא מוכר: לעולם לא נעלמים — תמיד לטאב הבדיקה.
  return "needs_review";
}

/**
 * הסטטוסים שנטענים מה-DB עבור טאב נתון (פילטר ה-WHERE של הרשימות).
 * auto_saved נכלל בטאב "מאושר" — זה מה שהמשתמש מצפה לראות.
 */
export function reviewCandidateStatusesForTab(
  tab: "needs_review" | "rejected" | "approved" | undefined
): string[] | undefined {
  if (tab === "needs_review") return ["needs_review"];
  if (tab === "rejected") return ["rejected"];
  if (tab === "approved") return ["approved", "auto_saved"];
  if (!tab) return ["needs_review", "rejected", "approved", "auto_saved"];
  return undefined;
}

/**
 * סטטוס לתצוגה: auto_saved מוצג למשתמש כ"מאושר" (approved) — בלי טאב חדש
 * ובלי מונח חדש. הערך הגולמי נשאר ב-DB; זו שכבת הצגה בלבד.
 */
export function presentedReviewStatus(status: string | null | undefined): string {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized === "auto_saved" ? "approved" : normalized || "needs_review";
}
