import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDashboardHomeViewModel,
  type BuildDashboardHomeViewModelInput,
} from "../lib/dashboard/buildDashboardHomeViewModel.js";
import { emptyStats } from "../lib/dashboard/homePageConstants.js";

function hookShapedInput(overrides: Partial<BuildDashboardHomeViewModelInput> = {}): BuildDashboardHomeViewModelInput {
  return {
    pageLoading: false,
    gmailStatus: null,
    gmailStatusKnown: false,
    gmailStatusStale: false,
    scanStatus: null,
    scanStatusKnown: false,
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
    organizationSettings: null,
    payments: [],
    missingInvoices: [],
    alerts: [],
    upcomingAppointments: [],
    briefingScheduling: null,
    stats: {
      ...emptyStats,
      moneyToReceive: 5000,
      moneyToPay: 1200,
      pendingInvoices: 1,
      openTasks: 3,
    },
    recentTasks: [],
    recentInvoices: [],
    whatsAppStats: null,
    firstVisitMode: false,
    ...overrides,
  };
}

test("dashboard home hook input with stats yields 4 snapshot KPI metrics", () => {
  const vm = buildDashboardHomeViewModel(hookShapedInput());

  assert.equal(vm.snapshotMetrics.length, 4);
  assert.equal(vm.snapshotMetrics[0]?.id, "in");
  assert.equal(vm.snapshotMetrics[1]?.id, "out");
  assert.equal(vm.snapshotMetrics[2]?.id, "invoices");
  assert.equal(vm.snapshotMetrics[3]?.id, "tasks");
  assert.match(vm.snapshotMetrics[0]?.value ?? "", /₪/);
});
