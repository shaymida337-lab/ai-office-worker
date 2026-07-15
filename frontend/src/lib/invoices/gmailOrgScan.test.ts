import test from "node:test";
import assert from "node:assert/strict";

import type { ScanProgressResult } from "@/lib/dashboard/homePageTypes";
import {
  formatInvoicesGmailScanDoneMessage,
  isGmailNotConnectedError,
  summarizeOrgGmailScanProgress,
  summarizeOrgGmailScanResult,
  waitForOrgGmailScanProgress,
} from "./gmailOrgScan.js";

test("formatInvoicesGmailScanDoneMessage reports found / saved / needs completion", () => {
  assert.equal(
    formatInvoicesGmailScanDoneMessage({ documentsFound: 4, saved: 3, needsCompletion: 1 }),
    "נמצאו 4 מסמכים · נשמרו 3 · דורשים השלמה 1"
  );
});

test("isGmailNotConnectedError detects Hebrew connect message", () => {
  assert.equal(isGmailNotConnectedError(new Error("יש לחבר חשבון ג׳ימייל לפני הסריקה")), true);
  assert.equal(isGmailNotConnectedError(new Error("network failed")), false);
});

test("summarizeOrgGmailScanProgress prefers invoice counts and review needs", () => {
  const summary = summarizeOrgGmailScanProgress(
    {
      emailsFetched: 20,
      emailsSaved: 5,
      invoicesFound: 4,
      supplierPaymentsFound: 3,
      summary: { needsReviewCount: 2 },
    },
    9
  );
  assert.deepEqual(summary, { documentsFound: 4, saved: 5, needsCompletion: 2 });
});

test("summarizeOrgGmailScanResult falls back to incomplete count", () => {
  const summary = summarizeOrgGmailScanResult({ emailsProcessed: 7, paymentsCreated: 2, invoicesCreated: 1 }, 3);
  assert.deepEqual(summary, { documentsFound: 1, saved: 3, needsCompletion: 3 });
});

test("waitForOrgGmailScanProgress returns when scan becomes terminal", async () => {
  let calls = 0;
  const progress = await waitForOrgGmailScanProgress({
    scanId: "scan-1",
    intervalMs: 1,
    maxAttempts: 5,
    sleep: async () => undefined,
    poll: async () => {
      calls += 1;
      if (calls < 2) {
        return {
          scanId: "scan-1",
          status: "running",
          inProgress: true,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          error: null,
          progressPercent: 40,
          emailsFetched: 2,
          emailsSaved: 1,
          invoicesFound: 1,
          supplierPaymentsFound: 0,
          clientsFound: 0,
          uploadedToDrive: 0,
          rejectedReasons: {},
        } as ScanProgressResult;
      }
      return {
        scanId: "scan-1",
        status: "completed",
        inProgress: false,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        error: null,
        progressPercent: 100,
        emailsFetched: 5,
        emailsSaved: 3,
        invoicesFound: 2,
        supplierPaymentsFound: 2,
        clientsFound: 0,
        uploadedToDrive: 1,
        rejectedReasons: {},
        summary: {
          emailsScanned: 5,
          invoiceOrPaymentEmailsFound: 2,
          recordsSaved: 3,
          paymentsSaved: 2,
          invoicesSaved: 2,
          duplicatesSkipped: 0,
          needsReviewCount: 1,
        },
      } as ScanProgressResult;
    },
  });

  assert.equal(progress.status, "completed");
  assert.equal(calls, 2);
});
