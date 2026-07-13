/**
 * Calendar Phase 1 — התאמת שם עובד מטקסט חופשי ("אצל יוסי") לעובדי הארגון.
 * טהור: מקבל את רשימת העובדים הפעילים ומחזיר את ההתאמות, מדויקות תחילה.
 */

export type NamedEmployee = { id: string; name: string };

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * סדר הכרעה: התאמה מלאה → שם פרטי/מילה שלמה → תחילית.
 * מחזיר את הרמה הראשונה שיש בה התאמות, כדי ש"יוסי" לא יתנגש עם
 * "יוסי לוי" ו"יוסיפה" יחד כשקיים עובד ששמו בדיוק "יוסי".
 */
export function matchEmployeesByName<T extends NamedEmployee>(employees: T[], query: string): T[] {
  const normalizedQuery = normalizeName(query);
  if (!normalizedQuery) return [];

  const exact = employees.filter((employee) => normalizeName(employee.name) === normalizedQuery);
  if (exact.length > 0) return exact;

  const wordMatch = employees.filter((employee) =>
    normalizeName(employee.name).split(" ").includes(normalizedQuery)
  );
  if (wordMatch.length > 0) return wordMatch;

  const prefixMatch = employees.filter((employee) =>
    normalizeName(employee.name).startsWith(normalizedQuery)
  );
  return prefixMatch;
}
