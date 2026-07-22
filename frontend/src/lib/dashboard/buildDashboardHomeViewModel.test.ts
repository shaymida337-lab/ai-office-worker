import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDashboardHomeViewModel,
  type BuildDashboardHomeViewModelInput,
} from "./buildDashboardHomeViewModel.js";
import { emptyStats } from "./homePageConstants.js";

function minimalInput(overrides: Partial<BuildDashboardHomeViewModelInput> = {}): BuildDashboardHomeViewModelInput {
  return {
    pageLoading: false,
    gmailStatus: {
      googleConfigured: true,
      connected: true,
      connectedAt: new Date().toISOString(),
      reconnectRequired: false,
      missingDriveScopes: [],
    },
    gmailStatusKnown: true,
    gmailStatusStale: false,
    scanStatus: {
      logs: [],
      last: {
        id: "scan-1",
        type: "gmail",
        status: "success",
        found: 12,
        saved: 5,
        errors: null,
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        endedAt: new Date().toISOString(),
      },
      nextScheduledScanAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
    scanStatusKnown: true,
    scanStatusStale: false,
    documentReviews: [],
    pendingDocumentReviewsCount: 0,
    activeScan: null,
    activeScanId: null,
    error: "",
    actionMessage: "",
    scanToast: null,
    syncing: false,
    firstScanPhase: null,
    scanProgress: [],
    connectingGmail: false,
    showGmailConnect: false,
    systemHealth: null,
    organizationSettings: { name: "העסק שלי" } as BuildDashboardHomeViewModelInput["organizationSettings"],
    payments: [],
    missingInvoices: [],
    alerts: [],
    upcomingAppointments: [],
    briefingScheduling: null,
    stats: {
      ...emptyStats,
      moneyToReceive: 12_500,
      moneyToPay: 4_200,
      pendingInvoices: 3,
      openTasks: 2,
    },
    recentTasks: [],
    recentInvoices: [],
    whatsAppStats: null,
    firstVisitMode: false,
    ...overrides,
  };
}

test("snapshotMetrics returns 4 KPI items with formatted values", () => {
  const vm = buildDashboardHomeViewModel(minimalInput());

  assert.equal(vm.snapshotMetrics.length, 4);
  assert.deepEqual(
    vm.snapshotMetrics.map((metric) => metric.id),
    ["in", "out", "documents", "tasks"]
  );
  assert.match(vm.snapshotMetrics[0]?.value ?? "", /₪/);
  assert.equal(vm.snapshotMetrics[2]?.value, "3");
  assert.equal(vm.snapshotMetrics[3]?.value, "2");
});

test("snapshotMetrics uses stats only when documentReviews list differs", () => {
  const vm = buildDashboardHomeViewModel(
    minimalInput({
      stats: { ...emptyStats, pendingInvoices: 9, openTasks: 1 },
      pendingDocumentReviewsCount: 1,
      documentReviews: [
        {
          id: "dr-1",
          sender: null,
          documentType: "invoice",
          supplierName: "ספק",
          totalAmount: 100,
          currency: "ILS",
          documentDate: null,
          uncertaintyReason: null,
          reviewStatus: "needs_review",
          createdAt: new Date().toISOString(),
        },
      ],
    })
  );
  assert.equal(vm.snapshotMetrics.find((m) => m.id === "documents")?.value, "9");
});

test("yourDayItems include href for actionable rows", () => {
  const vm = buildDashboardHomeViewModel(
    minimalInput({
      stats: { ...emptyStats, upcomingPaymentsCount: 5, overdueSupplierPayments: 1, openTasks: 4 },
      pendingDocumentReviewsCount: 12,
      documentReviews: [
        {
          id: "dr-1",
          sender: null,
          documentType: "invoice",
          supplierName: "ספק",
          totalAmount: 100,
          currency: "ILS",
          documentDate: null,
          uncertaintyReason: null,
          reviewStatus: "needs_review",
          createdAt: new Date().toISOString(),
        },
      ],
      upcomingAppointments: [
        {
          id: "appt-1",
          startTime: new Date(Date.now() + 3_600_000).toISOString(),
          status: "confirmed",
          client: { name: "דנה" },
        },
      ],
    })
  );

  assert.ok(vm.yourDayItems.length > 0);
  const actionable = vm.yourDayItems.filter((item) => item.href);
  assert.ok(actionable.length > 0);
  assert.ok(actionable.every((item) => typeof item.href === "string" && item.href.startsWith("/")));
  assert.ok(vm.yourDayItems.some((item) => /12|מסמך/.test(item.text)));
});

test("yourDayItems passthrough reflects pending counts from input", () => {
  const vm = buildDashboardHomeViewModel(
    minimalInput({
      stats: { ...emptyStats, upcomingPaymentsCount: 5, overdueSupplierPayments: 1, openTasks: 4 },
      pendingDocumentReviewsCount: 1,
      documentReviews: [
        {
          id: "dr-1",
          sender: null,
          documentType: "invoice",
          supplierName: "ספק",
          totalAmount: 100,
          currency: "ILS",
          documentDate: null,
          uncertaintyReason: null,
          reviewStatus: "needs_review",
          createdAt: new Date().toISOString(),
        },
      ],
      upcomingAppointments: [
        {
          id: "appt-1",
          startTime: new Date(Date.now() + 3_600_000).toISOString(),
          status: "confirmed",
          client: { name: "דנה" },
        },
      ],
    })
  );

  assert.ok(vm.yourDayItems.length > 0);
  assert.match(vm.yourDayItems[0]?.text ?? "", /שעה|דנה/);
});

test("sync state passthrough with mock connected input", () => {
  const vm = buildDashboardHomeViewModel(minimalInput());

  assert.equal(vm.gmailConnection.phase, "connected");
  assert.equal(vm.pageError, "");
  assert.ok(["CONNECTED", "WARNING"].includes(vm.dashboardSyncState.status));
});

test("sync state reflects scan running input", () => {
  const vm = buildDashboardHomeViewModel(
    minimalInput({
      syncing: true,
      activeScanId: "scan-running",
      activeScan: {
        scanId: "scan-running",
        status: "running",
        inProgress: true,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
        emailsFetched: 4,
        emailsSaved: 1,
        invoicesFound: 0,
        supplierPaymentsFound: 0,
        clientsFound: 0,
        uploadedToDrive: 0,
        rejectedReasons: {},
        progressPercent: 12,
      },
      scanProgress: ["סורק ומעבד מיילים..."],
      firstScanPhase: "סורקת את הג׳ימייל...",
    })
  );

  assert.equal(vm.dashboardSyncState.status, "SYNCING");
  assert.equal(vm.scanRunning, true);
});

test("view model keeps greeting stable before client mount", () => {
  const vm = buildDashboardHomeViewModel(
    minimalInput({
      clientMounted: false,
      organizationSettings: { name: "שי" } as BuildDashboardHomeViewModelInput["organizationSettings"],
    })
  );

  assert.equal(vm.morningGreeting.headline, "שלום, שי");
});

test("view model uses businessName for title and personal name for greeting", () => {
  const vm = buildDashboardHomeViewModel(
    minimalInput({
      clientMounted: true,
      firstVisitMode: false,
      organizationSettings: {
        name: "שי",
        businessName: "קדמה",
      } as BuildDashboardHomeViewModelInput["organizationSettings"],
    })
  );

  assert.equal(vm.businessName, "קדמה");
  assert.match(vm.morningGreeting.headline, /ברוך הבא חזרה, שי/);
  assert.doesNotMatch(vm.morningGreeting.headline, /קדמה/);
});

test("view model omits personal name from greeting when settings.name is missing", () => {
  const vm = buildDashboardHomeViewModel(
    minimalInput({
      clientMounted: true,
      firstVisitMode: false,
      organizationSettings: {
        name: "",
        businessName: "קדמה",
      } as BuildDashboardHomeViewModelInput["organizationSettings"],
    })
  );

  assert.equal(vm.businessName, "קדמה");
  assert.match(vm.morningGreeting.headline, /ברוך הבא חזרה/);
  assert.doesNotMatch(vm.morningGreeting.headline, /קדמה/);
  assert.doesNotMatch(vm.morningGreeting.headline, /,/);
});

test("old timeout (stale) last scan does not put the dashboard in ERROR after recovery", () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const vm = buildDashboardHomeViewModel(
    minimalInput({
      scanStatus: {
        logs: [],
        last: {
          id: "cmrbtbxbv02boh32akawol5z2",
          type: "gmail",
          status: "stale",
          found: 0,
          saved: 0,
          errors: "Scan exceeded 30 minute timeout without finishing",
          startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          endedAt: twoHoursAgo,
        },
        nextScheduledScanAt: null,
      },
    })
  );

  assert.equal(vm.dashboardSyncState.scanBanner, null);
  assert.notEqual(vm.dashboardSyncState.status, "ERROR");
});

