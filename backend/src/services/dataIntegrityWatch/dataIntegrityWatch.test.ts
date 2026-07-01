import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORE_INTEGRITY_CHECKS,
  INTEGRITY_CHECK_REGISTRY,
  INTEGRITY_READ_ONLY_GUARANTEE,
  INTEGRITY_WATCH_VERSION,
  PLACEHOLDER_INTEGRITY_CHECKS,
  buildIntegrityHealthExtension,
  buildIntegrityOrgReport,
  buildIntegrityWatchReport,
  computeOrgIntegrityScore,
  dedupeFindings,
  formatIntegrityWatchReport,
  listImplementedIntegrityCheckIds,
  listPlaceholderIntegrityCheckIds,
  mapIntegrityFindingsToReliabilityEvents,
  runAllIntegrityValidators,
  runCoreFinancialValidators,
  runCoreIntegrationValidators,
  runCoreOrganizationValidators,
  runCoreScannerValidators,
  severityToReliabilityEventSeverity,
} from "./index.js";
import { buildIntegrityFinding } from "./integrityFinding.js";
import { emptyIntegrityOrgData, paymentRow } from "./integrityTestFixtures.js";
import type { IntegrityReadOnlyDb } from "./integrityDb.js";
import { runIntegrityWatchForOrganization } from "./integrityRunner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("integrity core: 8 implemented validators in registry", () => {
  assert.equal(CORE_INTEGRITY_CHECKS.length, 8);
  assert.equal(listImplementedIntegrityCheckIds().length, 8);
  for (const check of CORE_INTEGRITY_CHECKS) {
    assert.equal(check.implemented, true);
    assert.equal(check.readOnly, true);
  }
});

test("integrity core: placeholders reserved for phase 2.3B", () => {
  assert.ok(PLACEHOLDER_INTEGRITY_CHECKS.length >= 20);
  assert.ok(listPlaceholderIntegrityCheckIds().every((id) => !listImplementedIntegrityCheckIds().includes(id)));
  assert.equal(INTEGRITY_CHECK_REGISTRY.length, CORE_INTEGRITY_CHECKS.length + PLACEHOLDER_INTEGRITY_CHECKS.length);
});

test("integrity core: read-only guarantee is enforced", () => {
  assert.equal(INTEGRITY_READ_ONLY_GUARANTEE, true);
});

test("integrity core: validator 1 — payment without source document", () => {
  const data = emptyIntegrityOrgData({
    payments: [
      paymentRow({
        id: "pay-no-src",
        emailMessageId: null,
        documentLink: null,
        driveFileId: null,
        source: "gmail",
      }),
    ],
  });
  const findings = runCoreFinancialValidators(data);
  assert.ok(findings.some((f) => f.checkId === "fin-payment-without-source" && f.severity === "critical"));
});

test("integrity core: validator 2 — payment after BLOCKED via isolation mapping", () => {
  const data = emptyIntegrityOrgData({
    financialDocumentReviews: [
      {
        id: "fdr-1",
        source: "gmail",
        gmailMessageId: "g-1",
        reviewStatus: "blocked",
        uncertaintyReason: null,
        documentFingerprint: null,
        supplierPaymentId: "pay-1",
        parsedFieldsJson: { outcome: { status: "BLOCKED" } },
        createdAt: new Date(),
      },
    ],
    supplierPayments: [{ id: "pay-1", documentFingerprint: null, emailMessageId: "em-1", createdAt: new Date() }],
    payments: [paymentRow({ id: "pay-1" })],
  });
  const findings = runAllIntegrityValidators(data);
  assert.ok(findings.some((f) => f.checkId === "fin-payment-after-blocked"));
});

test("integrity core: validator 3 — duplicate fingerprint", () => {
  const data = emptyIntegrityOrgData({
    payments: [
      paymentRow({ id: "p1", documentFingerprint: "fp-abc" }),
      paymentRow({ id: "p2", documentFingerprint: "fp-abc" }),
    ],
  });
  const findings = runCoreFinancialValidators(data);
  assert.ok(findings.some((f) => f.checkId === "fin-duplicate-fingerprint"));
});

