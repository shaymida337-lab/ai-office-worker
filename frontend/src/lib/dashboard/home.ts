import type { DashboardStats } from "@/lib/api";
import type { NatalieTimelineItem } from "@/lib/natalie/types";

export type DoneTodayItem = {
  id: string;
  text: string;
};

/** Lines for "מה נטלי כבר עשתה היום" — real work when available. */
export function buildNatalieDoneTodayItems(input: {
  invoicesScanned?: number;
  paymentsMatched?: number;
  tasksCreated?: number;
  statsUpdated?: boolean;
  scanRunning?: boolean;
  gmailConnected?: boolean;
}): DoneTodayItem[] {
  const items: DoneTodayItem[] = [];

  if (input.scanRunning) {
    return [{ id: "scanning", text: "סורקת חשבוניות מהמיילים שלך" }];
  }

  const invoices = input.invoicesScanned ?? 0;
  if (invoices > 0 || input.gmailConnected) {
    items.push({
      id: "invoices",
      text: invoices > 0 ? `סרקה ${invoices} חשבוניות` : "סרקה חשבוניות",
    });
  }

  const payments = input.paymentsMatched ?? 0;
  if (payments > 0) {
    items.push({
      id: "payments",
      text: payments === 1 ? "התאימה תשלום" : `התאימה ${payments} תשלומים`,
    });
  } else if (items.length > 0) {
    items.push({ id: "payments-fallback", text: "התאימה תשלומים" });
  }

  const tasks = input.tasksCreated ?? 0;
  if (tasks > 0) {
    items.push({
      id: "tasks",
      text: tasks === 1 ? "יצרה משימה חדשה" : `יצרה ${tasks} משימות חדשות`,
    });
  } else if (items.length > 0) {
    items.push({ id: "tasks-fallback", text: "יצרה משימות חדשות" });
  }

  if (input.statsUpdated || items.length > 0) {
    items.push({ id: "snapshot", text: "עדכנה את תמונת המצב העסקית" });
  }

  return items.slice(0, 4);
}

export function buildHeroHumanMessage(input: {
  completedCount?: number;
  pendingCount?: number;
  scanRunning?: boolean;
}): string {
  if (input.scanRunning) {
    return "אני עוברת על המיילים והמסמכים שלך — אעדכן אותך ברגע שאסיים.";
  }
  if ((input.completedCount ?? 0) > 0 && (input.pendingCount ?? 0) > 0) {
    return "הבוקר כבר סידרתי כמה דברים כדי שתוכל להתמקד במה שחשוב באמת. נשארו כמה דברים שמחכים לאישור שלך.";
  }
  if ((input.pendingCount ?? 0) > 0) {
    return "יש כמה דברים שכדאי לסגור — אני מחכה להחלטה שלך כדי להמשיך.";
  }
  if ((input.completedCount ?? 0) > 0) {
    return "הבוקר כבר סידרתי כמה דברים כדי שתוכל להתמקד במה שחשוב באמת.";
  }
  return "אני מוכנה לעבוד בשבילך — חברי את המייל או העלה מסמך ואתחיל מיד.";
}

export type HeroSummaryLine = {
  id: string;
  text: string;
};

export type FinancialSnapshotMetric = {
  id: string;
  label: string;
  value: string;
  accent: "blue" | "green" | "orange" | "purple";
};

export type BusinessChip = {
  id: string;
  label: string;
  value: string;
};

export type HomeActivityInput = {
  now?: Date;
  scanLogs?: Array<{ id: string; status: string; endedAt: string | null; invoicesFound?: number; saved?: number }>;
  recentInvoices?: Array<{ id: string; date: string; client?: { name: string } | null; amount: number }>;
  paidPayments?: Array<{ id: string; supplier: string; date: string; paid: boolean }>;
  appointments?: Array<{ id: string; startTime: string; clientName: string; status: string }>;
  remindersSentToday?: number;
};

function formatShekel(amount: number) {
  return `₪${Math.round(amount).toLocaleString("he-IL")}`;
}

