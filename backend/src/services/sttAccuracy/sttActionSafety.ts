export type DetectedAction = {
  id: string;
  label: string;
  pattern: RegExp;
};

export const RISKY_ACTION_PATTERNS: DetectedAction[] = [
  { id: "approve_payment", label: "אישור תשלום", pattern: /(?:אשר(?:י)?\s+תשלום|לשלם|תשלמ(?:י|ו)|אישור\s+תשלום)/iu },
  { id: "send_message", label: "שליחת הודעה", pattern: /(?:שלח(?:י)?\s+הודעה|שלח(?:י)?\s+וואטסאפ|שלח(?:י)?\s+מייל)/iu },
  { id: "delete", label: "מחיקה", pattern: /(?:מחק(?:י)?|להסיר|למחוק)/iu },
  { id: "cancel_action", label: "ביטול פעולה", pattern: /(?:בטל(?:י)?\s+(?:תור|חשבונית|תשלום|משימה)|לבטל\s+(?:תור|חשבונית|תשלום))/iu },
  { id: "create_invoice", label: "יצירת חשבונית", pattern: /(?:הפק(?:י)?\s+חשבונית|צור(?:י)?\s+חשבונית|להפיק\s+חשבונית|טיוטת\s+חשבונית)/iu },
  { id: "schedule_meeting", label: "קביעת תור", pattern: /(?:קבע(?:י)?\s+(?:תור|פגישה)|לקבוע\s+(?:תור|פגישה)|תקבע(?:י)?\s+תור)/iu },
];

export function detectRiskyActions(text: string): string[] {
  return RISKY_ACTION_PATTERNS.filter((action) => action.pattern.test(text)).map((action) => action.id);
}

export function buildActionSafetyClarification(actionIds: string[]): string | null {
  if (actionIds.length === 0) return null;
  const labels = actionIds
    .map((id) => RISKY_ACTION_PATTERNS.find((action) => action.id === id)?.label)
    .filter(Boolean);
  if (labels.length === 0) return "לא בטוחה ששמעתי נכון. אפשר לחזור על הבקשה?";
  return `שמעתי בקשה ל${labels[0]}. לא בטוחה ששמעתי נכון — אפשר לאשר או לנסח שוב?`;
}