test("old failed last scan does not trigger ERROR via lastScanStatus fallback", () => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const vm = buildDashboardHomeViewModel(
    minimalInput({
      scanStatus: {
        logs: [],
        last: {
          id: "cmr1jn86y0h4jjy1sa3rkzqkz",
          type: "gmail",
          status: "failed",
          found: 0,
          saved: 0,
          errors: "Gmail not connected",
          startedAt: weekAgo,
          endedAt: weekAgo,
        },
        nextScheduledScanAt: null,
      },
    })
  );

  assert.equal(vm.dashboardSyncState.scanBanner, null);
  assert.notEqual(vm.dashboardSyncState.status, "ERROR");
});

test("fresh failed scan still surfaces ERROR — real failures are not hidden", () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const vm = buildDashboardHomeViewModel(
    minimalInput({
      scanStatus: {
        logs: [],
        last: {
          id: "fresh-fail",
          type: "gmail",
          status: "failed",
          found: 0,
          saved: 0,
          errors: "boom",
          startedAt: fiveMinutesAgo,
          endedAt: fiveMinutesAgo,
        },
        nextScheduledScanAt: null,
      },
    })
  );

  assert.equal(vm.dashboardSyncState.scanBanner?.status, "error");
  assert.equal(vm.dashboardSyncState.status, "ERROR");
});
