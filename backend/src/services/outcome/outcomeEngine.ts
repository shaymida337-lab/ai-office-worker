import { buildOutcomeTimeline, resolveDocumentOutcomeStatus } from "./outcomeRules.js";
import type { DocumentOutcome, OutcomeEngineInput } from "./outcomeTypes.js";
import { OE_VERSION } from "./outcomeTypes.js";

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
