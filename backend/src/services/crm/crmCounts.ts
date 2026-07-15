import { prisma } from "../../lib/prisma.js";

/** Stages excluded from CRM “לקוחות פעילים” (matches frontend computeCrmKpis). */
export const CRM_INACTIVE_STAGES = ["הפסד", "סגור"] as const;

/** Same stale window as frontend `isStaleLead` / computeCrmKpis.unattended. */
export const CRM_STALE_MS = 48 * 60 * 60 * 1000;

/**
 * Single source of truth for CRM list KPI cards.
 * Must stay aligned with frontend/src/components/crm/crmHelpers.ts computeCrmKpis.
 */
export async function countCrmActiveCustomers(organizationId: string): Promise<number> {
  return prisma.lead.count({
    where: {
      organizationId,
      stage: { notIn: [...CRM_INACTIVE_STAGES] },
    },
  });
}

export async function countCrmNewLeads(organizationId: string): Promise<number> {
  return prisma.lead.count({
    where: { organizationId, stage: "חדש" },
  });
}

/** Leads with a nextReminderAt set — CRM “משימות פתוחות” KPI (not Task table). */
export async function countCrmOpenReminders(organizationId: string): Promise<number> {
  return prisma.lead.count({
    where: { organizationId, nextReminderAt: { not: null } },
  });
}

export async function countCrmUnattended(organizationId: string, now: Date = new Date()): Promise<number> {
  const staleBefore = new Date(now.getTime() - CRM_STALE_MS);
  return prisma.lead.count({
    where: {
      organizationId,
      OR: [{ lastContactAt: null }, { lastContactAt: { lt: staleBefore } }],
    },
  });
}

export type CrmListKpis = {
  activeCustomers: number;
  newLeads: number;
  openTasks: number;
  unattended: number;
};

export async function getCrmListKpis(
  organizationId: string,
  now: Date = new Date()
): Promise<CrmListKpis> {
  const [activeCustomers, newLeads, openTasks, unattended] = await Promise.all([
    countCrmActiveCustomers(organizationId),
    countCrmNewLeads(organizationId),
    countCrmOpenReminders(organizationId),
    countCrmUnattended(organizationId, now),
  ]);
  return { activeCustomers, newLeads, openTasks, unattended };
}
