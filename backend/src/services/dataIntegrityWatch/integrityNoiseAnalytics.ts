import type { IntegrityFinding, IntegrityNoiseAnalytics, IntegritySeverity } from "./integrityTypes.js";

export type IntegrityIgnoredRecord = {
  checkId: string;
  reason: string;
  entityId?: string | null;
};

export function buildNoiseAnalytics(
  findings: IntegrityFinding[],
  ignored: IntegrityIgnoredRecord[],
): IntegrityNoiseAnalytics {
  const failed = findings.filter((f) => f.status === "fail");
  const byCheck = countBy(failed, (f) => f.checkId);
  const ignoredByCheck = countBy(ignored, (r) => r.checkId);
  const totalSignals = failed.length + ignored.length;
  const ignoredPercentage =
    totalSignals > 0 ? Math.round((ignored.length / totalSignals) * 1000) / 10 : 0;

  const topNoisyValidators = [...byCheck.entries()]
    .map(([checkId, count]) => ({
      checkId,
      count,
      ignoredRate: computeIgnoredRate(checkId, count, ignoredByCheck),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const falsePositiveCandidates = buildFalsePositiveCandidates(failed, ignored);
  const investigationCandidates = buildInvestigationCandidates(failed);
  const severityCounts = countSeverities(failed);

  return {
    ignoredCount: ignored.length,
    ignoredByCheck: Object.fromEntries(ignoredByCheck),
    ignoredPercentage,
    falsePositiveCandidates,
    investigationCandidates,
    topNoisyValidators,
    severityCounts,
    criticalTrendNote: buildCriticalTrendNote(severityCounts, failed),
    warningTrendNote: buildWarningTrendNote(severityCounts, failed),
  };
}

function buildInvestigationCandidates(
  findings: IntegrityFinding[],
): IntegrityNoiseAnalytics["investigationCandidates"] {
  const candidates: IntegrityNoiseAnalytics["investigationCandidates"] = [];

  const orphanCritical = findings.filter(
    (f) => f.checkId === "scan-orphan-gmail-message" && f.severity === "critical",
  );
  if (orphanCritical.length > 0) {
    candidates.push({
      checkId: "scan-orphan-gmail-message",
      count: orphanCritical.length,
      reason: "Invoice-like orphan with financial attachment — genuine investigation candidate",
    });
  }

  const orphanInvestigationWarnings = findings.filter(
    (f) =>
      f.checkId === "scan-orphan-gmail-message" &&
      f.severity === "warning" &&
      (f.probableRootCause === "test_subject_investigation_candidate" ||
        f.probableRootCause === "invoice_subject_no_financial_attachment"),
  );
  if (orphanInvestigationWarnings.length > 0) {
    candidates.push({
      checkId: "scan-orphan-gmail-message",
      count: orphanInvestigationWarnings.length,
      reason: "Orphan warning requiring optional scanner pipeline review",
    });
  }

  return candidates.sort((a, b) => b.count - a.count);
}

function buildFalsePositiveCandidates(
  findings: IntegrityFinding[],
  ignored: IntegrityIgnoredRecord[],
): IntegrityNoiseAnalytics["falsePositiveCandidates"] {
  const candidates: IntegrityNoiseAnalytics["falsePositiveCandidates"] = [];

  const ignoredOrphans = ignored.filter((r) => r.checkId === "scan-orphan-gmail-message").length;
  if (ignoredOrphans > 0) {
    candidates.push({
      checkId: "scan-orphan-gmail-message",
      count: ignoredOrphans,
      reason: "Ignored via grace period or system/junk classification",
    });
  }

  const siblingOrphans = findings.filter(
    (f) => f.checkId === "scan-orphan-gmail-message" && f.probableRootCause === "sibling_org_artifact",
  ).length;
  if (siblingOrphans > 0) {
    candidates.push({
      checkId: "scan-orphan-gmail-message",
      count: siblingOrphans,
      reason: "Shared mailbox sibling org already has GSI/FDR artifact",
    });
  }

  const testOrphans = findings.filter(
    (f) =>
      f.checkId === "scan-orphan-gmail-message" &&
      (f.probableRootCause === "test_sender" ||
        f.probableRootCause === "test_subject_no_financial_attachment" ||
        f.probableRootCause === "unsupported_attachment_only"),
  ).length;
  if (testOrphans > 0) {
    candidates.push({
      checkId: "scan-orphan-gmail-message",
      count: testOrphans,
      reason: "Internal QA or non-financial attachment traffic",
    });
  }

  const historicalBlocked = findings.filter(
    (f) => f.checkId === "fin-payment-after-blocked" && f.probableRootCause === "duplicate_rescan",
  ).length;
  if (historicalBlocked > 0) {
    candidates.push({
      checkId: "fin-payment-after-blocked",
      count: historicalBlocked,
      reason: "Payment predates blocked decision — historical duplicate-rescan ordering",
    });
  }

  const sharedMailbox = findings.filter(
    (f) => f.checkId === "org-cross-org-reference" && f.probableRootCause === "shared_mailbox_history",
  ).length;
  if (sharedMailbox > 0) {
    candidates.push({
      checkId: "org-cross-org-reference",
      count: sharedMailbox,
      reason: "Shared gmailId across organizations without financial cross-reference",
    });
  }

  return candidates.sort((a, b) => b.count - a.count);
}

function buildCriticalTrendNote(
  severityCounts: Record<IntegritySeverity, number>,
  findings: IntegrityFinding[],
): string | null {
  if (severityCounts.critical === 0) {
    return "No critical findings — operator action limited to warnings/info.";
  }
  const top = topCheckForSeverity(findings, "critical");
  return `${severityCounts.critical} critical finding(s); top check: ${top?.checkId ?? "unknown"} (${top?.count ?? 0})`;
}

function buildWarningTrendNote(
  severityCounts: Record<IntegritySeverity, number>,
  findings: IntegrityFinding[],
): string | null {
  if (severityCounts.warning === 0) return null;
  const top = topCheckForSeverity(findings, "warning");
  return `${severityCounts.warning} warning(s); top check: ${top?.checkId ?? "unknown"} (${top?.count ?? 0})`;
}

function topCheckForSeverity(
  findings: IntegrityFinding[],
  severity: IntegritySeverity,
): { checkId: string; count: number } | null {
  const counts = countBy(
    findings.filter((f) => f.severity === severity),
    (f) => f.checkId,
  );
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;
  return { checkId: sorted[0][0], count: sorted[0][1] };
}

function computeIgnoredRate(
  checkId: string,
  findingCount: number,
  ignoredByCheck: Map<string, number>,
): number | null {
  const ignoredCount = ignoredByCheck.get(checkId) ?? 0;
  const total = findingCount + ignoredCount;
  if (total === 0) return null;
  return Math.round((ignoredCount / total) * 1000) / 10;
}

function countSeverities(findings: IntegrityFinding[]): Record<IntegritySeverity, number> {
  const counts: Record<IntegritySeverity, number> = {
    critical: 0,
    important: 0,
    warning: 0,
    info: 0,
  };
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  return counts;
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}
