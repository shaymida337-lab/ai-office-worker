/**
 * תפעול לידים שיווקיים — אדמין פלטפורמה בלבד.
 * הגישה נקבעת ב-allowlist אימיילים (PLATFORM_ADMIN_EMAILS): roles של
 * ה-RBAC הם פר-ארגון (כל לקוח הוא owner בארגון שלו) ולכן אינם מתאימים
 * לשער על נתוני השיווק של נטלי עצמה.
 */

export const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export function isValidLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);
}

export function isPlatformAdmin(email: string | undefined, allowlist: readonly string[]): boolean {
  if (!email || allowlist.length === 0) return false;
  return allowlist.includes(email.trim().toLowerCase());
}

/** הודעת ההתראה על ליד חדש — ללא אימייל (מצמצם PII בערוץ ההודעות). */
export function buildLeadAlertMessage(
  lead: { name: string; phone: string; businessType: string; planInterest: string | null },
  adminUrl: string
): string {
  const plan =
    lead.planInterest === "growth"
      ? "נטלי מנהלת את המשרד (199₪)"
      : lead.planInterest === "starter"
        ? "נטלי לעסק (149₪)"
        : "לא נבחרה";
  return [
    "🎉 ליד חדש בנטלי!",
    `👤 ${lead.name}`,
    `📞 ${lead.phone}`,
    `💼 ${lead.businessType}`,
    `📦 חבילה: ${plan}`,
    "",
    `לפתיחת הליד: ${adminUrl}`,
  ].join("\n");
}

type SummaryDeps = {
  count: (where: Record<string, unknown>) => Promise<number>;
  latestCreatedAt: () => Promise<Date | null>;
};

export type LeadSummary = {
  newCount: number;
  today: number;
  week: number;
  month: number;
  qualified: number;
  converted: number;
  latestCreatedAt: string | null;
};

export async function computeLeadSummary(deps: SummaryDeps, now = new Date()): Promise<LeadSummary> {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

  const [newCount, today, week, month, qualified, converted, latest] = await Promise.all([
    deps.count({ status: "new" }),
    deps.count({ createdAt: { gte: startOfDay } }),
    deps.count({ createdAt: { gte: weekAgo } }),
    deps.count({ createdAt: { gte: monthAgo } }),
    deps.count({ status: "qualified" }),
    deps.count({ status: "converted" }),
    deps.latestCreatedAt(),
  ]);

  return {
    newCount,
    today,
    week,
    month,
    qualified,
    converted,
    latestCreatedAt: latest ? latest.toISOString() : null,
  };
}
