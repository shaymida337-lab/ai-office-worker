type BuildSmartSuggestionsInput = {
  gmailConnected?: boolean;
  scanRunning?: boolean;
  hasAppointmentsToday?: boolean;
  pendingPayments?: number;
  pendingDocuments?: number;
  monthEndApproaching?: boolean;
};

const BASE_SUGGESTIONS = ["מה דחוף היום?", "כמה אני צריך לשלם השבוע?"];

export function buildSmartSuggestions(input: BuildSmartSuggestionsInput): string[] {
  const suggestions: string[] = [];

  if (!input.gmailConnected) {
    suggestions.push("חבר את Gmail");
  } else if (input.scanRunning) {
    suggestions.push("הצג התקדמות סריקה");
  } else {
    suggestions.push("סרקי את Gmail");
  }

  if (input.hasAppointmentsToday) {
    suggestions.push("מי מגיע היום?");
  }

  if ((input.pendingPayments ?? 0) > 0) {
    suggestions.push("איזה תשלומים פתוחים?");
  }

  if ((input.pendingDocuments ?? 0) > 0) {
    suggestions.push("מה מחכה לאישור?");
  }

  if (input.monthEndApproaching) {
    suggestions.push("הכן חודש לרואה החשבון");
  }

  for (const item of BASE_SUGGESTIONS) {
    if (!suggestions.includes(item)) suggestions.push(item);
  }

  suggestions.push("תיצור לי משימה");

  return suggestions.slice(0, 5);
}

export function isMonthEndApproaching(now: Date = new Date()) {
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return now.getDate() >= lastDay - 4;
}
