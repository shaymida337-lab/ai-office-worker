import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateReliabilityAlerts,
  buildAggregateSummary,
  buildHebrewReliabilitySummary,
  buildReliabilityFingerprint,
  computeOverallHealthScore,
  isReliabilityStatusQuestion,
} from "./index.js";
import type { ReliabilityEventRecord, ReliabilityHealthReport } from "./reliabilityCenterTypes.js";

function makeEvent(partial: Partial<ReliabilityEventRecord>): ReliabilityEventRecord {
  const now = new Date("2026-07-08T10:00:00.000Z");
  return {
    id: partial.id ?? "evt-1",
    organizationId: partial.organizationId ?? "org-1",
    userId: partial.userId ?? null,
    module: partial.module ?? "gmail_scan",
    severity: partial.severity ?? "warning",
    errorCode: partial.errorCode ?? "SCAN_JOB_STUCK",
    userVisibleMessage: partial.userVisibleMessage ?? "stuck",
    technicalMessage: partial.technicalMessage ?? "tech",
    route: partial.route ?? null,
    component: partial.component ?? null,
    job: partial.job ?? null,
    correlationId: partial.correlationId ?? null,
    status: partial.status ?? "open",
    fingerprint: partial.fingerprint ?? "fp-1",
    firstSeenAt: partial.firstSeenAt ?? now,
    lastSeenAt: partial.lastSeenAt ?? now,
    resolvedAt: partial.resolvedAt ?? null,
    occurrences: partial.occurrences ?? 1,
    autoHealed: partial.autoHealed ?? false,
    customerVisible: partial.customerVisible ?? true,
    metadata: partial.metadata ?? null,
  };
}

test("fingerprint is stable for identical org/module/error/route", () => {
  const a = buildReliabilityFingerprint({
    organizationId: "org-1",
    module: "whatsapp",
    errorCode: "WHATSAPP_EMPTY_REPLY",
    route: "/webhooks/twilio/whatsapp",
  });
  const b = buildReliabilityFingerprint({
    organizationId: "org-1",
    module: "whatsapp",
    errorCode: "WHATSAPP_EMPTY_REPLY",
    route: "/webhooks/twilio/whatsapp",
  });
  assert.equal(a, b);
  assert.notEqual(
    a,
    buildReliabilityFingerprint({
      organizationId: "org-2",
      module: "whatsapp",
      errorCode: "WHATSAPP_EMPTY_REPLY",
      route: "/webhooks/twilio/whatsapp",
    })
  );
});

test("aggregateReliabilityAlerts groups repeated issues instead of duplicating summaries", () => {
  const aggregates = aggregateReliabilityAlerts([
    makeEvent({ id: "1", occurrences: 5, fingerprint: "a" }),
    makeEvent({ id: "2", occurrences: 7, fingerprint: "b", organizationId: "org-2" }),
    makeEvent({
      id: "3",
      module: "document_review",
      errorCode: "DOCUMENT_APPROVAL_FAILED",
      occurrences: 2,
      fingerprint: "c",
    }),
  ]);

  const scan = aggregates.find((item) => item.errorCode === "SCAN_JOB_STUCK");
  assert.ok(scan);
  assert.equal(scan!.occurrences, 12);
  assert.equal(scan!.organizationCount, 2);
  assert.match(scan!.summary, /12 scan jobs/);

  const approval = aggregates.find((item) => item.errorCode === "DOCUMENT_APPROVAL_FAILED");
  assert.ok(approval);
  assert.match(approval!.summary, /2 document approval/);
});

test("buildAggregateSummary examples match product language", () => {
  assert.equal(
    buildAggregateSummary({
      module: "gmail_scan",
      errorCode: "SCAN_JOB_STUCK",
      occurrences: 12,
      organizationCount: 1,
      autoHealed: true,
    }),
    "12 scan jobs were stuck and auto-recovered."
  );
  assert.equal(
    buildAggregateSummary({
      module: "dashboard",
      errorCode: "STALE_TIMEOUT_BANNER",
      occurrences: 3,
      organizationCount: 3,
    }),
    "3 organization(s) saw a stale timeout banner."
  );
  assert.equal(
    buildAggregateSummary({
      module: "whatsapp",
      errorCode: "WHATSAPP_WEBHOOK_FAILED",
      occurrences: 5,
      organizationCount: 1,
    }),
    "5 WhatsApp webhook failures in the observed window."
  );
});

test("computeOverallHealthScore penalizes critical and customer-visible issues", () => {
  assert.equal(
    computeOverallHealthScore({
      openCritical: 0,
      openCustomerVisible: 0,
      openErrors: 0,
      stuckJobs: 0,
    }),
    100
  );
  assert.ok(
    computeOverallHealthScore({
      openCritical: 1,
      openCustomerVisible: 1,
      openErrors: 1,
      stuckJobs: 1,
    }) < 70
  );
});

test("Hebrew Natalie summary is healthy when no open critical issues", () => {
  const base = {
    generatedAt: new Date().toISOString(),
    organizationId: "org-1",
    overallHealthScore: 100,
    overallStatus: "healthy" as const,
    openCriticalIssues: 0,
    customerVisibleIssues: 0,
    stuckJobs: 0,
    scanHealth: "healthy" as const,
    whatsappHealth: "healthy" as const,
    invoiceApprovalHealth: "healthy" as const,
    oauthHealth: "healthy" as const,
    last24hErrorCounts: { total: 12, critical: 0, error: 0, warning: 12, info: 0 },
    autoHealedIssues: 12,
    unresolvedIssues: 0,
    openEvents: [],
    aggregates: [],
  } satisfies Omit<ReliabilityHealthReport, "hebrewSummary">;

  const summary = buildHebrewReliabilitySummary(base);
  assert.match(summary, /המערכת תקינה/);
  assert.match(summary, /אין תקלות קריטיות פתוחות/);
  assert.match(summary, /תוקנו אוטומטית 12/);
});

test("isReliabilityStatusQuestion detects Hebrew and English prompts", () => {
  assert.equal(isReliabilityStatusQuestion("מה מצב המערכת?"), true);
  assert.equal(isReliabilityStatusQuestion("system status"), true);
  assert.equal(isReliabilityStatusQuestion("מה יש לי מחר ביומן"), false);
});
