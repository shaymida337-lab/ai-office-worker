import type { IntegrityFinding } from "./integrityTypes.js";

export function dedupeFindings(findings: IntegrityFinding[]): IntegrityFinding[] {
  const seen = new Set<string>();
  const result: IntegrityFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.checkId}:${finding.entityId ?? "null"}:${finding.organizationId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(finding);
  }
  return result;
}
