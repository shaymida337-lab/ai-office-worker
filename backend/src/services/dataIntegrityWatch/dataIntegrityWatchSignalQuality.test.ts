import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ORPHAN_GRACE_PERIOD_MS,
  buildNoiseAnalytics,
  buildSignalQualityComparison,
  classifyOrphanEmailMessage,
  computeFindingConfidence,
  computeOrgIntegrityScore,
  orphanDispositionToSeverity,
  runAllIntegrityValidators,
  runCoreOrganizationValidators,
  runCoreScannerValidators,
  severityToReliabilityEventSeverity,
} from "./index.js";
import { buildIntegrityFinding } from "./integrityFinding.js";
import { buildIntegrityWatchReport } from "./integrityReport.js";
import { buildIntegrityOrgReport } from "./integrityScore.js";
import { emptyIntegrityOrgData, emailRow, attachmentRow, paymentRow } from "./integrityTestFixtures.js";
import { mapCoreIsolationViolationsToFindings } from "./integrityValidators.js";

const NOW = new Date("2026-06-01T12:00:00.000Z");

test("signal quality: grace period ignores in-flight orphan emails", () => {
  const email = emailRow({
    processedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
  });
  const result = classifyOrphanEmailMessage(email, NOW);
  assert.equal(result.disposition, "IGNORED");
  assert.ok(result.reason.includes("grace period"));

  const { ignored } = runAllIntegrityValidators(
    emptyIntegrityOrgData({
      now: NOW,
      emailMessages: [email],
    }),
  );
  assert.equal(ignored.length, 1);
  assert.equal(runCoreScannerValidators(emptyIntegrityOrgData({ now: NOW, emailMessages: [email] }), []).length, 0);
});

test("signal quality: invoice subject past grace is CRITICAL orphan", () => {
  const email = emailRow({
    id: "em-invoice",
    subject: "חשבונית מס",
    fromAddress: "vendor@supplier.co.il",
    processedAt: new Date(NOW.getTime() - DEFAULT_ORPHAN_GRACE_PERIOD_MS - 1000),
  });
  const classification = classifyOrphanEmailMessage(email, NOW, undefined, {
    attachments: [attachmentRow({ emailMessageId: "em-invoice", filename: "invoice.pdf" })],
  });
  assert.equal(classification.disposition, "CRITICAL");
  assert.equal(orphanDispositionToSeverity(classification.disposition), "critical");

  const attachments = new Map([["em-invoice", [attachmentRow({ emailMessageId: "em-invoice" })]]]);
  const findings = runCoreScannerValidators(
    emptyIntegrityOrgData({
      now: NOW,
      emailMessages: [email],
      emailAttachmentsByEmailId: attachments,
    }),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "critical");
  assert.ok(findings[0]?.findingConfidence >= 0.8);
});

test("signal quality: test sender orphan is INFO", () => {
  const email = emailRow({
    fromAddress: "shaymida337@gmail.com",
    subject: "hello",
    processedAt: new Date(NOW.getTime() - DEFAULT_ORPHAN_GRACE_PERIOD_MS - 1000),
  });
  const classification = classifyOrphanEmailMessage(email, NOW);
  assert.equal(classification.disposition, "INFO");

  const findings = runCoreScannerValidators(
    emptyIntegrityOrgData({ now: NOW, emailMessages: [email] }),
  );
  assert.equal(findings[0]?.severity, "info");
  assert.equal(findings[0]?.signalDisposition, "INFO");
});

test("signal quality: system mail is IGNORED", () => {
  const email = emailRow({
    subject: "Security alert",
    fromAddress: "Google <no-reply@accounts.google.com>",
    processedAt: new Date(NOW.getTime() - DEFAULT_ORPHAN_GRACE_PERIOD_MS - 1000),
  });
  assert.equal(classifyOrphanEmailMessage(email, NOW).disposition, "IGNORED");
});

