export type FinanceGateName = "amount" | "supplier" | "fingerprint" | "duplicate";

export type FinanceGateSnapshot = {
  gate: FinanceGateName;
  verdict: string;
  reasonCode: string;
  engineVersion: string;
  [key: string]: unknown;
};

export function upsertFinanceGateSnapshot(
  parsedFieldsJson: Record<string, unknown>,
  snapshot: FinanceGateSnapshot
): void {
  const existing = Array.isArray(parsedFieldsJson.gates)
    ? parsedFieldsJson.gates.filter(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          (entry as { gate?: string }).gate !== snapshot.gate
      )
    : [];
  parsedFieldsJson.gates = [...existing, snapshot];
}

export function parseFinanceGateSnapshot<T extends FinanceGateSnapshot>(
  parsedFieldsJson: unknown,
  gate: FinanceGateName
): T | null {
  if (!parsedFieldsJson || typeof parsedFieldsJson !== "object" || parsedFieldsJson === null) {
    return null;
  }
  const gates = (parsedFieldsJson as { gates?: unknown }).gates;
  if (!Array.isArray(gates)) return null;
  for (const entry of gates) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (record.gate !== gate) continue;
    return record as T;
  }
  return null;
}
