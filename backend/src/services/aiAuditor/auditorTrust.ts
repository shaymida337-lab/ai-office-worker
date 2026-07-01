import type { AuditorFullReport } from "./auditorTypes.js";

export function buildAuditorTrustContribution(report: AuditorFullReport) {
  return {
    contributesToTrustScore: report.auditor.auditorDecision === "PASS",
    contributesToDecisionEvidence: true,
    auditorDecision: report.auditor.auditorDecision,
    auditorConfidence: report.auditor.auditorConfidence,
    agreesWithPrimary: report.comparison.agrees,
    differenceCount: report.comparison.differences.length,
  };
}

export function auditorReportForDecisionEvidence(report: AuditorFullReport) {
  return {
    primary: {
      supplierName: report.primary.supplierName,
      amount: report.primary.amount,
      confidenceScore: report.primary.confidenceScore,
      documentType: report.primary.documentType,
    },
    auditor: {
      decision: report.auditor.auditorDecision,
      confidence: report.auditor.auditorConfidence,
      explanation: report.auditor.explanation,
      findings: report.auditor.findings,
    },
    comparison: report.comparison,
    recommendation: report.recommendation,
  };
}