test("signal quality: historical duplicate-rescan blocked payment is WARNING", () => {
  const fdrCreated = new Date("2026-07-01T13:00:00.000Z");
  const payCreated = new Date("2026-07-01T09:00:00.000Z");
  const data = emptyIntegrityOrgData({
    financialDocumentReviews: [
      {
        id: "fdr-1",
        source: "gmail",
        gmailMessageId: "g-1",
        reviewStatus: "needs_review",
        uncertaintyReason: null,
        documentFingerprint: "fp-1",
        supplierPaymentId: "pay-1",
        parsedFieldsJson: { outcome: { status: "BLOCKED" } },
        createdAt: fdrCreated,
      },
    ],
    supplierPayments: [{ id: "pay-1", documentFingerprint: "fp-1", emailMessageId: "em-1", createdAt: payCreated }],
    payments: [paymentRow({ id: "pay-1", documentFingerprint: "fp-1", createdAt: payCreated })],
  });

  const violations = [
    {
      severity: "critical" as const,
      violationType: "blocked_outcome_persisted" as const,
      organizationId: "org-test",
      affectedIds: ["fdr-1", "pay-1"],
      explanation: "blocked with payment",
      recommendedAction: "inspect",
    },
  ];
  const findings = mapCoreIsolationViolationsToFindings("org-test", violations, data);
  const payFinding = findings.find((f) => f.entityId === "pay-1");
  assert.equal(payFinding?.severity, "warning");
  assert.equal(payFinding?.probableRootCause, "duplicate_rescan");
});

test("signal quality: active persistence after BLOCKED is CRITICAL", () => {
  const fdrCreated = new Date("2026-07-01T09:00:00.000Z");
  const payCreated = new Date("2026-07-01T13:00:00.000Z");
  const data = emptyIntegrityOrgData({
    financialDocumentReviews: [
      {
        id: "fdr-1",
        source: "gmail",
        gmailMessageId: "g-1",
        reviewStatus: "needs_review",
        uncertaintyReason: null,
        documentFingerprint: "fp-1",
        supplierPaymentId: "pay-1",
        parsedFieldsJson: { outcome: { status: "BLOCKED" } },
        createdAt: fdrCreated,
      },
    ],
    payments: [paymentRow({ id: "pay-1", documentFingerprint: "fp-1", createdAt: payCreated })],
  });
  const findings = mapCoreIsolationViolationsToFindings("org-test", [
    {
      severity: "critical",
      violationType: "blocked_outcome_persisted",
      organizationId: "org-test",
      affectedIds: ["fdr-1", "pay-1"],
      explanation: "blocked with payment",
      recommendedAction: "inspect",
    },
  ], data);
  const payFinding = findings.find((f) => f.entityId === "pay-1");
  assert.equal(payFinding?.severity, "critical");
  assert.equal(payFinding?.probableRootCause, "blocked_outcome_persisted");
});

test("signal quality: shared mailbox is INFO without financial leak", () => {
  const findings = runCoreOrganizationValidators(
    emptyIntegrityOrgData({
      crossOrgEmailMessages: [{ id: "x-1", organizationId: "other-org", gmailId: "g-shared" }],
      gmailMessageIds: new Set(["g-shared"]),
      emailMessages: [emailRow({ gmailId: "g-shared" })],
    }),
  );
  assert.ok(findings.some((f) => f.severity === "info" && f.probableRootCause === "shared_mailbox_history"));
  assert.ok(findings.every((f) => f.severity !== "critical"));
});

test("signal quality: foreign payment reference is CRITICAL", () => {
  const findings = runCoreOrganizationValidators(
    emptyIntegrityOrgData({
      payments: [paymentRow({ id: "pay-bad", emailMessageId: "foreign-email-id" })],
      emailIds: new Set(["email-1"]),
    }),
  );
  assert.ok(
    findings.some(
      (f) => f.severity === "critical" && f.probableRootCause === "cross_tenant_financial_reference",
    ),
  );
});

test("signal quality: confidence increases with supporting signals", () => {
  const low = computeFindingConfidence({ baseConfidence: 0.8, signalCount: 1 });
  const high = computeFindingConfidence({
    baseConfidence: 0.8,
    signalCount: 3,
    crossValidated: true,
  });
  assert.ok(high > low);
});

test("signal quality: noise analytics tracks ignored orphans", () => {
  const email = emailRow({
    fromAddress: "Google <no-reply@accounts.google.com>",
    subject: "Security alert",
    processedAt: new Date(NOW.getTime() - DEFAULT_ORPHAN_GRACE_PERIOD_MS - 1000),
  });
  const { findings, ignored } = runAllIntegrityValidators(
    emptyIntegrityOrgData({ now: NOW, emailMessages: [email] }),
  );
  const noise = buildNoiseAnalytics(findings, ignored);
  assert.equal(noise.ignoredCount, 1);
  assert.ok(noise.falsePositiveCandidates.length >= 0);
});

test("signal quality: severity maps important correctly", () => {
  assert.equal(severityToReliabilityEventSeverity("important"), "IMPORTANT");
  assert.equal(severityToReliabilityEventSeverity("warning"), "IMPORTANT");
});

