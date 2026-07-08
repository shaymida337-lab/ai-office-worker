import type {
  ReliabilityAlertAggregate,
  ReliabilityCenterSeverity,
  ReliabilityEventRecord,
  ReliabilityHealthReport,
} from "./reliabilityCenterTypes.js";
import { listOpenReliabilityEvents } from "./reliabilityEventRepository.js";
import { prisma } from "../../../lib/prisma.js";

function countBySeverity(events: ReliabilityEventRecord[]) {
  const counts = { total: 0, critical: 0, error: 0, warning: 0, info: 0 };
  for (const event of events) {
    counts.total += event.occurrences;
    if (event.severity === "critical") counts.critical += event.occurrences;
    else if (event.severity === "error") counts.error += event.occurrences;
    else if (event.severity === "warning") counts.warning += event.occurrences;
    else counts.info += event.occurrences;
  }
  return counts;
}

function moduleHealth(
  open: ReliabilityEventRecord[],
  module: string
): "healthy" | "degraded" | "unhealthy" {
  const related = open.filter((event) => event.module === module);
  if (related.some((event) => event.severity === "critical")) return "unhealthy";
  if (related.some((event) => event.severity === "error")) return "degraded";
  if (related.some((event) => event.severity === "warning")) return "degraded";
  return "healthy";
}

export function aggregateReliabilityAlerts(
  events: ReliabilityEventRecord[]
): ReliabilityAlertAggregate[] {
  const groups = new Map<string, ReliabilityEventRecord[]>();
  for (const event of events) {
    const key = `${event.module}|${event.errorCode}|${event.severity}`;
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }

  const aggregates: ReliabilityAlertAggregate[] = [];
  for (const [key, group] of groups) {
    const first = group[0]!;
    const occurrences = group.reduce((sum, item) => sum + item.occurrences, 0);
    const orgIds = new Set(group.map((item) => item.organizationId).filter(Boolean));
    const firstSeenAt = new Date(Math.min(...group.map((item) => item.firstSeenAt.getTime())));
    const lastSeenAt = new Date(Math.max(...group.map((item) => item.lastSeenAt.getTime())));
    aggregates.push({
      key,
      module: first.module,
      errorCode: first.errorCode,
      severity: first.severity,
      occurrences,
      organizationCount: orgIds.size,
      customerVisible: group.some((item) => item.customerVisible),
      firstSeenAt: firstSeenAt.toISOString(),
      lastSeenAt: lastSeenAt.toISOString(),
      summary: buildAggregateSummary({
        module: first.module,
        errorCode: first.errorCode,
        occurrences,
        organizationCount: orgIds.size,
        autoHealed: group.every((item) => item.autoHealed && item.status === "resolved"),
      }),
    });
  }

  return aggregates.sort((a, b) => b.occurrences - a.occurrences || severityRank(b.severity) - severityRank(a.severity));
}

export function buildAggregateSummary(input: {
  module: string;
  errorCode: string;
  occurrences: number;
  organizationCount: number;
  autoHealed?: boolean;
}): string {
  const n = input.occurrences;
  if (input.errorCode === "SCAN_JOB_STUCK" || input.errorCode === "LEGACY_SCANLOG_ZOMBIE") {
    return input.autoHealed
      ? `${n} scan jobs were stuck and auto-recovered.`
      : `${n} scan jobs are stuck.`;
  }
  if (input.errorCode === "STALE_TIMEOUT_BANNER") {
    return `${input.organizationCount || 1} organization(s) saw a stale timeout banner.`;
  }
  if (input.module === "whatsapp") {
    return `${n} WhatsApp webhook failures in the observed window.`;
  }
  if (input.module === "document_review") {
    return `${n} document approval failure(s) today.`;
  }
  return `${n} ${input.module} incidents (${input.errorCode}).`;
}

function severityRank(severity: ReliabilityCenterSeverity): number {
  switch (severity) {
    case "critical":
      return 4;
    case "error":
      return 3;
    case "warning":
      return 2;
    default:
      return 1;
  }
}

export function computeOverallHealthScore(input: {
  openCritical: number;
  openCustomerVisible: number;
  openErrors: number;
  stuckJobs: number;
}): number {
  let score = 100;
  score -= input.openCritical * 25;
  score -= input.openCustomerVisible * 10;
  score -= input.openErrors * 5;
  score -= input.stuckJobs * 8;
  return Math.max(0, Math.min(100, score));
}

