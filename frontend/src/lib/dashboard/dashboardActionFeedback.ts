/** Tone for dashboard MessageStack action lines (never paint failures as success). */
export type DashboardActionTone = "success" | "danger";

const FAILURE_PATTERN =
  /נכשל|שגיאה|תקלה|לא הצלח|לא ניתן|חסר|אסור|error|failed|fail/i;

export function resolveActionMessageTone(message: string): DashboardActionTone {
  const trimmed = message.trim();
  if (!trimmed) return "success";
  if (FAILURE_PATTERN.test(trimmed)) return "danger";
  return "success";
}

/** True when free-text should start (or focus) a Gmail mail scan. */
export function conversationRequestsGmailScan(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /סרוק|סרק|סריק/.test(trimmed);
}

/** True when free-text asks to view scan progress. */
export function conversationRequestsScanProgress(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /התקדמות|מה\s*מצב\s*הסריק|סטטוס\s*סריק/.test(trimmed);
}
