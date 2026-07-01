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

  const topNoisyValidators = [...byCheck.entries()]
    .map(([checkId, count]) => ({ checkId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const falsePositiveCandidates = buildFalsePositiveCandidates(failed, ignored);

  const severityCounts = countSeverities(failed);

  return {
    ignoredCount: ignored.length,
    ignoredByCheck: Object.fromEntries(ignoredByCheck),
    falsePositiveCandidates,
    topNoisyValidators,
    severityCounts,
    criticalTrendNote: null,
    warningTrendNote: null,
  };
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