export function buildHebrewReliabilitySummary(report: Omit<ReliabilityHealthReport, "hebrewSummary">): string {
  if (report.overallStatus === "healthy" && report.openCriticalIssues === 0) {
    const healed =
      report.autoHealedIssues > 0
        ? `\nב-24 השעות האחרונות תוקנו אוטומטית ${report.autoHealedIssues} אירועים.`
        : "";
    return `המערכת תקינה.\nאין תקלות קריטיות פתוחות.${healed}`;
  }

  const lines = [
    report.overallStatus === "unhealthy" ? "מצב המערכת: לא תקין." : "מצב המערכת: ירוד.",
    `ציון בריאות: ${report.overallHealthScore}/100.`,
    `תקלות קריטיות פתוחות: ${report.openCriticalIssues}.`,
    `בעיות גלויות ללקוח: ${report.customerVisibleIssues}.`,
  ];
  if (report.stuckJobs > 0) lines.push(`עבודות תקועות: ${report.stuckJobs}.`);
  if (report.autoHealedIssues > 0) {
    lines.push(`ב-24 השעות האחרונות תוקנו אוטומטית ${report.autoHealedIssues} אירועים.`);
  }
  if (report.aggregates[0]) lines.push(`התרעה מובילה: ${report.aggregates[0].summary}`);
  return lines.join("\n");
}

export async function buildReliabilityHealthReport(input?: {
  organizationId?: string | null;
  now?: Date;
}): Promise<ReliabilityHealthReport> {
  const now = input?.now ?? new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const organizationId = input?.organizationId ?? null;

  const [openEvents, recentEvents, autoHealedCount, stuckSyncLogs, stuckLegacyScans] = await Promise.all([
    listOpenReliabilityEvents({ organizationId: organizationId ?? undefined, take: 200 }),
    prisma.reliabilityEvent.findMany({
      where: {
        lastSeenAt: { gte: since24h },
        ...(organizationId ? { organizationId } : {}),
      },
      orderBy: { lastSeenAt: "desc" },
      take: 500,
    }),
    prisma.reliabilityEvent.count({
      where: {
        autoHealed: true,
        resolvedAt: { gte: since24h },
        ...(organizationId ? { organizationId } : {}),
      },
    }),
    prisma.syncLog.count({
      where: {
        type: "gmail_scan",
        status: { in: ["queued", "running"] },
        finishedAt: null,
        startedAt: { lt: new Date(now.getTime() - 30 * 60 * 1000) },
        ...(organizationId ? { organizationId } : {}),
      },
    }),
    prisma.scanLog.count({
      where: {
        status: "running",
        startedAt: { lt: new Date(now.getTime() - 30 * 60 * 1000) },
        ...(organizationId ? { orgId: organizationId } : {}),
      },
    }),
  ]);

  const recentMapped = recentEvents.map((row) => ({
    ...row,
    severity: row.severity as ReliabilityCenterSeverity,
    status: row.status as "open" | "resolved",
  }));

  const openCriticalIssues = openEvents.filter((event) => event.severity === "critical").length;
  const customerVisibleIssues = openEvents.filter((event) => event.customerVisible).length;
  const openErrors = openEvents.filter((event) => event.severity === "error" || event.severity === "critical").length;
  const stuckJobs = stuckSyncLogs + stuckLegacyScans;
  const overallHealthScore = computeOverallHealthScore({
    openCritical: openCriticalIssues,
    openCustomerVisible: customerVisibleIssues,
    openErrors,
    stuckJobs,
  });
  const overallStatus =
    overallHealthScore >= 85 ? "healthy" : overallHealthScore >= 60 ? "degraded" : "unhealthy";

  const aggregates = aggregateReliabilityAlerts([
    ...openEvents,
    ...recentMapped.filter((event) => event.status === "resolved" && event.autoHealed),
  ]);

  const base = {
    generatedAt: now.toISOString(),
    organizationId,
    overallHealthScore,
    overallStatus: overallStatus as "healthy" | "degraded" | "unhealthy",
    openCriticalIssues,
    customerVisibleIssues,
    stuckJobs,
    scanHealth: moduleHealth(openEvents, "gmail_scan"),
    whatsappHealth: moduleHealth(openEvents, "whatsapp"),
    invoiceApprovalHealth: moduleHealth(openEvents, "document_review"),
    oauthHealth: moduleHealth(openEvents, "oauth"),
    last24hErrorCounts: countBySeverity(recentMapped),
    autoHealedIssues: autoHealedCount,
    unresolvedIssues: openEvents.length,
    openEvents: openEvents.slice(0, 50).map((event) => ({
      id: event.id,
      module: event.module,
      severity: event.severity,
      errorCode: event.errorCode,
      userVisibleMessage: event.userVisibleMessage,
      occurrences: event.occurrences,
      customerVisible: event.customerVisible,
      lastSeenAt: event.lastSeenAt.toISOString(),
    })),
    aggregates: aggregates.slice(0, 25),
  };

  return {
    ...base,
    hebrewSummary: buildHebrewReliabilitySummary(base),
  };
}
