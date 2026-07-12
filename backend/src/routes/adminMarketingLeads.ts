import { Router, type Request, type Response, type NextFunction } from "express";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import {
  computeLeadSummary,
  isPlatformAdmin,
  isValidLeadStatus,
  LEAD_STATUSES,
} from "../services/marketingLeads/leadAdminService.js";

/**
 * ניהול לידים שיווקיים — אדמין פלטפורמה בלבד (PLATFORM_ADMIN_EMAILS).
 * ה-router נטען בתוך apiRouter, כלומר אחרי authMiddleware — req.auth קיים.
 */

function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  const email = (req.auth as { email?: string } | undefined)?.email;
  if (!isPlatformAdmin(email, config.platformAdminEmails)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

export const adminMarketingLeadsRouter = Router();

adminMarketingLeadsRouter.use("/admin/marketing-leads", requirePlatformAdmin);

adminMarketingLeadsRouter.get("/admin/marketing-leads/summary", async (_req, res) => {
  const summary = await computeLeadSummary({
    count: (where) => prisma.marketingLead.count({ where }),
    latestCreatedAt: async () => {
      const latest = await prisma.marketingLead.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      return latest?.createdAt ?? null;
    },
  });
  res.json(summary);
});

adminMarketingLeadsRouter.get("/admin/marketing-leads", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const where = isValidLeadStatus(status) ? { status } : {};
  const leads = await prisma.marketingLead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ leads, statuses: LEAD_STATUSES });
});

adminMarketingLeadsRouter.get("/admin/marketing-leads/:id", async (req, res) => {
  const lead = await prisma.marketingLead.findUnique({
    where: { id: req.params.id },
    include: { events: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  res.json({ lead });
});

adminMarketingLeadsRouter.patch("/admin/marketing-leads/:id/status", async (req, res) => {
  const status = (req.body as { status?: unknown })?.status;
  if (!isValidLeadStatus(status)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }
  const email = (req.auth as { email?: string } | undefined)?.email ?? null;
  try {
    const lead = await prisma.marketingLead.update({
      where: { id: req.params.id },
      data: {
        status,
        events: {
          create: { type: "status_change", detail: status, createdBy: email },
        },
      },
    });
    res.json({ ok: true, lead });
  } catch {
    res.status(404).json({ error: "Lead not found" });
  }
});
