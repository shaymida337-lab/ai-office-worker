export type CalendarPrerequisite = {
  id: string;
  label: string;
  required?: boolean;
  passed?: boolean;
};

export function parsePrerequisites(raw: unknown): CalendarPrerequisite[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: String(item.id ?? ""),
      label: String(item.label ?? ""),
      required: item.required !== false,
      passed: item.passed === true,
    }))
    .filter((item) => item.id.length > 0);
}

export function allRequiredPrerequisitesPassed(raw: unknown): boolean {
  const items = parsePrerequisites(raw);
  const required = items.filter((item) => item.required !== false);
  if (required.length === 0) return true;
  return required.every((item) => item.passed === true);
}

export function markPrerequisitePassed(raw: unknown, prerequisiteId: string): CalendarPrerequisite[] {
  const items = parsePrerequisites(raw);
  let found = false;
  const next = items.map((item) => {
    if (item.id !== prerequisiteId) return item;
    found = true;
    return { ...item, passed: true };
  });
  if (!found) {
    throw new Error(`Prerequisite not found: ${prerequisiteId}`);
  }
  return next;
}

export function failedRequiredPrerequisites(raw: unknown): CalendarPrerequisite[] {
  return parsePrerequisites(raw).filter((item) => item.required !== false && item.passed !== true);
}
