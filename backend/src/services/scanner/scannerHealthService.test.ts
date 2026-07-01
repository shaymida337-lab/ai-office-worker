import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SCANNER_HEALTH_FAILURE_LIMIT,
  MAX_SCANNER_HEALTH_FAILURE_LIMIT,
  parseScannerHealthLimit,
  parseScannerHealthRange,
  summarizeScannerViolations,
} from "./scannerHealthService.js";
import type { ScannerIsolationViolation } from "./scannerIsolationChecks.js";

test("parseScannerHealthRange defaults to rolling 7-day window", () => {
  const now = new Date("2026-07-01T12:00:00.000Z");
  const range = parseScannerHealthRange({}, now);
  assert.equal(range.to.toISOString(), now.toISOString());
  assert.equal(range.from.toISOString(), "2026-06-24T12:00:00.000Z");
});

test("parseScannerHealthRange accepts explicit from/to query params", () => {
  const range = parseScannerHealthRange({
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-07-01T23:59:59.999Z",
  });
  assert.equal(range.from.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(range.to.toISOString(), "2026-07-01T23:59:59.999Z");
});

test("parseScannerHealthLimit clamps invalid and oversized values", () => {
  assert.equal(parseScannerHealthLimit(undefined), DEFAULT_SCANNER_HEALTH_FAILURE_LIMIT);
  assert.equal(parseScannerHealthLimit("0"), DEFAULT_SCANNER_HEALTH_FAILURE_LIMIT);
  assert.equal(parseScannerHealthLimit("50"), 50);
  assert.equal(parseScannerHealthLimit("500"), MAX_SCANNER_HEALTH_FAILURE_LIMIT);
});

test("summarizeScannerViolations aggregates severity and type counts", () => {
  const violations: ScannerIsolationViolation[] = [
    {
      severity: "critical",
      violationType: "stuck_active_scan",
      organizationId: "org-1",
      affectedIds: ["scan-1"],
      explanation: "stuck",
      recommendedAction: "inspect",
    },
    {
      severity: "warning",
      violationType: "drive_link_invoice_confusion",
      organizationId: "org-1",
      affectedIds: ["gsi-1"],
      explanation: "drive",
      recommendedAction: "route unsupported",
    },
    {
      severity: "info",
      violationType: "gmail_mailbox_mismatch",
      organizationId: "org-1",
      affectedIds: ["int-1"],
      explanation: "mailbox",
      recommendedAction: "confirm",
    },
  ];

  const summary = summarizeScannerViolations(violations);
  assert.equal(summary.total, 3);
  assert.equal(summary.bySeverity.critical, 1);
  assert.equal(summary.bySeverity.warning, 1);
  assert.equal(summary.bySeverity.info, 1);
  assert.equal(summary.byType.stuck_active_scan, 1);
  assert.equal(summary.byType.drive_link_invoice_confusion, 1);
  assert.equal(summary.byType.gmail_mailbox_mismatch, 1);
  assert.equal(summary.byType.fdr_without_gsi, 0);
});

test("summarizeScannerViolations returns zeros for empty org", () => {
  const summary = summarizeScannerViolations([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.bySeverity.critical, 0);
  assert.equal(summary.bySeverity.warning, 0);
  assert.equal(summary.bySeverity.info, 0);
});
