/**
 * Centralized Hebrew response templates for Natalie's calendar commands.
 *
 * Every supported calendar reply (confirmation, success, clarification, not
 * found, conflict, list, empty) is built here so wording stays consistent and
 * Apple-clean. Rules: one short clarification question, no example times unless
 * strictly needed, no free-form LLM prose for supported commands.
 */

export type CalendarListEntry = {
  when: string;
  clientName: string;
  serviceName?: string;
};

export type CalendarSuccessDetails = {
  clientName: string;
  dayLabel: string;
  time: string;
  serviceName?: string | null;
  notes?: string | null;
};

/**
 * Format a day reference with a natural Hebrew preposition.
 * Relative days ("מחר", "היום") stay as-is; weekdays gain "ב" ("ביום חמישי");
 * explicit dates get a "ב-" prefix. Pure string formatting — no date math.
 */
export function formatDayLabel(dayReference: string): string {
  const day = dayReference.trim();
  if (!day) return "";
  if (["מחר", "מחרתיים", "היום", "אתמול"].includes(day)) return day;
  if (/^יום\s/u.test(day)) return `ב${day}`;
  if (/^ב/u.test(day)) return day;
  return `ב-${day}`;
}

export const calendarMessages = {
  // ---- Create ----
  createConfirmation(clientName: string, dayLabel: string, time: string): string {
    return `הבנתי שברצונך לקבוע פגישה עם ${clientName} ${formatDayLabel(dayLabel)} בשעה ${time}.\nלאשר?`;
  },
  createSuccess(details: CalendarSuccessDetails): string {
    const lines = [
      `קבעתי. הפגישה עם ${details.clientName} ${formatDayLabel(details.dayLabel)} בשעה ${details.time}.`,
    ];
    const service = details.serviceName?.trim();
    if (service) lines.push(`שירות: ${service}`);
    const notes = details.notes?.trim();
    if (notes) lines.push(`הערה: ${notes}`);
    return lines.join("\n");
  },
  createMissingCustomer(): string {
    return "לא הבנתי למי לקבוע את התור. מה שם הלקוח/ה?";
  },
  createMissingTime(whoSuffix: string): string {
    return `באיזו שעה לקבוע את התור${whoSuffix}?`;
  },
  createMissingDate(whoSuffix: string): string {
    return `לאיזה יום לקבוע את התור${whoSuffix}?`;
  },
  createUnclear(): string {
    return "לא הבנתי את הבקשה במלואה. אפשר לחזור עם שם הלקוח, היום והשעה?";
  },
  unsupportedCalendar(): string {
    return "לא הבנתי את הבקשה ליומן. אפשר לנסח שוב עם שם, יום ושעה?";
  },
  processingError(): string {
    return "סליחה, הייתה לי תקלה רגעית בטיפול בהודעה. אפשר לשלוח שוב?";
  },
  processingTimeout(): string {
    return "זה לוקח לי יותר מדי זמן כרגע. אפשר לשלוח שוב בעוד רגע?";
  },

  // ---- Cancel ----
  cancelMissingCustomer(): string {
    return "לא הבנתי למי לבטל. מה שם הלקוח/ה?";
  },
  cancelConfirmation(clientName: string, when: string): string {
    return `מצאתי תור ל${clientName} ב${when}. לבטל אותו?`;
  },
  cancelPronounNotFound(): string {
    return "לא מצאתי תור פעיל מהשיחה האחרונה. למי לבטל את התור?";
  },
  chooseCancel(clientName: string, list: string): string {
    return `מצאתי כמה תורים עתידיים ל${clientName}. איזה תור לבטל?\n${list}`;
  },
  cancelEmptyDay(dayReference: string): string {
    return `בדקתי את היומן שלך ולא מצאתי פגישות ב${dayReference}.`;
  },
  cancelAllConfirmation(dayReference: string, count: number, summary: string): string {
    return `מצאתי ${count} פגישות ב${dayReference}: ${summary}. לבטל את כולן?`;
  },
  cancelAllSuccess(count: number): string {
    return count === 1 ? "הפגישה בוטלה." : `ביטלתי ${count} פגישות.`;
  },
  bareYesWithoutPending(): string {
    return "לא הבנתי למה התכוונת. מה תרצי שאעשה ביומן?";
  },

  // ---- Move / reschedule ----
  rescheduleMissingCustomer(): string {
    return "לא הבנתי למי להעביר. מה שם הלקוח/ה?";
  },
  rescheduleMissingTime(): string {
    return "לאיזה שעה להעביר את התור?";
  },
  rescheduleMissingDate(): string {
    return "לאיזה יום להעביר את התור?";
  },
  rescheduleConfirmation(clientName: string, newWhen: string): string {
    return `להעביר את התור של ${clientName} ל${newWhen}?`;
  },
  rescheduleBadDatetime(): string {
    return "לא הבנתי לאיזה מועד להעביר. תגידי יום ושעה.";
  },
  reschedulePronounNotFound(): string {
    return "לא מצאתי תור פעיל מהשיחה האחרונה. לאיזה תור להעביר?";
  },
  chooseReschedule(clientName: string, list: string): string {
    return `מצאתי כמה תורים עתידיים ל${clientName}. איזה תור להעביר?\n${list}`;
  },

  // ---- Shared resolution ----
  notFoundNamed(spokenName: string): string {
    return `לא מצאתי תור שמתאים ל"${spokenName}". למי התכוונת?`;
  },
  noUpcomingForClient(clientName: string): string {
    return `אין תור עתידי ל${clientName}.`;
  },

  // ---- List / read ----
  listHeaderDay(dayReference: string): string {
    return `התורים שלך ל${dayReference}:`;
  },
  listHeaderWeek(): string {
    return "התורים שלך השבוע:";
  },
  listHeaderAll(): string {
    return "התורים הקרובים שלך:";
  },
  listEmptyDay(dayReference: string): string {
    return `אין לך תורים ל${dayReference}.`;
  },
  listEmptyWeek(): string {
    return "אין לך תורים השבוע.";
  },
  listEmptyAll(): string {
    return "אין לך תורים קרובים ביומן.";
  },
  /** Honest empty/partial copy when Google Calendar cannot be read. */
  listGoogleReadUnavailable(detail: string): string {
    return detail;
  },
  listEmptyWithGoogleWarning(empty: string, warning: string): string {
    return `${empty}\n\n${warning}`;
  },
  listWithGoogleWarning(header: string, entries: string, warning: string): string {
    return `${header}\n${entries}\n\n${warning}`;
  },
  listEntry(entry: CalendarListEntry): string {
    const service = entry.serviceName?.trim();
    return `• ${entry.when} — ${entry.clientName}${service ? ` (${service})` : ""}`;
  },
  listBlock(header: string, entries: CalendarListEntry[]): string {
    return `${header}\n${entries.map((entry) => calendarMessages.listEntry(entry)).join("\n")}`;
  },

  // ---- Availability ----
  availabilityOutsideHours(): string {
    return "השעה הזו מחוץ לשעות הפעילות (07:00–21:00).";
  },
  availabilityPast(): string {
    return "השעה הזו כבר עברה.";
  },
  availabilityBadDatetime(): string {
    return "לא הבנתי את התאריך או השעה. אפשר לנסות שוב עם יום ושעה ברורים, למשל מחר ב-10:00.";
  },
  availabilityCheckFailed(): string {
    return "לא הצלחתי לבדוק את הזמינות כרגע.";
  },
  availabilitySlotFree(label?: string | null): string {
    return `כן, השעה פנויה${label ? ` — ${label}` : ""}.`;
  },
  availabilitySlotTakenPrefix(conflictName?: string | null): string {
    const who = conflictName?.trim();
    return who
      ? `לא, השעה תפוסה (תור ל${who}). אלה זמנים חלופיים:`
      : "לא, השעה תפוסה. אלה זמנים חלופיים:";
  },
  availabilityEmpty(scope: string): string {
    return `לא מצאתי זמנים פנויים ב${scope}. אפשר לנסות יום אחר או טווח רחב יותר.`;
  },
  availabilitySlots(count: number, labels: string): string {
    return `מצאתי ${count} זמנים פנויים: ${labels}.`;
  },

  // ---- Ambiguous customer / appointment ----
  ambiguousCustomerNoMatch(query: string): string {
    return `לא מצאתי לקוח בשם "${query}".`;
  },
  ambiguousCustomerSameName(count: number, firstName: string, list: string): string {
    return `מצאתי ${count} לקוחות בשם ${firstName}. למי התכוונת?\n${list}`;
  },
  ambiguousCustomerDifferentNames(query: string, list: string): string {
    return `מצאתי כמה לקוחות שמתאימים ל״${query}״. למי התכוונת?\n${list}`;
  },
  ambiguousAppointment(spokenName: string, list: string): string {
    return `מצאתי כמה תורים שמתאימים ל"${spokenName}". למי התכוונת?\n${list}`;
  },
} as const;
