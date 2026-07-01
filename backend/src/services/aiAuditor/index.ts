export type {
  AuditorOutcome,
  AuditorEvidenceItem,
  AuditorFindingItem,
  PrimaryDecision,
  AuditorEvaluationInput,
  AuditorEvaluationResult,
  ComparisonDifference,
  ComparisonReport,
  AuditorFullReport,
  AuditorConfig,
} from "./auditorTypes.js";
export { AUDITOR_OUTCOMES } from "./auditorTypes.js";
export {
  DEFAULT_AUDITOR_CONFIG,
  loadAuditorConfig,
  parseAuditorConfigJson,
} from "./auditorConfig.js";
export type { AuditorConfigDb } from "./auditorConfig.js";
export { buildAuditorEvidence } from "./auditorEvidence.js";
export {
  comparePrimaryVsAuditor,
  detectComparisonDifferences,
  evaluateAuditorDecision,
} from "./comparisonEngine.js";
export { combineConfidenceWithAuditor } from "./confidenceIntegration.js";
export {
  evaluateAuditorReport,
  evaluateAndRecordAuditorReport,
} from "./auditorEngine.js";
export { recordAuditorEvaluationAudit } from "./auditorAudit.js";
export {
  emitAuditorReliabilityEvent,
  resetAuditorReliabilityDedupeForTests,
} from "./auditorReliability.js";
export {
  buildAuditorTrustContribution,
  auditorReportForDecisionEvidence,
} from "./auditorTrust.js";
export {
  buildAuditorInputFromEntity,
} from "./auditorEntityLoader.js";
export type { AuditorEntityType, AuditorEntityDb } from "./auditorEntityLoader.js";
