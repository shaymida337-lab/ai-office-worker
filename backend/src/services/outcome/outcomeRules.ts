import type { OutcomeEngineInput, OutcomeRuleResolution, OutcomeTimelineStep } from "./outcomeTypes.js";

const TIMELINE_STEP_NAMES = [
  "Received",
  "AI Analysis",
  "SCFC",
  "ARC",
  "SIR",
  "FSE",
  "Trust Engine",
  "Final Decision",
] as const;

function stepStatusFromEngine(input: {
  engine: OutcomeTimelineStep["engine"];
  moneyDecision: OutcomeEngineInput["moneyDecision"];
  supplierDecision: OutcomeEngineInput["supplierDecision"];
  fseDecision: OutcomeEngineInput["fseDecision"];
  fingerprint: OutcomeEngineInput["fingerprint"];
  trustDecision: OutcomeEngineInput["trustDecision"];
  pipelineError?: string | null;
}): OutcomeTimelineStep["status"] {
  switch (input.engine) {
    case "received":
      return input.pipelineError ? "failed" : "completed";
    case "ai":
      return input.pipelineError ? "failed" : "completed";
    case "scfc":
      if (!input.fingerprint?.fingerprint) return "warning";
      return input.fingerprint.isStrongEnoughForAutoSaveDedup ? "completed" : "warning";
    case "arc":
      if (input.moneyDecision.status === "resolved") return "completed";
      if (input.moneyDecision.status === "ambiguous" || input.moneyDecision.status === "missing") return "warning";
      return "failed";
    case "sir":
      if (input.supplierDecision.status === "resolved") return "completed";
      if (input.supplierDecision.status === "ambiguous" || input.supplierDecision.status === "missing") return "warning";
      return "failed";
    case "fse":
      if (input.fseDecision.overallStatus === "valid") return "completed";
      if (input.fseDecision.overallStatus === "warning") return "warning";
      return "failed";
    case "trust":
      if (input.trustDecision.decision === "AUTO_SAVE") return "completed";
      if (input.trustDecision.decision === "NEEDS_REVIEW") return "warning";
      return "failed";
    case "outcome":
      return "completed";
    default:
      return "completed";
  }
}

function stepExplanation(input: {
  engine: OutcomeTimelineStep["engine"];
  moneyDecision: OutcomeEngineInput["moneyDecision"];
  supplierDecision: OutcomeEngineInput["supplierDecision"];
  fseDecision: OutcomeEngineInput["fseDecision"];
  fingerprint: OutcomeEngineInput["fingerprint"];
  trustDecision: OutcomeEngineInput["trustDecision"];
  finalStatus: OutcomeRuleResolution["status"];
}): string {
  switch (input.engine) {
    case "received":
      return "Document entered Natalie processing pipeline.";
    case "ai":
      return "AI extracted supplier, amount, and document fields from the message.";
    case "scfc":
      return input.fingerprint?.fingerprint
        ? `Canonical fingerprint tier=${input.fingerprint.tier} fingerprint=${input.fingerprint.fingerprint}`
        : "No canonical fingerprint was produced for this document.";
    case "arc":
      return `ARC ${input.moneyDecision.status} (${input.moneyDecision.reasonCode}) amount=${input.moneyDecision.selectedAmount ?? "none"}`;
    case "sir":
      return `SIR ${input.supplierDecision.status} (${input.supplierDecision.reasonCode}) supplier="${input.supplierDecision.supplierName ?? "none"}"`;
    case "fse":
      return `FSE ${input.fseDecision.overallStatus} trustScore=${input.fseDecision.trustScore} failed=${input.fseDecision.failedRules.join(",") || "none"}`;
    case "trust":
      return `Trust ${input.trustDecision.decision} confidence=${input.trustDecision.confidence}% (${input.trustDecision.reasonCode})`;
    case "outcome":
      return `Final outcome=${input.finalStatus}`;
    default:
      return "Processed";
  }
}

export function buildOutcomeTimeline(
  input: OutcomeEngineInput,
  resolution: OutcomeRuleResolution
): OutcomeTimelineStep[] {
  const engines: OutcomeTimelineStep["engine"][] = [
    "received",
    "ai",
    "scfc",
    "arc",
    "sir",
    "fse",
    "trust",
    "outcome",
  ];

  return TIMELINE_STEP_NAMES.map((name, index) => {
    const engine = engines[index] ?? "outcome";
    const status =
      resolution.failedStage === name
        ? "failed"
        : stepStatusFromEngine({
            engine,
            moneyDecision: input.moneyDecision,
            supplierDecision: input.supplierDecision,
            fseDecision: input.fseDecision,
            fingerprint: input.fingerprint,
            trustDecision: input.trustDecision,
            pipelineError: input.context?.pipelineError,
          });

    return {
      name,
      status,
      explanation: stepExplanation({
        engine,
        moneyDecision: input.moneyDecision,
        supplierDecision: input.supplierDecision,
        fseDecision: input.fseDecision,
        fingerprint: input.fingerprint,
        trustDecision: input.trustDecision,
        finalStatus: resolution.status,
      }),
      engine,
      timestamp: null,
    };
  });
}

