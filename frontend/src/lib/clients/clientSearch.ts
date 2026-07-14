/**
 * לוגיקת סינון אחת לחיפוש לקוחות — משמשת גם את החיפוש העליון (GlobalHeader)
 * וגם את החיפוש במסך הלקוחות, כדי שאותה לקוחה תימצא בשניהם באותה צורה.
 * התאמה לפי שם, אימייל וטלפון/וואטסאפ; מספרי טלפון מושווים גם כספרות בלבד,
 * כולל גישור בין פורמט מקומי (05...) לבינלאומי (+9725... / 9725...).
 */

export type SearchableClient = {
  name: string;
  email?: string | null;
  phone?: string | null;
  whatsappNumber?: string | null;
};

/** "050-123 4567" / "+972 50 123 4567" → צורה קנונית להשוואה: ללא 0/972 מוביל. */
function canonicalPhoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("972")) return digits.slice(3);
  return digits.replace(/^0+/, "");
}

export function clientMatchesQuery(client: SearchableClient, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;

  const text = `${client.name} ${client.email ?? ""} ${client.phone ?? ""} ${client.whatsappNumber ?? ""}`.toLowerCase();
  if (text.includes(query)) return true;

  // חיפוש לפי טלפון: מתעלמים ממקפים/רווחים/קידומת, כדי ש"0501234567"
  // ימצא לקוחה ששמורה כ-"+972501234567" ולהפך.
  const queryDigits = canonicalPhoneDigits(query);
  if (queryDigits.length >= 3) {
    const phones = [client.phone, client.whatsappNumber];
    if (phones.some((phone) => phone && canonicalPhoneDigits(phone).includes(queryDigits))) return true;
  }

  return false;
}

export function filterClientsByQuery<T extends SearchableClient>(clients: T[], query: string): T[] {
  return clients.filter((client) => clientMatchesQuery(client, query));
}
