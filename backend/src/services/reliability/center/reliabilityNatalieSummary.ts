import { buildReliabilityHealthReport } from "./reliabilityHealthReport.js";

const SYSTEM_STATUS_PATTERNS = [
  /מה\s+מצב\s+המערכת/,
  /מצב\s+המערכת/,
  /system\s+status/i,
  /reliability\s+status/i,
  /מה\s+מצב\s+האמינות/,
];

export function isReliabilityStatusQuestion(question: string): boolean {
  const normalized = question.trim();
  if (!normalized) return false;
  return SYSTEM_STATUS_PATTERNS.some((pattern) => pattern.test(normalized));
}

export async function maybeBuildReliabilityStatusResponse(
  organizationId: string,
  question: string
): Promise<{ answer: string } | null> {
  if (!isReliabilityStatusQuestion(question)) return null;
  const report = await buildReliabilityHealthReport({ organizationId });
  return { answer: report.hebrewSummary };
}