function duplicateIdentity(input: OutcomeEngineInput): string {
  return (
    input.context?.duplicateMatchIdentity?.trim() ||
    input.fingerprint?.fingerprint ||
    input.context?.reviewReason?.trim() ||
    "existing financial record"
  );
}

function isNotFinancialDocument(input: OutcomeEngineInput): boolean {
  const stage = input.context?.processingStage?.toLowerCase() ?? "";
  const reviewReason = input.context?.reviewReason?.toLowerCase() ?? "";
  if (stage === "not_financial" || reviewReason.includes("not_financial") || reviewReason.includes("filtered_irrelevant")) {
    return true;
  }
  const docType = input.context?.documentType?.toLowerCase() ?? "";
  if (docType === "quote" || docType === "supplier_message" || docType === "other" || docType === "irrelevant") {
    return true;
  }
  return (
    input.moneyDecision.status === "missing" &&
    input.supplierDecision.status === "missing" &&
    input.fseDecision.overallStatus === "valid" &&
    input.fseDecision.failedRules.length === 0
  );
}

export function resolveDocumentOutcomeStatus(input: OutcomeEngineInput): OutcomeRuleResolution {
  const ctx = input.context ?? {};

  if (ctx.pipelineError?.trim()) {
    const failedStage = ctx.processingStage?.trim() || "AI Analysis";
    return {
      status: "ERROR",
      reasonCode: "OE_PIPELINE_ERROR",
      reason: "Processing failed before a trusted outcome could be produced",
      headline: "Document processing failed",
      description: `Processing stopped at ${failedStage}: ${ctx.pipelineError.trim()}`,
      recommendedAction: "Retry processing or open the source email and process manually.",
      visibleToUser: true,
      failedStage,
    };
  }

  if (ctx.duplicateDetected) {
    const identity = duplicateIdentity(input);
    return {
      status: "DUPLICATE",
      reasonCode: "OE_DUPLICATE_DETECTED",
      reason: "Matching financial identity already exists",
      headline: "Duplicate document detected",
      description: `Natalie matched this document to an existing record: ${identity}`,
      recommendedAction: "No new record is needed. Review the existing document if amounts or dates differ.",
      visibleToUser: true,
      duplicateIdentity: identity,
    };
  }

  if (input.trustDecision.decision === "BLOCK") {
    return {
      status: "BLOCKED",
      reasonCode: "OE_TRUST_BLOCKED",
      reason: input.trustDecision.reason,
      headline: "Document blocked from automatic save",
      description: `Trust Engine blocked this document because FSE reported a critical issue (${input.trustDecision.reasonCode}). ${input.fseDecision.explanation}`,
      recommendedAction: "Review the financial sanity errors before approving or editing the document.",
      visibleToUser: true,
      blockingEngine: "trust",
    };
  }

  if (isNotFinancialDocument(input)) {
    return {
      status: "NOT_FINANCIAL",
      reasonCode: "OE_NOT_FINANCIAL",
      reason: "Document is not a payable financial record",
      headline: "Not a financial document",
      description:
        ctx.reviewReason?.trim() ||
        "Natalie did not find enough invoice or payment evidence to treat this message as a financial document.",
      recommendedAction: "No payment action is needed. Archive or ignore unless new evidence appears.",
      visibleToUser: true,
    };
  }

  if (input.trustDecision.decision === "NEEDS_REVIEW") {
    const why =
      ctx.reviewReason?.trim() ||
      input.trustDecision.explanation ||
      `Trust Engine requested review (${input.trustDecision.reasonCode}).`;
    return {
      status: "NEEDS_REVIEW",
      reasonCode: "OE_NEEDS_REVIEW",
      reason: input.trustDecision.reason,
      headline: "Document needs your review",
      description: why,
      recommendedAction: "Open the review queue, verify supplier, amount, and date, then approve or correct the document.",
      visibleToUser: true,
    };
  }

  return {
    status: "SAVED",
    reasonCode: "OE_SAVED",
    reason: input.trustDecision.reason,
    headline: "Document saved automatically",
    description: `Natalie trusted this document because ${input.trustDecision.explanation} Supplier="${input.supplierDecision.supplierName ?? "unknown"}", amount=${input.moneyDecision.selectedAmount ?? "unknown"}, fingerprint=${input.fingerprint?.fingerprint ?? "none"}.`,
    recommendedAction: "No action required unless you want to verify the saved supplier payment or invoice.",
    visibleToUser: true,
  };
}
