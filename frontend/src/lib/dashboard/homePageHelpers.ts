import {
  gmailScanStillRunning,
  isFailedGmailScanStatus,
} from "@/lib/gmailScanLifecycle";
import type {
  GmailScanResult,
  GmailScanSummary,
  ScanProgressResult,
  SystemComponentStatus,
} from "./homePageTypes";

export function phaseLabelForScanProgress(progress: ScanProgressResult, preparing: boolean) {
  if (preparing && (progress.progressPercent ?? 0) < 5) {
    return "מתחברת לג׳ימייל ומכינה את הסריקה...";
  }
  const pct = progress.progressPercent ?? 0;
  if (pct < 20) return "סורקת את הג׳ימייל...";
  if (pct < 75) return "מנתחת מסמכים וחשבוניות...";
  if (pct < 100) return "שומרת תוצאות...";
  return "מסיימת את הסריקה...";
}

export function firstNameFromLabel(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

/** Same workspace label as GlobalHeader: businessName, else organization name. */
export function resolveWorkspaceDisplayName(
  settings: { businessName?: string | null; name?: string | null } | null | undefined
): string {
  const business = settings?.businessName?.trim();
  if (business) return business;
  const name = settings?.name?.trim();
  if (name) return name;
  return "העסק שלי";
}

export function scanProgressMessages(progress: ScanProgressResult) {
  const statusMessage = gmailScanStillRunning(progress)
    ? "סורק ומעבד מיילים..."
    : isFailedGmailScanStatus(progress.status)
      ? "הסריקה נכשלה"
      : progress.status === "partial"
        ? `הסריקה הושלמה עם ${progress.summary?.errorsCount ?? progress.finalSummary?.errorsCount ?? 0} שגיאות`
        : "הסריקה הושלמה";

  return [
    statusMessage,
    `התקדמות ${progress.progressPercent ?? 0}%${progress.estimatedRemainingSeconds ? ` · נותרו בערך ${Math.ceil(progress.estimatedRemainingSeconds / 60)} דק׳` : ""}`,
    `נמצאו ${progress.emailsFetched} מיילים`,
    `נשמרו ${progress.emailsSaved} פריטי סריקה`,
  ];
}

export function formatProgressSummary(progress: ScanProgressResult) {
  return appendScanTruncationMessage(
    `נמצאו ${progress.emailsFetched} מיילים · נשמרו ${progress.emailsSaved} · חשבוניות ${progress.invoicesFound} · תשלומי ספקים ${progress.supplierPaymentsFound} · דרייב ${progress.uploadedToDrive} · שיטס ${progress.sheetsUpdated ?? 0}`,
    progress.windowTruncated ?? progress.summary?.windowTruncated,
    progress.emailsFetched
  );
}

export function scanSummaryFromResult(result: GmailScanResult): GmailScanSummary {
  return {
    totalEmailsChecked: result.summary?.totalEmailsChecked ?? result.emailsFound ?? result.emailsProcessed ?? 0,
    emailsScanned: result.summary?.emailsScanned ?? result.emailsFound ?? result.emailsProcessed ?? 0,
    relevantEmailsFound: result.summary?.relevantEmailsFound ?? result.summary?.invoiceOrPaymentEmailsFound ?? result.invoiceEmails ?? 0,
    invoiceOrPaymentEmailsFound: result.summary?.invoiceOrPaymentEmailsFound ?? result.invoiceEmails ?? 0,
    invoicesFound: result.summary?.invoicesFound ?? result.invoicesCreated ?? 0,
    receiptsFound: result.summary?.receiptsFound ?? 0,
    paymentRequestsFound: result.summary?.paymentRequestsFound ?? 0,
    recordsSaved: result.summary?.recordsSaved ?? result.recordsSaved ?? ((result.paymentsCreated ?? 0) + (result.invoicesCreated ?? 0) + (result.tasksCreated ?? 0) + (result.clientsCreated ?? 0)),
    paymentsSaved: result.summary?.paymentsSaved ?? result.paymentsCreated ?? 0,
    invoicesSaved: result.summary?.invoicesSaved ?? result.invoicesCreated ?? 0,
    duplicatesSkipped: result.summary?.duplicatesSkipped ?? result.duplicatesSkipped ?? 0,
    needsReviewCount: result.summary?.needsReviewCount ?? 0,
    errorsCount: result.summary?.errorsCount ?? 0,
    windowTruncated: result.summary?.windowTruncated,
    totalMatched: result.summary?.totalMatched,
  };
}

export function formatPartialScanMessage(progress: ScanProgressResult) {
  const errorsCount = progress.summary?.errorsCount ?? progress.finalSummary?.errorsCount ?? 0;
  return appendScanTruncationMessage(
    `הסריקה הושלמה עם ${errorsCount} שגיאות`,
    progress.windowTruncated ?? progress.summary?.windowTruncated,
    progress.emailsFetched
  );
}

export function formatScanSuccess(summary: GmailScanSummary) {
  return appendScanTruncationMessage(
    `נבדקו ${summary.totalEmailsChecked ?? summary.emailsScanned} מיילים · נמצאו ${summary.relevantEmailsFound ?? summary.invoiceOrPaymentEmailsFound} רלוונטיים · נשמרו ${summary.recordsSaved} רשומות · לבדיקה ${summary.needsReviewCount ?? 0} · שגיאות ${summary.errorsCount ?? 0}`,
    summary.windowTruncated,
    summary.totalEmailsChecked ?? summary.emailsScanned
  );
}

export function appendScanTruncationMessage(message: string, windowTruncated?: boolean, emailsScanned = 0) {
  return windowTruncated ? `${message} · נסרקו ${emailsScanned} הודעות — ייתכן שיש עוד, הרץ סריקה נוספת` : message;
}

export function fallbackComponent(name: SystemComponentStatus["name"], label: string, connected: boolean): SystemComponentStatus {
  return {
    name,
    label,
    connected,
    status: connected ? "PASS" : "FAIL",
    // Disconnected fallbacks must not look like a live health check passed.
    reason: connected ? null : "disconnected",
  };
}

export function systemComponentLabel(label: string) {
  const labels: Record<string, string> = {
    gmail: "ג׳ימייל",
    drive: "גוגל דרייב",
    sheets: "גוגל שיטס",
    whatsapp: "וואטסאפ",
    database: "מסד נתונים",
  };
  return labels[label.toLowerCase()] ?? label;
}

export function systemReasonLabel(reason: string | null) {
  if (!reason) return null;
  const labels: Record<string, string> = {
    connected: "מחובר",
    missing: "חסר חיבור",
    disconnected: "לא מחובר",
    failed: "נכשלה בדיקה",
  };
  return labels[reason] ?? reason.replace(/_/g, " ");
}

export function alertTypeLabel(type: string) {
  const labels: Record<string, string> = { error: "שגיאה", warning: "אזהרה", info: "מידע", review: "לבדיקה" };
  return labels[type] ?? type.replace(/_/g, " ");
}

export function taskPriorityLabel(priority: string) {
  const labels: Record<string, string> = { low: "עדיפות נמוכה", medium: "עדיפות בינונית", high: "עדיפות גבוהה" };
  return labels[priority] ?? priority.replace(/_/g, " ");
}

export function isThisMonth(value: string) {
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

export function isTodayValue(value: string) {
  const date = new Date(value);
  const now = new Date();
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function formatShekel(amount: number) {
  return `₪${Math.round(amount).toLocaleString("he-IL")}`;
}

export function formatMoney(amount: number, currency: string) {
  if (currency === "ILS") return formatShekel(amount);
  return `${currency} ${Math.round(amount).toLocaleString("he-IL")}`;
}

export function formatNumber(value: number) {
  return value.toLocaleString("he-IL");
}

export function formatDate(value: string) {
  return new Date(value).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString("he-IL");
}

export function relativeTime(date: Date) {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דקות`;
  const hours = Math.round(minutes / 60);
  return `לפני ${hours} שעות`;
}

export function formatDurationFromRange(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return null;
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `${seconds} שניות`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (!remainder) return `${minutes} דקות`;
  return `${minutes} דק׳ ${remainder} שנ׳`;
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
