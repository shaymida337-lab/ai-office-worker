import type { IntegrityReadOnlyDb } from "./integrityDb.js";
import { loadIntegrityOrgData, listOrganizationIds } from "./integrityDb.js";
import { dedupeFindings } from "./integrityRunnerUtils.js";
import { buildIntegrityOrgReport } from "./integrityScore.js";
import { buildIntegrityWatchReport } from "./integrityReport.js";
import { runAllIntegrityValidators } from "./integrityValidators.js";
import type { IntegrityRunOptions, IntegrityWatchReport } from "./integrityTypes.js";
import { INTEGRITY_READ_ONLY_GUARANTEE } from "./integrityTypes.js";

export async function runIntegrityWatchForOrganization(
  db: IntegrityReadOnlyDb,
  organizationId: string,
  options: Partial<IntegrityRunOptions> = {},
): Promise<IntegrityWatchReport> {
  assertReadOnlyGuarantee();
  const now = options.now ?? new Date();
  const data = await loadIntegrityOrgData(db, { organizationId, now });
  const { findings, ignored } = runAllIntegrityValidators(data);
  const orgReport = buildIntegrityOrgReport(organizationId, dedupeFindings(findings));

  return buildIntegrityWatchReport({
    mode: options.mode ?? "manual",
    dryRun: options.dryRun ?? false,
    organizationReports: [orgReport],
    generatedAt: now.toISOString(),
    ignored,
  });
}

export async function runIntegrityWatchGlobal(
  db: IntegrityReadOnlyDb,
  options: Partial<IntegrityRunOptions> = {},
): Promise<IntegrityWatchReport> {
  assertReadOnlyGuarantee();
  const now = options.now ?? new Date();
  const orgIds = await listOrganizationIds(db);
  const reports = [];
  const allIgnored = [];

  for (const organizationId of orgIds) {
    const data = await loadIntegrityOrgData(db, { organizationId, now });
    const { findings, ignored } = runAllIntegrityValidators(data);
    allIgnored.push(...ignored);
    reports.push(buildIntegrityOrgReport(organizationId, dedupeFindings(findings)));
  }

  return buildIntegrityWatchReport({
    mode: options.mode ?? "global",
    dryRun: options.dryRun ?? false,
    organizationReports: reports,
    generatedAt: now.toISOString(),
    ignored: allIgnored,
  });
}

export async function runIntegrityWatch(
  db: IntegrityReadOnlyDb,
  options: IntegrityRunOptions,
): Promise<IntegrityWatchReport> {
  assertReadOnlyGuarantee();

  if (options.organizationId) {
    return runIntegrityWatchForOrganization(db, options.organizationId, options);
  }

  if (options.mode === "global" || options.mode === "scheduled") {
    return runIntegrityWatchGlobal(db, options);
  }

  throw new Error("organizationId required for non-global integrity watch runs");
}

function assertReadOnlyGuarantee(): void {
  if (!INTEGRITY_READ_ONLY_GUARANTEE) {
    throw new Error("integrity watch must not mutate production data");
  }
}
