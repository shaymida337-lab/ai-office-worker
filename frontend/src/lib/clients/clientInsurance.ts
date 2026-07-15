/**
 * Client insurance profile helpers for the client-card "ביטוח" tab (phase 1).
 * Only insured-person fields live on Client.insuranceJson.
 * Policy list UI/data comes in a later phase — keep this surface ready without embedding policies here.
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

export const INSURANCE_EMPTY_LABEL = "לא הוזן";

/** Insured-person fields shown on the ביטוח tab (not policies). */
export const INSURANCE_PERSONAL_FIELDS: Array<{
  key: ClientInsuranceField;
  label: string;
  multiline?: boolean;
}> = [
  { key: "dateOfBirth", label: "תאריך לידה" },
  { key: "nationalId", label: "תעודת זהות" },
  { key: "nationalIdIssueDate", label: "תאריך הנפקת תעודת זהות" },
  { key: "residenceAddress", label: "כתובת מגורים", multiline: true },
  { key: "city", label: "עיר" },
  { key: "zipCode", label: "מיקוד" },
  { key: "generalNotes", label: "הערות כלליות", multiline: true },
];

export function emptyInsuranceForm(): ClientInsuranceProfile {
  const profile: ClientInsuranceProfile = {};
  for (const key of CLIENT_INSURANCE_FIELDS) profile[key] = "";
  return profile;
}

export function parseClientInsurance(raw: unknown): ClientInsuranceProfile {
  const profile = emptyInsuranceForm();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return profile;
  const source = raw as Record<string, unknown>;
  for (const key of CLIENT_INSURANCE_FIELDS) {
    const value = source[key];
    profile[key] = typeof value === "string" ? value : "";
  }
  return profile;
}

export function displayInsuranceValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : INSURANCE_EMPTY_LABEL;
}

export function buildInsuranceUpdatePayload(
  values: ClientInsuranceProfile
): { insurance: Record<string, string | null> } {
  const insurance: Record<string, string | null> = {};
  for (const key of CLIENT_INSURANCE_FIELDS) {
    const trimmed = values[key]?.trim() ?? "";
    insurance[key] = trimmed || null;
  }
  return { insurance };
}
