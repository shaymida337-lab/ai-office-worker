import type { DashboardStats } from "@/lib/api";
import type { NatalieTimelineItem } from "@/lib/natalie/types";

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

export function buildHeroActionSummary(input: {
  invoicesScanned?: number;
  appointmentsSet?: number;
  remindersSent?: number;
  pendingPayments?: number;
  missingDocuments?: number;
  scanRunning?: boolean;
}): HeroSummaryLine[] {
  const lines: HeroSummaryLine[] = [];

  if (input.scanRunning) {
    lines.push({ id: "scanning", text: "אני עדיין סורקת מסמכים מהמיילים" });
    return lines;
  }

  const invoices = input.invoicesScanned ?? 0;
  if (invoices > 0) {
    lines.push({
      id: "invoices",
      text: invoices === 1 ? "נסרקה חשבונית אחת" : `נסרקו ${invoices} חשבוניות`,
    });
  }

  const appointments = input.appointmentsSet ?? 0;
  if (appointments > 0) {
    lines.push({
      id: "appointments",
      text: appointments === 1 ? "נקבעה פגישה אחת" : `נקבעו ${appointments} פגישות`,
    });
  }

  const reminders = input.remindersSent ?? 0;
  if (reminders > 0) {
    lines.push({
      id: "reminders",
      text: reminders === 1 ? "נשלחה תזכורת ללקוח" : `נשלחו ${reminders} תזכורות ללקוחות`,
    });
  }

  const pending = input.pendingPayments ?? 0;
  if (pending > 0) {
    lines.push({
      id: "payments",
      text: pending === 1 ? "תשלום אחד ממתין לאישור" : `${pending} תשלומים ממתינים לאישור`,
    });
  }

  const missing = input.missingDocuments ?? 0;
  if (missing > 0) {
    lines.push({
      id: "missing",
      text: missing === 1 ? "נמצא מסמך אחד שחסר בו משהו" : `נמצאו ${missing} מסמכים שחסרים`,
    });
  }

  if (lines.length === 0) {
    lines.push({ id: "ready", text: "אני מוכנה לעבוד — תגיד לי מה לעשות" });
  }

  return lines.slice(0, 5);
}

export function countHeroWorkItems(lines: HeroSummaryLine[]) {
  if (lines.length === 1 && lines[0]?.id === "ready") return 0;
  if (lines.length === 1 && lines[0]?.id === "scanning") return 0;
  return lines.length;
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
      text: count > 0 ? `נסרקו ${count} מסמכים מהמייל` : "סיימתי לעבור על המיילים",
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
      text: `נסרקה חשבונית של ${client}`,
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
      text: `אושר תשלום ל${supplier}`,
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
      text: `נקבעה פגישה עם ${client}`,
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
      text: count === 1 ? "נשלחה תזכורת ללקוח" : `נשלחו ${count} תזכורות ללקוחות`,
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
