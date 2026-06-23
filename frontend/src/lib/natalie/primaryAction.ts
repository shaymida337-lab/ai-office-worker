import type { NataliePrimaryActionInput, NataliePrimaryActionModel, NatalieScreen } from "./types.js";

type RankedAction = NataliePrimaryActionModel & { priority: number };

const SCREEN_DEFAULTS: Record<NatalieScreen, NataliePrimaryActionModel> = {
  today: { label: "בוא נתחיל", intent: "start_today" },
  documents: { label: "אשר מסמכים", intent: "approve_documents", href: "/dashboard/document-reviews" },
  payments: { label: "אשר תשלומים", intent: "approve_payments", href: "/payments" },
  calendar: { label: "אשר פגישה", intent: "confirm_appointment", href: "/dashboard/calendar" },
  tasks: { label: "סגור משימות", intent: "close_tasks", href: "/tasks" },
  clients: { label: "עבור ללקוחות", intent: "open_clients", href: "/dashboard/clients" },
  invoices: { label: "אשר חשבוניות", intent: "approve_invoices", href: "/dashboard/invoices" },
};

export function resolvePrimaryAction(input: NataliePrimaryActionInput): NataliePrimaryActionModel {
  const ranked = rankPrimaryActions(input);
  ranked.sort((a, b) => b.priority - a.priority);
  return ranked[0] ?? SCREEN_DEFAULTS[input.screen];
}

export function rankPrimaryActions(input: NataliePrimaryActionInput): RankedAction[] {
  const actions: RankedAction[] = [];

  if (input.scanRunning) {
    actions.push({
      label: "אני עדיין עובדת",
      intent: "wait_for_scan",
      disabled: true,
      reason: "אני עדיין בודקת את המיילים שלך.",
      priority: 100,
    });
  }

  if (input.gmailConnected === false) {
    actions.push({
      label: "חברי את המייל",
      intent: "connect_gmail",
      href: "/dashboard/settings",
      priority: 95,
    });
  }

  const reviewCount = input.documentReviewCount ?? 0;
  if (reviewCount > 0) {
    actions.push({
      label: reviewCount === 1 ? "אשר מסמך אחד" : `אשר ${reviewCount} מסמכים`,
      intent: "approve_documents",
      href: "/dashboard/document-reviews",
      priority: 90,
    });
  }

  const missing = input.missingInvoiceCount ?? 0;
  if (missing > 0) {
    actions.push({
      label: "השלימי חשבוניות חסרות",
      intent: "resolve_missing_invoices",
      href: "/payments",
      priority: 80,
    });
  }

  const unpaid = input.unpaidPaymentCount ?? 0;
  if (unpaid > 0) {
    actions.push({
      label: unpaid === 1 ? "אשר תשלום אחד" : `אשר ${unpaid} תשלומים`,
      intent: "approve_payments",
      href: "/payments",
      priority: 70,
    });
  }

  const appointments = input.pendingAppointmentCount ?? 0;
  if (appointments > 0) {
    actions.push({
      label: appointments === 1 ? "אשר פגישה אחת" : `אשר ${appointments} פגישות`,
      intent: "confirm_appointment",
      href: "/dashboard/calendar",
      priority: 60,
    });
  }

  const tasks = input.openTaskCount ?? 0;
  if (tasks > 0) {
    actions.push({
      label: "סגור משימות פתוחות",
      intent: "close_tasks",
      href: "/tasks",
      priority: 50,
    });
  }

  actions.push({ ...SCREEN_DEFAULTS[input.screen], priority: 10 });
  return actions;
}