test("signal quality: report includes comparison vs prod baseline", () => {
  const report = buildIntegrityWatchReport({
    mode: "manual",
    dryRun: true,
    organizationReports: [buildIntegrityOrgReport("org-1", [])],
    ignored: [{ checkId: "scan-orphan-gmail-message", reason: "junk" }],
  });
  assert.ok(report.noiseAnalytics);
  assert.ok(report.signalQualityComparison);
  assert.equal(report.signalQualityComparison?.before.criticalFindings, 386);
  const cmp = buildSignalQualityComparison(report);
  assert.ok(cmp.criticalCountReduction >= 386);
});

test("signal quality: score penalizes important less than critical", () => {
  const criticalOnly = computeOrgIntegrityScore([
    buildIntegrityFinding({
      checkId: "x",
      category: "financial",
      severity: "critical",
      organizationId: "o",
      entityType: "T",
      explanation: "c",
    }),
  ]);
  const importantOnly = computeOrgIntegrityScore([
    buildIntegrityFinding({
      checkId: "x",
      category: "financial",
      severity: "important",
      organizationId: "o",
      entityType: "T",
      explanation: "i",
    }),
  ]);
  assert.ok(criticalOnly < importantOnly);
});

test("signal quality 2.3D: internal QA sender is INFO", () => {
  const email = emailRow({
    fromAddress: "shaykedma@gmail.com",
    subject: "חשבונית שכירות",
    processedAt: new Date(NOW.getTime() - DEFAULT_ORPHAN_GRACE_PERIOD_MS - 1000),
  });
  assert.equal(classifyOrphanEmailMessage(email, NOW).disposition, "INFO");
});

test("signal quality 2.3D: test subject without financial attachment is INFO", () => {
  const email = emailRow({
    subject: "חשבונית לבדיקה",
    fromAddress: "vendor@supplier.co.il",
    processedAt: new Date(NOW.getTime() - DEFAULT_ORPHAN_GRACE_PERIOD_MS - 1000),
  });
  assert.equal(
    classifyOrphanEmailMessage(email, NOW, undefined, {
      attachments: [attachmentRow({ filename: "natalie-website-final.html", mimeType: "text/html" })],
    }).disposition,
    "INFO",
  );
});

test("signal quality 2.3D: html-only invoice subject is INFO", () => {
  const email = emailRow({
    subject: "חשבונית מס",
    fromAddress: "vendor@supplier.co.il",
    processedAt: new Date(NOW.getTime() - DEFAULT_ORPHAN_GRACE_PERIOD_MS - 1000),
  });
  assert.equal(
    classifyOrphanEmailMessage(email, NOW, undefined, {
      attachments: [attachmentRow({ filename: "page.html", mimeType: "text/html" })],
    }).disposition,
    "INFO",
  );
});

test("signal quality 2.3D: sibling org artifact downgrades to WARNING", () => {
  const email = emailRow({
    gmailId: "g-shared",
    subject: "חשבונית מס",
    fromAddress: "vendor@supplier.co.il",
    processedAt: new Date(NOW.getTime() - DEFAULT_ORPHAN_GRACE_PERIOD_MS - 1000),
  });
  const result = classifyOrphanEmailMessage(email, NOW, undefined, {
    attachments: [attachmentRow({ filename: "invoice.pdf" })],
    siblingArtifacts: {
      hasArtifact: true,
      siblingOrganizationCount: 1,
      gsiCount: 1,
      fdrCount: 0,
      artifactSummary: "GSI auto_saved/invoice",
      organizationIds: ["other-org"],
    },
  });
  assert.equal(result.disposition, "WARNING");
  assert.equal(result.probableRootCause, "sibling_org_artifact");
});

test("signal quality 2.3D: noise analytics includes investigation candidates", () => {
  const email = emailRow({
    id: "em-critical",
    subject: "חשבונית",
    fromAddress: "vendor@supplier.co.il",
    processedAt: new Date(NOW.getTime() - DEFAULT_ORPHAN_GRACE_PERIOD_MS - 1000),
  });
  const { findings, ignored } = runAllIntegrityValidators(
    emptyIntegrityOrgData({
      now: NOW,
      emailMessages: [email],
      emailAttachmentsByEmailId: new Map([["em-critical", [attachmentRow({ emailMessageId: "em-critical" })]]]),
    }),
  );
  const noise = buildNoiseAnalytics(findings, ignored);
  assert.equal(typeof noise.ignoredPercentage, "number");
  assert.ok(noise.investigationCandidates.length >= 1);
  assert.ok(noise.criticalTrendNote?.includes("critical"));
});