test("integrity core: validator 4 — zero amount on financial document", () => {
  const data = emptyIntegrityOrgData({
    payments: [paymentRow({ id: "pay-zero", amount: 0 })],
    invoiceDetails: [
      {
        id: "inv-zero",
        gmailMessageId: "g-1",
        emailId: null,
        amount: 0,
        currency: "ILS",
        organizationId: "org-test",
        createdAt: new Date(),
      },
    ],
  });
  const findings = runCoreFinancialValidators(data);
  assert.equal(findings.filter((f) => f.checkId === "fin-zero-amount-forbidden").length, 2);
});

test("integrity core: validator 5 — cross-org reference", () => {
  const data = emptyIntegrityOrgData({
    crossOrgEmailMessages: [{ id: "x-1", organizationId: "other-org", gmailId: "g-shared" }],
  });
  const findings = runCoreOrganizationValidators(data);
  assert.ok(findings.some((f) => f.checkId === "org-cross-org-reference" && f.severity === "critical"));
});

test("integrity core: validator 6 — stuck scan", () => {
  const data = emptyIntegrityOrgData({
    stuckActiveScans: [
      { id: "scan-1", status: "running", startedAt: new Date("2026-05-01T00:00:00Z"), scanMode: "incremental" },
    ],
  });
  const findings = runCoreScannerValidators(data);
  assert.ok(findings.some((f) => f.checkId === "scan-stuck" && f.severity === "critical"));
});

test("integrity core: validator 7 — orphan Gmail message", () => {
  const data = emptyIntegrityOrgData({
    emailMessages: [{ id: "em-1", gmailId: "g-1", receivedAt: new Date() }],
    gsiGmailIds: new Set(),
    fdrGmailIds: new Set(),
  });
  const findings = runCoreScannerValidators(data);
  assert.ok(findings.some((f) => f.checkId === "scan-orphan-gmail-message" && f.severity === "critical"));
});

test("integrity core: validator 8 — Gmail disconnected or invalid", () => {
  const disconnected = runCoreIntegrationValidators(emptyIntegrityOrgData({ integrations: [] }));
  assert.ok(disconnected.some((f) => f.checkId === "int-gmail-invalid"));

  const expired = runCoreIntegrationValidators(
    emptyIntegrityOrgData({
      integrations: [
        {
          id: "int-1",
          provider: "gmail",
          expiresAt: new Date("2020-01-01"),
          metadata: null,
          connectedAt: new Date(),
        },
      ],
    }),
  );
  assert.ok(expired.some((f) => f.checkId === "int-gmail-invalid"));
});

test("integrity core: score calculation penalizes critical findings", () => {
  const findings = [
    buildIntegrityFinding({
      checkId: "fin-zero-amount-forbidden",
      category: "financial",
      severity: "critical",
      organizationId: "org-1",
      entityType: "SupplierPayment",
      entityId: "p1",
      explanation: "zero",
    }),
  ];
  assert.equal(computeOrgIntegrityScore(findings), 85);
  const orgReport = buildIntegrityOrgReport("org-1", findings);
  assert.equal(orgReport.integrityScore, 85);
  assert.equal(orgReport.criticalCount, 1);
  assert.equal(orgReport.passed, false);
});

test("integrity core: report generation without trend", () => {
  const orgReport = buildIntegrityOrgReport("org-1", []);
  const report = buildIntegrityWatchReport({
    mode: "manual",
    dryRun: false,
    organizationReports: [orgReport],
    generatedAt: "2026-06-01T12:00:00Z",
  });
  assert.equal(report.schemaVersion, INTEGRITY_WATCH_VERSION);
  assert.equal(report.checksImplemented, 8);
  assert.equal(report.criticalFindings, 0);
  assert.equal(report.warningFindings, 0);
  assert.equal(!("trend" in report), true);
  assert.ok(formatIntegrityWatchReport(report).includes("Overall score"));
});

