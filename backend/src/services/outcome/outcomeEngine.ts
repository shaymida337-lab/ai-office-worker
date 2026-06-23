import { buildOutcomeTimeline, resolveDocumentOutcomeStatus } from "./outcomeRules.js";
import type { DocumentOutcome, OutcomeEngineInput } from "./outcomeTypes.js";
import { OE_VERSION } from "./outcomeTypes.js";

export function summarizeDocumentOutcome(outcome: DocumentOutcome) {
  return {
    version: outcome.version,
    status: outcome.status,
    headline: outcome.headline,
    description: outcome.description,
    reason: outcome.reason,
    reasonCode: outcome.reasonCode,
    recommendedAction: outcome.recommendedAction,
    timeline: outcome.timeline,
  };
}

export function computeDocumentOutcome(input: OutcomeEngineInput): DocumentOutcome {
  const resolution = resolveDocumentOutcomeStatus(input);
  const timeline = buildOutcomeTimeline(input, resolution);

  return {
    version: OE_VERSION,
    status: resolution.status,
    headline: resolution.headline,
    description: resolution.description,
    reason: resolution.reason,
    reasonCode: resolution.reasonCode,
    recommendedAction: resolution.recommendedAction,
    visibleToUser: resolution.visibleToUser,
    timeline,
  };
}
