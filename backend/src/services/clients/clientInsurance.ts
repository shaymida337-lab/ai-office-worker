/**
 * Client insurance profile (insurance-agent module, phase 1).
 * Client.insuranceJson holds ONLY insured-person details.
 * Policy fields (company, number, renewal, …) belong to a future policies model — not here.
 */

export const CLIENT_INSURANCE_FIELDS = [
  "dateOfBirth",
  "nationalId",
  "nationalIdIssueDate",
  "residenceAddress",
  "city",
  "zipCode",
  "generalNotes",
] as const;

export type ClientInsuranceField = (typeof CLIENT_INSURANCE_FIELDS)[number];

export type ClientInsuranceProfile = {
  [K in ClientInsuranceField]?: string | null;
};

export const CLIENT_INSURANCE_FIELD_LABEL_HE: Record<ClientInsuranceField, string> = {
  dateOfBirth: "תאריך לידה",
  nationalId: "תעודת זהות",
  nationalIdIssueDate: "תאריך הנפקת תעודת זהות",
  residenceAddress: "כתובת מגורים",
  city: "עיר",
  zipCode: "מיקוד",
  generalNotes: "הערות כלליות",
};

const EMPTY_DISPLAY = "לא הוזן";

export function isClientInsuranceField(value: unknown): value is ClientInsuranceField {
  return typeof value === "string" && (CLIENT_INSURANCE_FIELDS as readonly string[]).includes(value);
}

export function emptyInsuranceProfile(): ClientInsuranceProfile {
  const profile: ClientInsuranceProfile = {};
  for (const key of CLIENT_INSURANCE_FIELDS) profile[key] = null;
  return profile;
}

export function parseInsuranceJson(raw: unknown): ClientInsuranceProfile {
  const profile = emptyInsuranceProfile();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return profile;
  const source = raw as Record<string, unknown>;
  for (const key of CLIENT_INSURANCE_FIELDS) {
    const value = source[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      profile[key] = trimmed || null;
    } else if (value == null) {
      profile[key] = null;
    }
  }
  return profile;
}

/** Merge patch into existing JSON; empty string clears a field. Drops legacy policy keys. */
export function mergeInsuranceProfile(
  current: unknown,
  patch: Partial<ClientInsuranceProfile>
): ClientInsuranceProfile {
  const merged = parseInsuranceJson(current);
  for (const key of CLIENT_INSURANCE_FIELDS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === undefined) continue;
    if (value == null) {
      merged[key] = null;
      continue;
    }
    const trimmed = String(value).trim();
    merged[key] = trimmed || null;
  }
  return merged;
}

export function insuranceFieldValue(
  profile: ClientInsuranceProfile,
  field: ClientInsuranceField
): string | null {
  const value = profile[field]?.trim();
  return value || null;
}

export function formatInsuranceFieldDisplay(
  profile: ClientInsuranceProfile,
  field: ClientInsuranceField
): string {
  return insuranceFieldValue(profile, field) ?? EMPTY_DISPLAY;
}

export function insuranceProfileToJson(profile: ClientInsuranceProfile): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of CLIENT_INSURANCE_FIELDS) {
    out[key] = profile[key] ?? null;
  }
  return out;
}