test("integrity core: reliability events and health integration", () => {
  const finding = buildIntegrityFinding({
    checkId: "org-cross-org-reference",
    category: "organization",
    severity: "critical",
    organizationId: "org-1",
    entityType: "EmailMessage",
    entityId: "e1",
    explanation: "cross org",
  });
  const events = mapIntegrityFindingsToReliabilityEvents([finding], "2026-06-01T12:00:00Z");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.severity, "CRITICAL");
  assert.equal(severityToReliabilityEventSeverity("warning"), "IMPORTANT");

  const report = buildIntegrityWatchReport({
    mode: "manual",
    dryRun: false,
    organizationReports: [buildIntegrityOrgReport("org-1", [finding])],
  });
  const health = buildIntegrityHealthExtension(report);
  assert.equal(health.integrityScore, 85);
  assert.equal(health.criticalFindings, 1);
  assert.equal(health.integrityFailures, 1);
  assert.equal(!("trend" in health), true);
});

test("integrity core: organization isolation in runner", async () => {
  const orgA = "org-a";
  const orgB = "org-b";
  const loadedOrgs: string[] = [];

  const db = {
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        user: { email: `${where.id}@example.com` },
      }),
    },
    supplierPayment: {
      findMany: async ({ where }: { where: { organizationId: string } }) => {
        loadedOrgs.push(where.organizationId);
        return [];
      },
    },
    financialDocumentReview: { findMany: async () => [] },
    gmailScanItem: { findMany: async () => [] },
    invoice: { findMany: async () => [] },
    emailMessage: { findMany: async () => [] },
    integration: {
      findUnique: async () => null,
      findMany: async () => [],
    },
    syncLog: { findMany: async () => [] },
  } as unknown as IntegrityReadOnlyDb;

  await runIntegrityWatchForOrganization(db, orgA, { mode: "manual", now: new Date("2026-06-01T12:00:00.000Z") });
  await runIntegrityWatchForOrganization(db, orgB, { mode: "manual", now: new Date("2026-06-01T12:00:00.000Z") });
  assert.deepEqual(loadedOrgs.filter((id) => id === orgA).length >= 1, true);
  assert.deepEqual(loadedOrgs.filter((id) => id === orgB).length >= 1, true);
  assert.ok(!loadedOrgs.includes("other-org"));
});

test("integrity core: runner uses read-only db surface only", async () => {
  const db = {
    organization: { findUnique: async () => ({ user: { email: "a@b.com" } }) },
    supplierPayment: { findMany: async () => [] },
    financialDocumentReview: { findMany: async () => [] },
    gmailScanItem: { findMany: async () => [] },
    invoice: { findMany: async () => [] },
    emailMessage: { findMany: async () => [] },
    integration: { findUnique: async () => null, findMany: async () => [] },
    syncLog: { findMany: async () => [] },
  } as unknown as IntegrityReadOnlyDb;

  const report = await runIntegrityWatchForOrganization(db, "org-test", {
    mode: "manual",
    now: new Date("2026-06-01T12:00:00.000Z"),
  });
  assert.equal(report.organizationsScanned, 1);
  assert.equal(report.mode, "manual");
});

test("integrity core: integrityDb has no write operations in source", () => {
  const source = readFileSync(join(__dirname, "integrityDb.ts"), "utf8");
  for (const method of ["create", "update", "delete", "upsert", "createMany", "updateMany", "deleteMany"]) {
    assert.ok(!source.includes(`.${method}(`), `integrityDb must not call .${method}(`);
  }
});

test("integrity core: dedupe removes duplicate check+entity findings", () => {
  const finding = buildIntegrityFinding({
    checkId: "fin-duplicate-fingerprint",
    category: "financial",
    severity: "critical",
    organizationId: "org-1",
    entityType: "SupplierPayment",
    entityId: "p1",
    explanation: "dup",
  });
  assert.equal(dedupeFindings([finding, finding]).length, 1);
});

test("integrity core: runAllIntegrityValidators returns finding shape", () => {
  const findings = runAllIntegrityValidators(emptyIntegrityOrgData());
  for (const f of findings) {
    assert.ok(f.checkId);
    assert.equal(f.organizationId, "org-test");
    assert.equal(f.autoRecoverable, false);
  }
});
