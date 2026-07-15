import type { GmailScanResult, GmailScanSummary, ScanProgressResult } from "@/lib/dashboard/homePageTypes";
import { gmailScanStillRunning, isFailedGmailScanStatus } from "@/lib/gmailScanLifecycle";

export const INVOICES_GMAIL_SCANNING_MESSAGE = "סורק חשבוניות מהמייל...";

export function isGmailNotConnectedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message;
  return (
    message.includes("GMAIL_NOT_CONNECTED") ||
    message.includes("יש לחבר חשבון ג׳ימייל") ||
    message.includes("יש לחבר חשבון ג'ימייל") ||
    message.includes("Gmail not connected")
  );
}

export function formatInvoicesGmailScanDoneMessage(input: {
  documentsFound: number;
  saved: number;
  needsCompletion: number;
}): string {
  return `נמצאו ${input.documentsFound} מסמכים · נשמרו ${input.saved} · דורשים השלמה ${input.needsCompletion}`;
}

export function summarizeOrgGmailScanProgress(
  progress: {
    documentsFound?: number | null;
    emailsFetched?: number | null;
    emailsSaved?: number | null;
    invoicesFound?: number | null;
    supplierPaymentsFound?: number | null;
    summary?: Partial<Pick<GmailScanSummary, "invoicesFound" | "recordsSaved" | "paymentsSaved" | "needsReviewCount">> | null;
  },
  needsCompletionFallback = 0
): { documentsFound: number; saved: number; needsCompletion: number } {
  const documentsFound =
    progress.documentsFound ??
    progress.invoicesFound ??
    progress.summary?.invoicesFound ??
    progress.emailsFetched ??
    0;
  const saved =
    progress.emailsSaved ??
    progress.supplierPaymentsFound ??
    progress.summary?.recordsSaved ??
    progress.summary?.paymentsSaved ??
    0;
  const needsCompletion = progress.summary?.needsReviewCount ?? needsCompletionFallback;
  return { documentsFound, saved, needsCompletion };
}

export function summarizeOrgGmailScanResult(
  result: GmailScanResult,
  needsCompletionFallback = 0
): { documentsFound: number; saved: number; needsCompletion: number } {
  const documentsFound =
    result.summary?.invoicesFound ??
    result.invoicesCreated ??
    result.summary?.invoiceOrPaymentEmailsFound ??
    result.emailsFound ??
    result.emailsProcessed ??
    0;
  const saved =
    result.summary?.recordsSaved ??
    result.recordsSaved ??
    (result.paymentsCreated ?? 0) + (result.invoicesCreated ?? 0);
  const needsCompletion = result.summary?.needsReviewCount ?? needsCompletionFallback;
  return { documentsFound, saved, needsCompletion };
}

export async function waitForOrgGmailScanProgress(input: {
  scanId: string;
  poll: (scanId: string) => Promise<ScanProgressResult>;
  intervalMs: number;
  maxAttempts: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ScanProgressResult> {
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last: ScanProgressResult | null = null;
  for (let attempt = 0; attempt < input.maxAttempts; attempt += 1) {
    last = await input.poll(input.scanId);
    if (!gmailScanStillRunning(last)) {
      if (isFailedGmailScanStatus(last.status)) {
        throw new Error(last.userMessageHe ?? last.error ?? "סריקת Gmail נכשלה");
      }
      return last;
    }
    await sleep(input.intervalMs);
  }
  throw new Error("הסריקה לוקחת יותר מדי זמן — רענן את הרשימה בעוד כמה דקות");
}
