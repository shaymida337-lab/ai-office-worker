import { Router } from "express";
import { cronMiddleware } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

export const cronRouter = Router();
cronRouter.use(cronMiddleware);

cronRouter.post("/gmail-sync-all", async (_req, res) => {
  console.log("[cron/gmail-sync-all] start");
  const orgs = await prisma.organization.findMany({
    include: { integrations: true },
  });
  const results = [];
  for (const org of orgs) {
    const hasGmail = org.integrations.some((i) => i.provider === "gmail" && i.refreshToken);
    if (!hasGmail) {
      console.log(`[cron/gmail-sync-all] skip org=${org.id} reason=no_gmail_refresh_token`);
      continue;
    }
    try {
      const { syncGmailForOrganization } = await import("../services/gmail-sync.js");
      const r = await syncGmailForOrganization(org.id);
      console.log(
        `[cron/gmail-sync-all] org=${org.id} fetched=${r.emailsProcessed ?? 0} parsed=${r.emailsParsed ?? 0} saved=${r.emailsSavedToGmailScanItem ?? 0} driveUploaded=${r.driveUploadsSucceeded ?? 0} rejected=${r.parserRejectedCount ?? r.ignoredCount ?? 0} rejectedReasons=${JSON.stringify(r.ignoredReasons ?? {})}`
      );
      results.push({ organizationId: org.id, ...r });
    } catch (err) {
      console.error(`[cron/gmail-sync-all] org=${org.id} failed`, err);
      results.push({
        organizationId: org.id,
        error: err instanceof Error ? err.message : "error",
      });
    }
  }
  const totals = results.reduce(
    (acc, result) => {
      acc.messagesFetched += "emailsProcessed" in result ? result.emailsProcessed ?? 0 : 0;
      acc.parsed += "emailsParsed" in result ? result.emailsParsed ?? 0 : 0;
      acc.saved += "emailsSavedToGmailScanItem" in result ? result.emailsSavedToGmailScanItem ?? 0 : 0;
      acc.uploadedToDrive += "driveUploadsSucceeded" in result ? result.driveUploadsSucceeded ?? 0 : 0;
      acc.rejected += "parserRejectedCount" in result ? result.parserRejectedCount ?? result.ignoredCount ?? 0 : 0;
      if ("ignoredReasons" in result && result.ignoredReasons) {
        for (const [reason, count] of Object.entries(result.ignoredReasons)) {
          acc.rejectedReasons[reason] = (acc.rejectedReasons[reason] ?? 0) + count;
        }
      }
      return acc;
    },
    {
      messagesFetched: 0,
      parsed: 0,
      saved: 0,
      uploadedToDrive: 0,
      rejected: 0,
      rejectedReasons: {} as Record<string, number>,
    }
  );
  console.log(
    `[cron/gmail-sync-all] final messagesFetched=${totals.messagesFetched} parsed=${totals.parsed} saved=${totals.saved} uploadedToDrive=${totals.uploadedToDrive} rejected=${totals.rejected} rejectedReasons=${JSON.stringify(totals.rejectedReasons)}`
  );
  res.json({ results, totals });
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

/** Read-only remediation helper: live Gmail mailbox profile per integration. No DB writes. */
cronRouter.get("/gmail-mailbox-verification", async (_req, res) => {
  const {
    verifyAllGmailMailboxesReadOnly,
    proposeCanonicalMailboxMapping,
    CONTAMINATED_CLUSTER_ORG_IDS,
  } = await import("../services/gmailMailboxVerification.js");

  const verification = await verifyAllGmailMailboxesReadOnly();
  const canonicalProposal = proposeCanonicalMailboxMapping(verification);

  res.json({
    readOnly: true,
    verifiedAt: new Date().toISOString(),
    contaminatedClusterOrganizationIds: CONTAMINATED_CLUSTER_ORG_IDS,
    verificationTable: verification.rows.map((row) => ({
      ...row,
      inContaminatedCluster: CONTAMINATED_CLUSTER_ORG_IDS.includes(
        row.organizationId as (typeof CONTAMINATED_CLUSTER_ORG_IDS)[number]
      ),
    })),
    sharedRefreshTokenHashes: verification.sharedRefreshTokenHashes,
    sharedMailboxEmails: verification.sharedMailboxEmails,
    canonicalMappingProposal: canonicalProposal,
  });
});
