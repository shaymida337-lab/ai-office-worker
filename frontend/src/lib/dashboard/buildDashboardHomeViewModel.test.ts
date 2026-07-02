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
    ["in", "out", "invoices", "tasks"]
  );
  assert.match(vm.snapshotMetrics[0]?.value ?? "", /₪/);
  assert.equal(vm.snapshotMetrics[2]?.value, "3");
  assert.equal(vm.snapshotMetrics[3]?.value, "2");
});

test("yourDayItems passthrough reflects pending counts from input", () => {
  const vm = buildDashboardHomeViewModel(
    minimalInput({
      stats: { ...emptyStats, upcomingPaymentsCount: 5, overdueSupplierPayments: 1, openTasks: 4 },
      documentReviews: [
        {
          id: "dr-1",
          source: "gmail",
          sender: null,
          subject: null,
          fileName: null,
          documentType: "invoice",
          supplierName: "ספק",
          totalAmount: 100,
          confidenceScore: 0.9,
          uncertaintyReason: null,
          driveFileUrl: null,
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
