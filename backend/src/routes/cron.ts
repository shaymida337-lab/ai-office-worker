import { Router } from "express";
import { cronMiddleware } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

export const cronRouter = Router();
cronRouter.use(cronMiddleware);

cronRouter.post("/gmail-sync-all", async (_req, res) => {
  const orgs = await prisma.organization.findMany({
    include: { integrations: true },
  });
  const results = [];
  for (const org of orgs) {
    const hasGmail = org.integrations.some((i) => i.provider === "gmail" && i.refreshToken);
    if (!hasGmail) continue;
    try {
      const { syncGmailForOrganization } = await import("../services/gmail-sync.js");
      const r = await syncGmailForOrganization(org.id);
      results.push({ organizationId: org.id, ...r });
    } catch (err) {
      results.push({
        organizationId: org.id,
        error: err instanceof Error ? err.message : "error",
      });
    }
  }
  res.json({ results });
});

cronRouter.post("/whatsapp-morning", async (_req, res) => {
  const orgs = await prisma.organization.findMany();
  for (const org of orgs) {
    const { sendDailySummary } = await import("../services/summary.js");
    await sendDailySummary(org.id, "morning");
  }
  res.json({ ok: true, count: orgs.length });
});

cronRouter.post("/whatsapp-evening", async (_req, res) => {
  const orgs = await prisma.organization.findMany();
  const { sendDailySummary } = await import("../services/summary.js");
  for (const org of orgs) {
    await sendDailySummary(org.id, "evening");
  }
  res.json({ ok: true, count: orgs.length });
});

cronRouter.post("/upcoming-alerts", async (_req, res) => {
  const orgs = await prisma.organization.findMany();
  for (const org of orgs) {
    const { checkUpcomingPaymentAlerts } = await import("../services/summary.js");
    await checkUpcomingPaymentAlerts(org.id);
  }
  res.json({ ok: true });
});
