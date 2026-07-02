export type YourDayActionKey =
  | "appointment"
  | "payment_overdue"
  | "payment_pending"
  | "document_review"
  | "open_task"
  | "monthly_report"
  | "all_clear";

/** Central route map for Today row navigation — do not duplicate in components. */
export const YOUR_DAY_ROUTE_MAP: Record<Exclude<YourDayActionKey, "all_clear">, string> = {
  appointment: "/dashboard/calendar",
  payment_overdue: "/payments",
  payment_pending: "/payments",
  document_review: "/dashboard/document-reviews",
  open_task: "/tasks",
  monthly_report: "/dashboard/accountant",
};

export function resolveYourDayHref(actionKey: YourDayActionKey): string | null {
  if (actionKey === "all_clear") return null;
  return YOUR_DAY_ROUTE_MAP[actionKey];
}

export function isYourDayItemActionable(actionKey: YourDayActionKey): boolean {
  return resolveYourDayHref(actionKey) != null;
}
