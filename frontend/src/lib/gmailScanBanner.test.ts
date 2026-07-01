import test from "node:test";
import assert from "node:assert/strict";

import {
  buildScanBannerState,
  formatScanBannerText,
  resolveDashboardGmailScanRunning,
} from "./gmailScanBanner.js";

test("completed scan with zero saved documents is not treated as running", () => {
  const progress = {
    status: "completed",
    inProgress: false,
    finishedAt: "2026-06-25T12:00:00.000Z",
    emailsFetched: 0,
    emailsSaved: 0,
    documentsFound: 0,
    invoicesFound: 0,
    supplierPaymentsFound: 0,
  };

  const banner = buildScanBannerState(progress, null);
  assert.equal(banner?.status, "success");
  assert.equal(banner?.found, 0);
  assert.equal(
    resolveDashboardGmailScanRunning({
      syncing: false,
      activeScanId: "scan-1",
      activeScan: progress,
      scanBanner: banner,
      scanLogs: [
        {
          id: "scan-1",
          status: "completed",
          found: 0,
          saved: 0,
          endedAt: "2026-06-25T12:00:00.000Z",
          errors: null,
        },
      ],
    }),
    false
  );
});

test("scan banner clears running state when last sync log is terminal with zero saved", () => {
  const banner = buildScanBannerState(null, {
    last: {
      id: "scan-zero",
      status: "completed",
      found: 0,
      saved: 0,
      invoicesFound: 0,
      paymentsFound: 0,
      errors: null,
      endedAt: "2026-06-25T12:00:00.000Z",
    },
  });

  assert.equal(banner?.status, "success");
  assert.equal(banner?.scanned, 0);
  assert.equal(
    resolveDashboardGmailScanRunning({
      syncing: false,
      activeScanId: null,
      activeScan: null,
      scanBanner: banner,
    }),
    false
  );
});

test("active queued scan without terminal log still shows running", () => {
  const progress = {
    status: "running",
    inProgress: true,
    finishedAt: null,
    emailsFetched: 0,
  };
  const banner = buildScanBannerState(progress, null);
  assert.equal(banner?.status, "running");
  assert.equal(
    resolveDashboardGmailScanRunning({
      syncing: false,
      activeScanId: "scan-active",
      activeScan: progress,
      scanBanner: banner,
    }),
    true
  );
});

test("stale activeScanId clears when scan log already completed", () => {
  assert.equal(
    resolveDashboardGmailScanRunning({
      syncing: false,
      activeScanId: "scan-done",
      activeScan: null,
      scanBanner: { status: "running", found: 0, scanned: 0, errors: 0 },
      scanLogs: [
        {
          id: "scan-done",
          status: "completed",
          found: 0,
          saved: 0,
          endedAt: "2026-06-25T12:00:00.000Z",
          errors: null,
        },
      ],
    }),
    false
  );
});

test("paused scan clears running state and shows paused banner", () => {
  const banner = buildScanBannerState(null, {
    last: {
      id: "scan-paused",
      status: "paused",
      found: 120,
      saved: 2,
      invoicesFound: 2,
      paymentsFound: 0,
      errors: null,
      windowTruncated: true,
      totalMatched: 500,
      endedAt: "2026-06-30T15:53:11.000Z",
    },
  });

  assert.equal(banner?.status, "paused");
  assert.equal(banner?.scanned, 120);
  assert.equal(banner?.totalMatched, 500);
  assert.equal(
    resolveDashboardGmailScanRunning({
      syncing: false,
      activeScanId: "scan-paused",
      activeScan: null,
      scanBanner: banner,
      scanLogs: [
        {
          id: "scan-paused",
          status: "paused",
          found: 120,
          saved: 2,
          endedAt: "2026-06-30T15:53:11.000Z",
          errors: null,
          windowTruncated: true,
          totalMatched: 500,
        },
      ],
    }),
    false
  );
});

test("read-side deadline close for manual scan shows paused not stale", () => {
  const banner = buildScanBannerState(null, {
    last: {
      id: "cmr0v9kiv00adjs2bnhi72qq5",
      status: "paused",
      found: 342,
      saved: 2,
      invoicesFound: 2,
      paymentsFound: 0,
      errors: null,
      windowTruncated: true,
      totalMatched: 500,
      endedAt: "2026-06-30T17:04:32.271Z",
    },
  });

  assert.equal(banner?.status, "paused");
  assert.notEqual(banner?.status, "stale");
  assert.equal(
    resolveDashboardGmailScanRunning({
      syncing: false,
      activeScanId: "cmr0v9kiv00adjs2bnhi72qq5",
      activeScan: null,
      scanBanner: banner,
      scanLogs: [
        {
          id: "cmr0v9kiv00adjs2bnhi72qq5",
          status: "paused",
          found: 342,
          saved: 2,
          endedAt: "2026-06-30T17:04:32.271Z",
          errors: null,
          windowTruncated: true,
          totalMatched: 500,
        },
      ],
    }),
    false
  );
});

test("buildScanBannerState does not inflate found from pending review queue size", () => {
  const banner = buildScanBannerState(null, {
    last: {
      id: "scan-zero",
      status: "completed",
      found: 4,
      saved: 0,
      invoicesFound: 0,
      paymentsFound: 0,
      errors: null,
      endedAt: "2026-07-01T08:00:00.000Z",
    },
  });

  assert.equal(banner?.found, 0);
  assert.equal(banner?.scanned, 4);
});

test("scan banner copy distinguishes emails processed from documents found", () => {
  const running = formatScanBannerText("running", 2, 5, null, 0);
  assert.match(running, /5 מיילים/);
  assert.match(running, /2 מסמכים/);
  assert.doesNotMatch(running, /5 מסמכים/);

  const success = formatScanBannerText("success", 1, 3, null, 0);
  assert.match(success, /3 מיילים/);
  assert.match(success, /1 מסמכים/);

  const empty = formatScanBannerText("success", 0, 5, null, 0);
  assert.match(empty, /5 מיילים/);
  assert.match(empty, /לא מצאתי מסמכים חדשים/);
});

test("truncated scan banner reports emails and documents separately", () => {
  const text = formatScanBannerText("truncated", 2, 120, 500, 0);
  assert.match(text, /120 מתוך 500 מיילים/);
  assert.match(text, /2 מסמכים/);
  assert.doesNotMatch(text, /נסרקו 2/);
});