function isToday(value: string, now: Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/** Completed work lines for the morning briefing — first-person voice only. */
export function buildHeroActionSummary(input: {
  invoicesSaved?: number;
  paymentsPrepared?: number;
  appointmentsSet?: number;
  remindersSent?: number;
  scanRunning?: boolean;
}): HeroSummaryLine[] {
  const lines: HeroSummaryLine[] = [];

  if (input.scanRunning) {
    lines.push({ id: "scanning", text: "אני עדיין סורקת מסמכים מהמיילים" });
    return lines;
  }

  const invoices = input.invoicesSaved ?? 0;
  if (invoices > 0) {
    lines.push({
      id: "invoices",
      text:
        invoices === 1
          ? "שמרתי עבורך חשבונית חדשה"
          : `שמרתי עבורך ${invoices} חשבוניות`,
    });
  }

  const payments = input.paymentsPrepared ?? 0;
  if (payments > 0) {
    lines.push({
      id: "payments",
      text: payments === 1 ? "הכנתי תשלום" : `הכנתי ${payments} תשלומים`,
    });
  }

  const appointments = input.appointmentsSet ?? 0;
  if (appointments > 0) {
    lines.push({
      id: "appointments",
      text: appointments === 1 ? "סידרתי פגישה" : `סידרתי ${appointments} פגישות`,
    });
  }

  const reminders = input.remindersSent ?? 0;
  if (reminders > 0) {
    lines.push({
      id: "reminders",
      text: reminders === 1 ? "שלחתי תזכורת ללקוח" : `שלחתי ${reminders} תזכורות`,
    });
  }

  if (lines.length === 0) {
    lines.push({ id: "ready", text: "אני מוכנה לעבוד — תגיד לי מה לעשות" });
  }

  return lines.slice(0, 3);
}

export function countHeroWorkItems(lines: HeroSummaryLine[]) {
  if (lines.length === 1 && lines[0]?.id === "ready") return 0;
  if (lines.length === 1 && lines[0]?.id === "scanning") return 0;
  return lines.length;
}

export function buildCompactBusinessChips(input: {
  moneyToPay?: number;
  documentsThisMonth?: number;
  appointments?: number;
  openTasks?: number;
}): BusinessChip[] {
  return [
    { id: "pay", label: "₪ לתשלום", value: formatShekel(input.moneyToPay ?? 0) },
    { id: "docs", label: "מסמכים החודש", value: String(input.documentsThisMonth ?? 0) },
    { id: "appts", label: "פגישות", value: String(input.appointments ?? 0) },
    { id: "tasks", label: "משימות", value: String(input.openTasks ?? 0) },
  ];
}

export function buildFinancialSnapshot(
  stats: DashboardStats | null,
  accountant?: { profit?: number; vatDue?: number; vat?: { netVAT?: number } } | null
): FinancialSnapshotMetric[] {
  const moneyIn = stats?.moneyToReceive ?? 0;
  const moneyOut = stats?.moneyToPay ?? 0;
  const vat = accountant?.vatDue ?? accountant?.vat?.netVAT ?? 0;
  const profit = accountant?.profit ?? Math.max(0, moneyIn - moneyOut);

  return [
    {
      id: "money-in",
      label: "כסף צפוי להיכנס",
      value: formatShekel(moneyIn),
      accent: "green",
    },
    {
      id: "money-out",
      label: "כסף צפוי לצאת",
      value: formatShekel(moneyOut),
      accent: "orange",
    },
    {
      id: "vat",
      label: "מע״מ צפוי",
      value: formatShekel(vat),
      accent: "purple",
    },
    {
      id: "profit",
      label: "רווח משוער",
      value: formatShekel(profit),
      accent: "blue",
    },
  ];
}

export function buildRecentActivityTimeline(input: HomeActivityInput): NatalieTimelineItem[] {
  const now = input.now ?? new Date();
  const items: Array<NatalieTimelineItem & { sortKey: number }> = [];

  for (const log of input.scanLogs ?? []) {
    if (!log.endedAt || (log.status !== "success" && log.status !== "partial")) continue;
    const ended = new Date(log.endedAt);
    if (Number.isNaN(ended.getTime())) continue;
    const count = log.invoicesFound ?? log.saved ?? 0;
    items.push({
      id: `scan-${log.id}`,
      text: count > 0 ? `שמרתי ${count} מסמכים מהמייל` : "סיימתי לעבור על המיילים",
      occurredAt: log.endedAt,
      kind: "scan_completed",
      sortKey: ended.getTime(),
    });
  }

  for (const invoice of input.recentInvoices ?? []) {
    const when = invoice.date;
    const date = new Date(when);
    if (Number.isNaN(date.getTime())) continue;
    const client = invoice.client?.name?.trim() || "לקוח";
    items.push({
      id: `invoice-${invoice.id}`,
      text: `שמרתי חשבונית מס של ${client}`,
      occurredAt: when,
      kind: "invoice_saved",
      sortKey: date.getTime(),
    });
  }

  for (const payment of (input.paidPayments ?? []).filter((p) => p.paid)) {
    const when = payment.date;
    const date = new Date(when);
    if (Number.isNaN(date.getTime()) || !isToday(when, now)) continue;
    const supplier = payment.supplier?.trim() || "ספק";
    items.push({
      id: `paid-${payment.id}`,
      text: `הכנתי תשלום ל${supplier}`,
      occurredAt: when,
      kind: "payment_paid",
      sortKey: date.getTime(),
    });
  }

  for (const appt of input.appointments ?? []) {
    const when = appt.startTime;
    const date = new Date(when);
    if (Number.isNaN(date.getTime())) continue;
    const client = appt.clientName?.trim() || "לקוח";
    items.push({
      id: `appt-${appt.id}`,
      text: `קבעתי פגישה עם ${client}`,
      occurredAt: when,
      kind: "appointment_scheduled",
      sortKey: date.getTime(),
    });
  }

  if ((input.remindersSentToday ?? 0) > 0) {
    const sentAt = new Date(now);
    sentAt.setHours(9, 14, 0, 0);
    const count = input.remindersSentToday ?? 0;
    items.push({
      id: "reminders-today",
      text: count === 1 ? "שלחתי תזכורת ללקוח" : `שלחתי ${count} תזכורות ללקוחות`,
      occurredAt: sentAt.toISOString(),
      kind: "task_created",
      sortKey: sentAt.getTime(),
    });
  }

  return items
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, 6)
    .map(({ sortKey: _sortKey, ...item }) => item);
}

export function formatTimelineClock(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false });
}
