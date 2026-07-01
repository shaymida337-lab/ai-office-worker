/** Central guard: BLOCKED document outcomes must never create financial persistence. */

export function outcomeStatusFromParsed(parsedFieldsJson: unknown): string | null {
  if (!parsedFieldsJson || typeof parsedFieldsJson !== "object" || Array.isArray(parsedFieldsJson)) {
    return null;
  }
  const status = (parsedFieldsJson as { outcome?: { status?: unknown } }).outcome?.status;
  return typeof status === "string" ? status.toUpperCase() : null;
}

export function isBlockedDocumentOutcome(
  parsedFieldsJson?: unknown,
  uncertaintyReason?: string | null,
): boolean {
  const outcomeStatus = outcomeStatusFromParsed(parsedFieldsJson);
  if (outcomeStatus === "BLOCKED") return true;
  const uncertainty = uncertaintyReason?.toLowerCase() ?? "";
  return uncertainty.includes("outcome_blocked") || uncertainty.includes("oe_trust_blocked");
}

export const BLOCKED_OUTCOME_PERSISTENCE_REASON = "outcome.blocked_no_persistence";
