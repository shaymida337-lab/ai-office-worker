import { Router, type Request, type Response } from "express";
import { createHash, randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import multer from "multer";
import type { Prisma } from "@prisma/client";
import { authMiddleware } from "../lib/auth.js";
import { config } from "../lib/config.js";
import { errorDetails } from "../lib/errors.js";
import { readRequestId } from "../lib/requestId.js";
import { databaseHost, prisma } from "../lib/prisma.js";
import { getDashboardStats, getMissingInvoicesReport } from "../services/dashboard.js";
import { getDashboardHomeMetrics } from "../services/dashboardHomeMetrics.js";
import {
  assertDashboardBootstrapPayloadBounds,
  classifyDashboardBootstrapFailure,
  getDashboardBootstrapCached,
} from "../services/dashboardBootstrap.js";
import {
  buildDashboardBootstrapServerTiming,
  computeUnaccountedMs as computeDashboardBootstrapUnaccountedMs,
  logDashboardBootstrapTimingSafe,
  type DashboardBootstrapEndpointTiming,
} from "../lib/dashboardBootstrapServerTiming.js";
import {
  assertInvoicesBootstrapPayloadBounds,
  getInvoicesBootstrap,
} from "../services/invoices/invoiceBootstrap.js";
import {
  getInvoicesBootstrapCacheGeneration,
  getInvoicesBootstrapInflight,
  invoicesBootstrapCacheKey,
  peekInvoicesBootstrapCache,
  setInvoicesBootstrapCache,
  setInvoicesBootstrapInflight,
  safeInvalidateInvoicesBootstrap,
} from "../services/invoices/invoiceBootstrapCache.js";
import {
  assertInvoicesListPayloadBounds,
  buildInvoicesListPayload,
  clampInvoiceListPage,
  clampInvoiceListPageSize,
  type InvoicesListSort,
} from "../services/invoices/invoiceList.js";
import {
  buildInvoicesServerTiming,
  computeInvoicesUnaccountedMs,
  isInvoicesBootstrapTimingPath,
  isInvoicesListTimingPath,
  logInvoicesTimingSafe,
  type InvoicesEndpointTiming,
} from "../lib/invoicesEndpointTiming.js";
import {
  assertCompletionBootstrapPayloadBounds,
  buildCompletionBootstrapPayload,
} from "../services/invoiceCompletion/completionBootstrap.js";
import {
  completionBootstrapCacheKey,
  getCompletionBootstrapCacheGeneration,
  getCompletionBootstrapInflight,
  peekCompletionBootstrapCache,
  setCompletionBootstrapCache,
  setCompletionBootstrapInflight,
  safeInvalidateCompletionBootstrap,
} from "../services/invoiceCompletion/completionBootstrapCache.js";
import {
  assertCompletionListPayloadBounds,
  buildCompletionListPayload,
  clampCompletionListPage,
  clampCompletionListPageSize,
  type CompletionListSort,
} from "../services/invoiceCompletion/completionList.js";
import {
  COMPLETION_SCAN_CHUNK,
  COMPLETION_SCAN_MAX_SOURCE_ROWS,
  scanCompletionQueueFromSources,
} from "../services/invoiceCompletion/completionQueueQuery.js";
import {
  buildCompletionServerTiming,
  computeCompletionUnaccountedMs,
  logCompletionTimingSafe,
  type InvoiceCompletionEndpointTiming,
} from "../lib/invoiceCompletionEndpointTiming.js";
import { safeInvalidateDashboardBootstrap } from "../services/dashboardBootstrapCache.js";
import {
  assertCalendarBootstrapPayloadBounds,
  getCalendarBootstrap,
} from "../services/calendarBootstrap.js";
import { listCalendarAppointmentsRange } from "../services/calendarAppointmentsList.js";
import {
  buildAppointmentsServerTiming,
  computeUnaccountedMs,
  isAppointmentsTimingPath,
  logAppointmentsEndpointTimingSafe,
  prismaSingletonActive,
  safeDatabaseTopology,
  type AppointmentsEndpointTiming,
} from "../lib/appointmentsEndpointTiming.js";
import { buildDailySummary } from "../services/summary.js";
import {
  getWhatsAppSettings,
  saveWhatsAppSettings,
  testWhatsAppConnection,
} from "../services/whatsapp.js";
import { createDocument, testConnection as testGreenInvoiceConnection, type GreenInvoiceEnv } from "../services/green-invoice.js";
import { issueDraftHandler } from "../services/greenInvoiceIssueHandler.js";
import type { IssueDraftInput } from "../services/greenInvoiceIssuer.js";
import { parseBankStatementFile } from "../services/bank-parser.js";
import { matchTransactions } from "../services/bank-matcher.js";
import { applyPaymentClassificationCleanup, buildPaymentClassificationDebug } from "../services/paymentClassificationDebug.js";
import { getBusinessTemplates, getOrganizationSettings, updateOrganizationBusinessSettings } from "../services/businessTemplates.js";
import { approveFinancialDocumentReview, buildReviewDecision, evaluateReviewApprovalReadiness } from "../services/financialDocuments.js";
import { recordManualEntryFinancialDocument } from "../services/financialDocuments.js";
import { getDocumentReviewsHomeSummary } from "../services/documentReviewsHomeSummary.js";
import { resolveReviewSupplierContext } from "../services/reviewSupplierResolution.js";
import {
  invoiceAuditSnapshot,
  paymentAuditSnapshot,
  recordPlatformAudit,
  resolveWorkflowCorrelationId,
  reviewAuditSnapshot,
  userAuditContext,
} from "../services/auditLog/index.js";
import {
  pickInvoiceListPersistedTotalAmount,
  resolveDocumentReviewDisplayAmount,
  resolveInvoiceListDisplayAmount,
} from "../services/amount/financeDisplayAmount.js";
import {
  assessInvoiceCompleteness,
  filterInvoicesByCompleteness,
  filterInvoiceCompletionQueueCandidates,
  isInvoiceRecordApproved,
  parseInvoiceCompletenessParam,
  type InvoiceCompletenessAssessment,
} from "../services/amount/invoiceCompleteness.js";
import {
  applyInvoiceCompletionFieldUpdates,
  approveInvoiceCompletionContext,
  loadInvoiceCompletionContext,
  mapCompletionErrorStatus,
  parseInvoiceCompletionSourceType,
  stripInvoiceCompletionId,
  validateApproveAllowed,
  type InvoiceCompletionContext,
  type InvoiceCompletionRequest,
} from "../services/invoiceCompletionAction.js";
import { initialConnectScanWindow, isHistoricalGmailScanRequest, resolveHistoricalGmailScanWindow } from "../services/scanWindow.js";
import {
  closeStaleGmailScansForOrg,
  reapOverdueLegacyScanLogsThrottled,
  createQueuedGmailScanLog,
  finalizeGmailScanFailed,
  findActiveGmailScanLog,
  findLastGmailScanSuccessCursor,
  logScanLifecycle,
  refreshGmailScanProgressOnRead,
  resolveIncrementalGmailScanWindow,
  toApiGmailScanStatus,
} from "../services/gmailScanLifecycle.js";
import { resolveDocumentsFound } from "../services/gmailScanProgressCounts.js";
import { isWithinBusinessDateWindow } from "../services/dates/businessDate.js";
import { resolveDriveLink } from "../services/drive/driveLinkResolver.js";
import { presentedReviewStatus, reviewCandidateStatusesForTab } from "../services/reviewStatusPolicy.js";
import { MAX_REASONABLE_FINANCIAL_AMOUNT } from "../services/financialAmountLimits.js";
import {
  getConversationSession,
  isConversationSessionExpired,
  processNatalieTurn,
} from "../services/conversation/index.js";
import { processVoiceTurn } from "../services/conversation/voice/index.js";
import { communicationService } from "../services/communication/communicationService.js";
import {
  recordVoiceCommunication,
  recordWebChatCommunication,
} from "../services/communication/recordCommunicationTrace.js";
import { completeTask, createTask } from "../services/tasks.js";
import {
  INVOICE_DRAFT_SAVED_CONFIRMATION_MESSAGE,
  deleteOutgoingInvoiceDraft,
  listOutgoingInvoiceDrafts,
  saveInvoiceDraft,
  saveInvoiceDraftsBatch,
  validateInvoiceDraftInput,
} from "../services/outgoingInvoiceDraft.js";
import { buildImportPreview } from "../services/importFilePreview.js";
import { buildInvoiceDraftsFromRows } from "../services/importInvoiceRows.js";
import { findDuplicateDrafts } from "../services/findDuplicateDrafts.js";
import type { ColumnMapping } from "../services/importColumnMapper.js";
import { adminMarketingLeadsRouter } from "./adminMarketingLeads.js";
import { synthesizeSpeech } from "../services/natalieTts.js";
import { transcribeAudio } from "../services/natalieStt.js";
import { buildWhisperPromptHint, loadSttVocabulary, processTranscriptAccuracy } from "../services/sttAccuracy/index.js";
import {
  APPOINTMENT_INCLUDE,
  AppointmentConflictError,
  createAppointmentForOrganization,
  deleteAppointmentForOrganization,
  findAppointmentsForLead,
  findClientByNameOrPhone,
  resolveAppointmentDateTime,
  updateAppointmentForOrganization,
} from "../services/appointmentService.js";
import { runAppointmentGoogleSync } from "../services/appointmentGoogleSync.js";
import { recordCalendarAudit } from "../services/calendar/calendarAudit.js";
import {
  bookAppointmentViaNatalie,
  cancelAppointmentViaNatalie,
  checkUnifiedSlotAvailability,
  findUnifiedAvailableSlots,
  rescheduleAppointmentViaNatalie,
  SchedulingFacadeError,
} from "../services/scheduling/schedulingFacade.js";
import { getBriefingSchedulingSnapshot } from "../services/scheduling/briefingSchedulingReader.js";
import { getSchedulingCapabilities } from "../services/scheduling/schedulingCapabilities.js";
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  idempotencyErrorResponse,
} from "../services/idempotency.js";
import {
  ACCURACY_ANALYTICS_ROUTE_PATH,
  getAccuracyAnalyticsForOrganization,
  parseAccuracyAnalyticsQuery,
} from "../services/analytics/accuracyAnalytics.js";
import {
  getVerificationCenterForOrganization,
  parseVerificationQuery,
  VERIFICATION_CENTER_ROUTE_PATH,
} from "../services/verification/verificationCenter.js";
import { calendarEngineRouter } from "./calendarEngineRoutes.js";
import { knowledgeRouter } from "./knowledgeRoutes.js";
import { businessMemoryRouter } from "./businessMemoryRoutes.js";
import { parseWallClockAwareDateTime } from "./calendarEngineValidation.js";
import { signLocalUploadUrlIfNeeded } from "./uploadsRoutes.js";
import { scannerHealthRouter } from "./scannerHealthRoutes.js";
import { reliabilityStatusRouter } from "./reliabilityStatusRoutes.js";
import { integrityWatchRouter } from "./dataIntegrityWatchRoutes.js";
import { auditLogRouter } from "./auditLogRoutes.js";
import { membershipRouter } from "./membershipRoutes.js";
import { confidenceRouter } from "./confidenceRoutes.js";
import { auditorRouter } from "./auditorRoutes.js";
import { releaseCertificateRouter } from "./releaseCertificateRoutes.js";
import { calendarReminderRouter } from "./calendarReminderRoutes.js";
import { checkPermission, forbiddenResponseBody, requirePerm } from "../services/rbac/index.js";
import { verifyLeadsWebhook } from "../lib/webhookAuth.js";
import { requireNonProduction } from "../lib/productionGuard.js";
import { secureRouteGuards } from "../middleware/secureRouteGuards.js";
import {
  financialDataContainmentMiddleware,
  validateTenantMiddleware,
} from "../middleware/tenantIsolation.js";
import {
  buildFinancialDocumentReviewReadIsolationWhere,
  buildGmailScanItemReadIsolationWhere,
  buildSupplierPaymentReadIsolationWhere,
  loadCrossOrgContaminatedGmailIdsForReads,
  mergePrismaWhere,
} from "../services/p0/financialReadIsolation.js";
import {
  ensureAppointmentReminderArtifacts,
  syncAppointmentAttendanceFromStatus,
} from "../services/reminders/reminderService.js";
import {
  beginVoiceTurnIdempotency,
  completeVoiceTurnIdempotency,
} from "../services/conversation/voice/voiceIdempotency.js";

export const apiRouter = Router();
const requireCalendarView = requirePerm("calendar.view");
const requireCalendarCreate = requirePerm("calendar.create");
const requireCalendarUpdate = requirePerm("calendar.update");
const requireCalendarCancel = requirePerm("calendar.cancel");
const requireCalendarReschedule = requirePerm("calendar.reschedule");

function routeId(req: Request, key = "id"): string {
  return String(req.params[key]);
}
const bankUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
const natalieAudioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

apiRouter.post("/leads/webhook", verifyLeadsWebhook, async (req, res) => {
  try {
    const { createCrmLead } = await import("../services/crm.js");
    const body = req.body as { organizationId: string; name?: string; phone?: string; email?: string; source?: string; message?: string };
    const organization = await prisma.organization.findUnique({ where: { id: body.organizationId } });
    if (!organization) {
      res.status(400).json({ error: "Organization not found" });
      return;
    }
    const lead = await createCrmLead(organization.id, {
      name: body.name,
      phone: body.phone,
      email: body.email,
      whatsapp: body.phone,
      source: body.source || "website",
      notes: body.message,
    });
    res.json({ lead });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Lead webhook failed" });
  }
});

apiRouter.get("/debug/payments/open-classification-inputs", requireNonProduction, async (req, res, next) => {
  const orgId = typeof req.query.orgId === "string" ? req.query.orgId.trim() : "";
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!orgId && !token) {
    next();
    return;
  }
  if (!orgId || !token || !config.debug.classificationInvestigationToken || token !== config.debug.classificationInvestigationToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    res.json(await buildOpenClassificationInputsDebug(orgId));
  } catch (err) {
    console.error("[debug/payments/open-classification-inputs/public] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Open supplier payment classification input debug failed" });
  }
});

apiRouter.use((req, res, next) => {
  if (isAppointmentsTimingPath(req.path)) {
    res.locals.appointmentsWallStart = performance.now();
  }
  next();
});
apiRouter.use(authMiddleware);
apiRouter.use(validateTenantMiddleware);
apiRouter.use(financialDataContainmentMiddleware);
apiRouter.use(secureRouteGuards);
apiRouter.use(calendarEngineRouter);
apiRouter.use(knowledgeRouter);
apiRouter.use(businessMemoryRouter);
apiRouter.use(scannerHealthRouter);
apiRouter.use(reliabilityStatusRouter);
apiRouter.use(integrityWatchRouter);
apiRouter.use(auditLogRouter);
apiRouter.use(adminMarketingLeadsRouter);
apiRouter.use(membershipRouter);
apiRouter.use(confidenceRouter);
apiRouter.use(auditorRouter);
apiRouter.use(releaseCertificateRouter);
apiRouter.use(calendarReminderRouter);

apiRouter.get("/business/templates", async (_req, res) => {
  res.json(getBusinessTemplates());
});

apiRouter.get("/organization/settings", async (req, res) => {
  res.json(await getOrganizationSettings(req.auth!.organizationId));
});

apiRouter.put("/organization/settings", requirePerm("organization.settings"), async (req, res) => {
  res.json(await updateOrganizationBusinessSettings(req.auth!.organizationId, req.body as Record<string, unknown>));
});

apiRouter.get("/settings/business-profile", async (req, res) => {
  const organization = await prisma.organization.findUnique({
    where: { id: req.auth!.organizationId },
    select: { businessProfile: true },
  });
  res.json({ businessProfile: organization?.businessProfile ?? "" });
});

apiRouter.put("/settings/business-profile", requirePerm("organization.settings"), async (req, res) => {
  const businessProfile = typeof req.body?.businessProfile === "string" ? req.body.businessProfile : "";
  const organization = await prisma.organization.update({
    where: { id: req.auth!.organizationId },
    data: { businessProfile },
    select: { businessProfile: true },
  });
  res.json({ businessProfile: organization.businessProfile ?? "" });
});

apiRouter.get("/gmail/scan-stats", async (req, res) => {
  const organizationId = req.auth!.organizationId;
  try {
    const [
      totalItems,
      documentTypes,
      reviewStatuses,
      recentItems,
      recentLogs,
      duplicatesSkipped,
      driveLinkedCount,
      amountExtractedCount,
      sheetsUpdatedTotal,
      rejectedEmailsCount,
    ] = await Promise.all([
      prisma.gmailScanItem.count({ where: { organizationId } }),
      prisma.gmailScanItem.groupBy({
        by: ["documentType"],
        where: { organizationId },
        _count: { _all: true },
      }),
      prisma.gmailScanItem.groupBy({
        by: ["reviewStatus"],
        where: { organizationId },
        _count: { _all: true },
      }),
      prisma.gmailScanItem.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          gmailMessageId: true,
          gmailMessageLink: true,
          sender: true,
          senderEmail: true,
          subject: true,
          occurredAt: true,
          amount: true,
          supplierName: true,
          documentType: true,
          attachmentFilename: true,
          driveFileLink: true,
          confidenceScore: true,
          reviewStatus: true,
          decisionReason: true,
          rawAnalysis: true,
          createdAt: true,
        },
      }),
      prisma.syncLog.findMany({
        where: { organizationId, type: "gmail_scan" },
        orderBy: { startedAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          scanMode: true,
          emailsProcessed: true,
          emailsSaved: true,
          invoicesFound: true,
          paymentsCreated: true,
          tasksCreated: true,
          driveUploaded: true,
          sheetsUpdated: true,
          errorsCount: true,
          windowTruncated: true,
          totalMatched: true,
          errorMessage: true,
          startedAt: true,
          finishedAt: true,
        },
      }),
      prisma.syncLog.aggregate({
        where: { organizationId, type: "gmail_scan" },
        _sum: { emailsProcessed: true, emailsSaved: true },
      }),
      prisma.gmailScanItem.count({ where: { organizationId, driveFileLink: { not: null } } }),
      prisma.gmailScanItem.count({ where: { organizationId, amount: { not: null } } }),
      prisma.syncLog.aggregate({
        where: { organizationId, type: "gmail_scan" },
        _sum: { sheetsUpdated: true },
      }),
      prisma.gmailScanItem.count({
        where: {
          organizationId,
          OR: [
            { reviewStatus: "needs_review" },
            { documentType: "unknown_needs_review" },
            { decisionReason: { contains: "blocked", mode: "insensitive" } },
            { decisionReason: { contains: "Held for review", mode: "insensitive" } },
          ],
        },
      }),
    ]);

    res.json({
      totals: {
        scanItems: totalItems,
        emailsProcessed: duplicatesSkipped._sum.emailsProcessed ?? 0,
        emailsSaved: duplicatesSkipped._sum.emailsSaved ?? 0,
        duplicatesSkipped: Math.max(0, (duplicatesSkipped._sum.emailsProcessed ?? 0) - (duplicatesSkipped._sum.emailsSaved ?? 0)),
        driveLinked: driveLinkedCount,
        amountExtracted: amountExtractedCount,
        sheetsUpdated: sheetsUpdatedTotal._sum.sheetsUpdated ?? 0,
        rejectedEmails: rejectedEmailsCount,
      },
      byDocumentType: Object.fromEntries(documentTypes.map((item) => [item.documentType, item._count._all])),
      byReviewStatus: Object.fromEntries(reviewStatuses.map((item) => [item.reviewStatus, item._count._all])),
      recentItems,
      recentLogs,
    });
  } catch (err) {
    console.error("[gmail/scan-stats]", errorDetails(err));
    res.status(500).json({ error: "טעינת סטטיסטיקות הסריקה נכשלה" });
  }
});

apiRouter.get("/gmail/invoice-diagnostics", async (req, res) => {
  const organizationId = req.auth!.organizationId;
  try {
    const latestScan = await prisma.syncLog.findFirst({
      where: { organizationId, type: "gmail_scan" },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        status: true,
        scanMode: true,
        emailsProcessed: true,
        invoicesFound: true,
        paymentsCreated: true,
        startedAt: true,
        finishedAt: true,
        errorMessage: true,
      },
    });

    const scanWindow = latestScan
      ? { gte: latestScan.startedAt, lte: latestScan.finishedAt ?? new Date() }
      : undefined;
    const itemWhere = {
      organizationId,
      ...(scanWindow ? { createdAt: scanWindow } : {}),
    };

    const scanItems = await prisma.gmailScanItem.findMany({
      where: itemWhere,
      orderBy: { createdAt: "desc" },
      take: 2000,
      select: {
        id: true,
        emailMessageId: true,
        sender: true,
        senderEmail: true,
        subject: true,
        documentType: true,
        attachmentFilename: true,
        confidenceScore: true,
        reviewStatus: true,
        decisionReason: true,
        rawAnalysis: true,
        amount: true,
        supplierName: true,
        createdAt: true,
      },
    });

    const emailIds = scanItems
      .map((item) => item.emailMessageId)
      .filter((id): id is string => Boolean(id));
    const [emailMessages, attachmentRows] = await Promise.all([
      emailIds.length
        ? prisma.emailMessage.findMany({
            where: { id: { in: emailIds }, organizationId },
            select: { id: true, bodyText: true, snippet: true, subject: true },
          })
        : Promise.resolve([]),
      emailIds.length
        ? prisma.emailAttachment.findMany({
            where: { emailMessageId: { in: emailIds } },
            select: { emailMessageId: true, filename: true, mimeType: true },
          })
        : Promise.resolve([]),
    ]);

    const emailById = new Map(emailMessages.map((email) => [email.id, email]));
    const attachmentsByEmailId = new Map<string, typeof attachmentRows>();
    for (const attachment of attachmentRows) {
      const existing = attachmentsByEmailId.get(attachment.emailMessageId) ?? [];
      existing.push(attachment);
      attachmentsByEmailId.set(attachment.emailMessageId, existing);
    }

    const diagnostics = scanItems.map((item) => {
      const email = item.emailMessageId ? emailById.get(item.emailMessageId) : null;
      const attachments = item.emailMessageId ? attachmentsByEmailId.get(item.emailMessageId) ?? [] : [];
      const rawAnalysis = item.rawAnalysis as { filenames?: unknown; hasAttachment?: unknown } | null;
      const rawFilenames = Array.isArray(rawAnalysis?.filenames)
        ? rawAnalysis.filenames.filter((filename): filename is string => typeof filename === "string" && filename.trim().length > 0)
        : [];
      const text = [
        item.subject,
        email?.subject,
        email?.snippet,
        email?.bodyText,
        item.attachmentFilename,
        attachments.map((attachment) => attachment.filename).join(" "),
        rawFilenames.join(" "),
        JSON.stringify(item.rawAnalysis ?? {}),
      ].filter(Boolean).join("\n");
      const lower = text.toLowerCase();
      const hasAttachment = Boolean(item.attachmentFilename || attachments.length > 0 || rawFilenames.length > 0 || rawAnalysis?.hasAttachment);
      const hasPdfAttachment = attachments.some((attachment) =>
        /\.pdf$/i.test(attachment.filename) || attachment.mimeType === "application/pdf"
      ) || /\.pdf$/i.test(item.attachmentFilename ?? "") || rawFilenames.some((filename) => /\.pdf$/i.test(filename));
      const hasInvoiceKeyword = /\binvoice\b|חשבונית|green\s*invoice|greeninvoice|icount|i-count|חשבונית\s*ירוקה/i.test(text);
      const hasTaxInvoiceKeyword = /tax\s+invoice|חשבונית\s*מס/i.test(text);
      const hasReceiptKeyword = /\breceipt\b|קבלה|חשבונית\s*מס\s*קבלה/i.test(text);
      const hasPaymentRequestKeyword = /payment\s+request|payment\s+due|amount\s+due|balance\s+due|please\s+pay|דרישת\s+תשלום|בקשת\s+תשלום|נא\s+לשלם|לתשלום/i.test(text);
      const hasAmountEvidence = item.amount !== null || /amount found|amountfound|סכום/i.test(lower);
      const hasSupplierEvidence = Boolean(item.supplierName && item.supplierName !== "Unknown supplier") || /supplier detected|supplierdetected|ספק/i.test(lower);
      const candidateInvoice =
        hasPdfAttachment ||
        hasInvoiceKeyword ||
        hasTaxInvoiceKeyword ||
        hasReceiptKeyword ||
        hasPaymentRequestKeyword ||
        (hasAmountEvidence && hasSupplierEvidence);
      const approved = item.reviewStatus === "auto_saved" && ["invoice", "receipt", "payment_request"].includes(item.documentType);
      const rejected = candidateInvoice && !approved;

      return {
        id: item.id,
        sender: item.sender,
        senderEmail: item.senderEmail,
        subject: item.subject,
        documentType: item.documentType,
        reviewStatus: item.reviewStatus,
        rejectionReason: item.decisionReason,
        confidenceScore: item.confidenceScore,
        hasAttachment,
        hasPdfAttachment,
        hasInvoiceKeyword,
        hasTaxInvoiceKeyword,
        hasReceiptKeyword,
        hasPaymentRequestKeyword,
        attachmentFilenames: [
          ...attachments.map((attachment) => attachment.filename),
          ...rawFilenames,
          ...(item.attachmentFilename ? [item.attachmentFilename] : []),
        ].filter(Boolean),
        attachmentMimeTypes: attachments.map((attachment) => attachment.mimeType || "unknown"),
        candidateInvoice,
        approved,
        rejected,
      };
    });

    const rejectionCounts = diagnostics
      .filter((item) => item.rejected)
      .reduce<Record<string, number>>((acc, item) => {
        const reason = item.rejectionReason || "unknown";
        acc[reason] = (acc[reason] ?? 0) + 1;
        return acc;
      }, {});

    let gmailListingDiagnostics = null;
    try {
      const { diagnoseGmailListingForOrganization } = await import("../services/gmail-sync.js");
      gmailListingDiagnostics = await diagnoseGmailListingForOrganization(organizationId, {
        daysBack: 90,
        maxMessages: 1000,
        scanAllMail: true,
      });
    } catch (err) {
      console.warn("[gmail/invoice-diagnostics] Gmail listing diagnostics failed", errorDetails(err));
    }

    res.json({
      latestScan,
      gmailListingDiagnostics,
      totals: {
        scannedEmails: latestScan?.emailsProcessed ?? scanItems.length,
        scanItems: scanItems.length,
        emailsWithAttachments: diagnostics.filter((item) => item.hasAttachment).length,
        emailsWithPdfAttachments: diagnostics.filter((item) => item.hasPdfAttachment).length,
        emailsWithInvoiceKeywords: diagnostics.filter((item) => item.hasInvoiceKeyword).length,
        emailsWithTaxInvoiceKeywords: diagnostics.filter((item) => item.hasTaxInvoiceKeyword).length,
        emailsWithReceiptKeywords: diagnostics.filter((item) => item.hasReceiptKeyword).length,
        emailsWithPaymentRequestKeywords: diagnostics.filter((item) => item.hasPaymentRequestKeyword).length,
        candidateInvoicesBeforeFiltering: diagnostics.filter((item) => item.candidateInvoice).length,
        approvedInvoices: diagnostics.filter((item) => item.approved).length,
        rejectedInvoices: diagnostics.filter((item) => item.rejected).length,
        supplierPaymentsCreated: latestScan?.paymentsCreated ?? 0,
        attachmentMimeTypes: diagnostics
          .flatMap((item) => item.attachmentMimeTypes)
          .reduce<Record<string, number>>((acc, mimeType) => {
            acc[mimeType] = (acc[mimeType] ?? 0) + 1;
            return acc;
          }, {}),
        firstAttachmentFilenames: Array.from(new Set(diagnostics.flatMap((item) => item.attachmentFilenames))).slice(0, 20),
      },
      rejectionCounts,
      rejectedCandidates: diagnostics
        .filter((item) => item.rejected)
        .slice(0, 50)
        .map((item) => ({
          sender: item.sender,
          senderEmail: item.senderEmail,
          subject: item.subject,
          rejectionReason: item.rejectionReason,
          confidenceScore: item.confidenceScore,
          documentType: item.documentType,
          reviewStatus: item.reviewStatus,
        })),
    });
  } catch (err) {
    console.error("[gmail/invoice-diagnostics]", errorDetails(err));
    res.status(500).json({ error: "טעינת אבחון חשבוניות נכשלה" });
  }
});

async function debugGmailIntegrationForAuth(auth: { userId: string; organizationId: string; email: string }) {
  const { findGmailIntegrationForOrganization } = await import("../services/gmailIntegrationIsolation.js");
  return findGmailIntegrationForOrganization(auth.organizationId);
}

function debugGmailBase(auth: { userId: string; organizationId: string; email: string }, integration: Awaited<ReturnType<typeof debugGmailIntegrationForAuth>>) {
  return {
    connected: Boolean(integration?.refreshToken),
    orgId: auth.organizationId,
    userId: auth.userId,
    integrationOrgId: integration?.organizationId ?? null,
    provider: integration?.provider ?? null,
    hasAccessToken: Boolean(integration?.accessToken),
    hasRefreshToken: Boolean(integration?.refreshToken),
    connectedAt: integration?.connectedAt ?? null,
    emailsFetched: 0,
    emailsSaved: 0,
    clientsFound: 0,
    invoicesFound: 0,
    errors: 0,
  };
}

type DebugPayloadPart = {
  mimeType?: string | null;
  filename?: string | null;
  body?: { data?: string | null; attachmentId?: string | null } | null;
  parts?: DebugPayloadPart[] | null;
};

function decodeGmailBody(data: string) {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function stripDebugHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function collectDebugBody(payload: DebugPayloadPart | undefined, chunks: string[]) {
  if (!payload) return;
  if (payload.body?.data && (payload.mimeType === "text/plain" || payload.mimeType === "text/html" || !payload.parts?.length)) {
    const decoded = decodeGmailBody(payload.body.data);
    chunks.push(payload.mimeType === "text/html" ? stripDebugHtml(decoded) : decoded);
  }
  for (const part of payload.parts ?? []) collectDebugBody(part, chunks);
}

function debugBodyText(payload: DebugPayloadPart | undefined) {
  const chunks: string[] = [];
  collectDebugBody(payload, chunks);
  return chunks.join("\n").trim();
}

function debugAttachmentNames(payload: DebugPayloadPart | undefined): string[] {
  if (!payload) return [];
  return [
    ...(payload.filename ? [payload.filename] : []),
    ...(payload.parts ?? []).flatMap((part) => debugAttachmentNames(part)),
  ];
}

apiRouter.get("/debug/gmail/status", async (req, res) => {
  try {
    const integration = await debugGmailIntegrationForAuth(req.auth!);
    console.log(
      `[debug/gmail/status] user=${req.auth!.userId} org=${req.auth!.organizationId} connected=${Boolean(integration?.refreshToken)} integrationOrg=${integration?.organizationId ?? "none"} hasAccessToken=${Boolean(integration?.accessToken)} hasRefreshToken=${Boolean(integration?.refreshToken)}`
    );
    res.json(debugGmailBase(req.auth!, integration));
  } catch (err) {
    console.error("[debug/gmail/status] failed", errorDetails(err));
    res.status(500).json({
      connected: false,
      orgId: req.auth?.organizationId ?? null,
      userId: req.auth?.userId ?? null,
      hasAccessToken: false,
      hasRefreshToken: false,
      emailsFetched: 0,
      emailsSaved: 0,
      clientsFound: 0,
      invoicesFound: 0,
      errors: 1,
      error: err instanceof Error ? err.message : String(err),
      details: errorDetails(err),
    });
  }
});

apiRouter.get("/debug/invoices", async (req, res) => {
  const startedAt = Date.now();
  const orgId = req.auth!.organizationId;
  const userId = req.auth!.userId;
  const QUERY_TIMEOUT_MS = 1900;

  function withQueryTimeout<T>(label: string, query: Promise<T>) {
    const queryStartedAt = Date.now();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    return Promise.race([
      query.then((result) => {
        console.log(`[debug/invoices] query=${label} org=${orgId} ms=${Date.now() - queryStartedAt} ok=true`);
        return result;
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const ms = Date.now() - queryStartedAt;
          console.error(`[debug/invoices] query=${label} org=${orgId} ms=${ms} ok=false reason=timeout`);
          reject(new Error(`${label} timed out after ${QUERY_TIMEOUT_MS}ms`));
        }, QUERY_TIMEOUT_MS);
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
  }

  try {
    const [
      invoiceCount,
      supplierPaymentCount,
      gmailScanItemCount,
      invoiceScanItemCount,
      badAmountCount,
      lastInvoiceRows,
      lastPaymentRows,
      rejectedInvoiceReasons,
    ] = await Promise.all([
      withQueryTimeout("invoice_count", prisma.invoice.count({ where: { organizationId: orgId } })),
      withQueryTimeout("supplier_payment_count", prisma.supplierPayment.count({ where: { organizationId: orgId } })),
      withQueryTimeout("gmail_scan_item_count", prisma.gmailScanItem.count({ where: { organizationId: orgId } })),
      withQueryTimeout("invoice_scan_item_count", prisma.gmailScanItem.count({
        where: { organizationId: orgId, documentType: { in: ["invoice", "receipt"] } },
      })),
      withQueryTimeout("bad_amount_count", prisma.invoice.count({
        where: { organizationId: orgId, amount: { gt: 10_000_000 } },
      })),
      withQueryTimeout("latest_20_invoices", prisma.invoice.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          clientId: true,
          invoiceNumber: true,
          amount: true,
          currency: true,
          date: true,
          dueDate: true,
          status: true,
          description: true,
          driveUrl: true,
          emailId: true,
          fromEmail: true,
          gmailMessageId: true,
          createdAt: true,
          client: { select: { id: true, name: true, email: true, domain: true } },
        },
      })),
      withQueryTimeout("latest_20_supplier_payments", prisma.supplierPayment.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          supplier: true,
          amount: true,
          currency: true,
          date: true,
          dueDate: true,
          paid: true,
          documentLink: true,
          invoiceLink: true,
          missingInvoice: true,
          subject: true,
          emailMessageId: true,
          createdAt: true,
        },
      })),
      withQueryTimeout("latest_20_rejected_invoice_reasons", prisma.gmailScanItem.findMany({
        where: {
          organizationId: orgId,
          OR: [
            { documentType: { in: ["invoice", "receipt", "unknown_needs_review"] } },
            { reviewStatus: { in: ["needs_review", "failed", "rejected"] } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          gmailMessageId: true,
          subject: true,
          documentType: true,
          reviewStatus: true,
          decisionReason: true,
          createdAt: true,
        },
      })),
    ]);
    const totalMs = Date.now() - startedAt;
    console.log(`[debug/invoices] complete org=${orgId} totalMs=${totalMs}`);

    res.json({
      orgId,
      userId,
      invoiceCount,
      supplierPaymentCount,
      gmailScanItemCount,
      invoiceScanItemCount,
      badAmountCount,
      lastInvoiceRows,
      lastPaymentRows,
      rejectedInvoiceReasons,
    });
  } catch (err) {
    console.error("[debug/invoices] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Invoice debug failed" });
  }
});

apiRouter.get("/debug/invoices/bad-amounts", async (req, res) => {
  const orgId = req.auth!.organizationId;
  const threshold = 10_000_000;
  try {
    const [badInvoiceCount, sampleRows] = await Promise.all([
      prisma.invoice.count({
        where: { organizationId: orgId, amount: { gt: threshold } },
      }),
      prisma.invoice.findMany({
        where: { organizationId: orgId, amount: { gt: threshold } },
        orderBy: { amount: "desc" },
        take: 20,
        select: {
          id: true,
          amount: true,
          invoiceNumber: true,
          description: true,
          gmailMessageId: true,
          createdAt: true,
        },
      }),
    ]);

    res.json({
      orgId,
      threshold,
      badInvoiceCount,
      sampleRows,
    });
  } catch (err) {
    console.error("[debug/invoices/bad-amounts] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Bad invoice amount debug failed" });
  }
});

apiRouter.get("/debug/payments/top-amounts", async (req, res) => {
  const orgId = req.auth!.organizationId;
  try {
    const where = debugTopPaymentAmountsWhere(orgId);
    const [summary, rows] = await Promise.all([
      prisma.supplierPayment.aggregate({
        where,
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.supplierPayment.findMany({
        where,
        orderBy: { amount: "desc" },
        take: 10,
        select: {
          id: true,
          amount: true,
          currency: true,
          supplier: true,
          date: true,
          dueDate: true,
          source: true,
          subject: true,
          emailSender: true,
          emailMessageId: true,
          documentLink: true,
          invoiceLink: true,
          createdAt: true,
        },
      }),
    ]);

    res.json({
      orgId,
      countedRows: summary._count.id,
      moneyToPay: summary._sum.amount ?? 0,
      rows,
    });
  } catch (err) {
    console.error("[debug/payments/top-amounts] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Top payment amounts debug failed" });
  }
});

export function debugTopPaymentAmountsWhere(organizationId: string) {
  return {
    organizationId,
    approvalStatus: "approved",
    paid: false,
    paymentRequired: true,
    amount: { gte: 0, lte: 1_000_000 },
  };
}

apiRouter.get("/debug/payments/classification-investigation", async (req, res) => {
  const orgId = req.auth!.organizationId;
  try {
    res.json(await buildPaymentClassificationDebug(orgId));
  } catch (err) {
    console.error("[debug/payments/classification-investigation] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Payment classification investigation debug failed" });
  }
});

apiRouter.get("/debug/payments/open-classification-inputs", async (req, res) => {
  const orgId = req.auth!.organizationId;
  try {
    const payments = await prisma.supplierPayment.findMany({
      where: {
        organizationId: orgId,
        paymentRequired: true,
        paid: false,
      },
      orderBy: [{ amount: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        amount: true,
        currency: true,
        supplier: true,
        emailSender: true,
        emailMessageId: true,
        subject: true,
        source: true,
        duplicateHash: true,
        duplicateDetected: true,
        duplicateReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const emailRefs = Array.from(new Set(payments.flatMap((payment) => payment.emailMessageId ? [payment.emailMessageId] : [])));
    const emails = emailRefs.length
      ? await prisma.emailMessage.findMany({
          where: {
            organizationId: orgId,
            OR: [
              { id: { in: emailRefs } },
              { gmailId: { in: emailRefs } },
            ],
          },
          select: {
            id: true,
            gmailId: true,
            subject: true,
            fromAddress: true,
            receivedAt: true,
          },
        })
      : [];
    const emailById = new Map(emails.map((email) => [email.id, email]));
    const emailByGmailId = new Map(emails.map((email) => [email.gmailId, email]));
    const scanRefs = Array.from(new Set([
      ...emailRefs,
      ...emails.map((email) => email.id),
      ...emails.map((email) => email.gmailId),
    ].filter(Boolean)));
    const scanItems = scanRefs.length
      ? await prisma.gmailScanItem.findMany({
          where: {
            organizationId: orgId,
            OR: [
              { emailMessageId: { in: scanRefs } },
              { gmailMessageId: { in: scanRefs } },
            ],
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            emailMessageId: true,
            gmailMessageId: true,
            sender: true,
            senderEmail: true,
            subject: true,
            amount: true,
            supplierName: true,
            documentType: true,
            reviewStatus: true,
            confidenceScore: true,
            decisionReason: true,
            createdAt: true,
          },
        })
      : [];
    const scanItemsByRef = new Map<string, typeof scanItems>();
    for (const scanItem of scanItems) {
      for (const ref of [scanItem.emailMessageId, scanItem.gmailMessageId].filter((value): value is string => Boolean(value))) {
        const existing = scanItemsByRef.get(ref) ?? [];
        existing.push(scanItem);
        scanItemsByRef.set(ref, existing);
      }
    }

    const rows = payments.map((payment) => {
      const email = payment.emailMessageId
        ? emailById.get(payment.emailMessageId) ?? emailByGmailId.get(payment.emailMessageId) ?? null
        : null;
      const relatedScanItems = [
        ...(payment.emailMessageId ? scanItemsByRef.get(payment.emailMessageId) ?? [] : []),
        ...(email?.id ? scanItemsByRef.get(email.id) ?? [] : []),
        ...(email?.gmailId ? scanItemsByRef.get(email.gmailId) ?? [] : []),
      ];
      const primaryScanItem = relatedScanItems[0] ?? null;
      const sender = primaryScanItem?.sender ?? payment.emailSender ?? email?.fromAddress ?? null;
      const senderEmail = primaryScanItem?.senderEmail ?? extractEmailAddress(sender) ?? extractEmailAddress(email?.fromAddress) ?? null;
      const senderDomain = extractEmailDomain(senderEmail ?? sender);

      return {
        paymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        supplier: payment.supplier,
        senderName: primaryScanItem?.sender ?? sender,
        senderEmail,
        senderDomain,
        documentType: primaryScanItem?.documentType ?? null,
        reviewStatus: primaryScanItem?.reviewStatus ?? null,
        confidenceScore: primaryScanItem?.confidenceScore ?? null,
        decisionReason: primaryScanItem?.decisionReason ?? null,
        emailMessageId: payment.emailMessageId,
        gmailMessageId: email?.gmailId ?? primaryScanItem?.gmailMessageId ?? null,
        emailSubject: email?.subject ?? payment.subject,
        paymentSubject: payment.subject,
        paymentSource: payment.source,
        duplicateHash: payment.duplicateHash,
        duplicateDetected: payment.duplicateDetected,
        duplicateReason: payment.duplicateReason,
        scanItemId: primaryScanItem?.id ?? null,
        scanItemCount: relatedScanItems.length,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
      };
    });

    const domainSummary = Array.from(
      rows.reduce((acc, row) => {
        const domain = row.senderDomain || "unknown";
        const existing = acc.get(domain) ?? {
          senderDomain: domain,
          count: 0,
          totalAmount: 0,
          examples: [] as Array<{ paymentId: string; supplier: string; amount: number; decisionReason: string | null }>,
        };
        existing.count += 1;
        existing.totalAmount += row.amount;
        if (existing.examples.length < 5) {
          existing.examples.push({
            paymentId: row.paymentId,
            supplier: row.supplier,
            amount: row.amount,
            decisionReason: row.decisionReason,
          });
        }
        acc.set(domain, existing);
        return acc;
      }, new Map<string, { senderDomain: string; count: number; totalAmount: number; examples: Array<{ paymentId: string; supplier: string; amount: number; decisionReason: string | null }> }>())
    )
      .map(([, value]) => value)
      .sort((a, b) => b.totalAmount - a.totalAmount);

    const duplicateSummary = Array.from(
      rows.reduce((acc, row) => {
        const key = row.duplicateHash || `${row.senderDomain}|${row.emailSubject}|${row.amount}`;
        const existing = acc.get(key) ?? { key, count: 0, totalAmount: 0, paymentIds: [] as string[] };
        existing.count += 1;
        existing.totalAmount += row.amount;
        if (existing.paymentIds.length < 10) existing.paymentIds.push(row.paymentId);
        acc.set(key, existing);
        return acc;
      }, new Map<string, { key: string; count: number; totalAmount: number; paymentIds: string[] }>())
    )
      .map(([, value]) => value)
      .filter((value) => value.count > 1)
      .sort((a, b) => b.totalAmount - a.totalAmount);

    res.json({
      orgId,
      endpoint: "/api/debug/payments/open-classification-inputs",
      readOnly: true,
      countedRows: rows.length,
      moneyToPay: rows.reduce((sum, row) => sum + row.amount, 0),
      domainSummary,
      duplicateSummary,
      rows,
    });
  } catch (err) {
    console.error("[debug/payments/open-classification-inputs] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Open supplier payment classification input debug failed" });
  }
});

function extractEmailAddress(value: string | null | undefined) {
  if (!value) return null;
  return value.match(/<([^>]+)>/)?.[1]?.trim().toLowerCase()
    ?? value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase()
    ?? null;
}

function extractEmailDomain(value: string | null | undefined) {
  const email = extractEmailAddress(value) ?? value?.toLowerCase() ?? "";
  return email.includes("@") ? email.split("@").pop()?.replace(/[>\s),;]+$/g, "") ?? "unknown" : "unknown";
}

async function buildOpenClassificationInputsDebug(orgId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{
    paymentId: string;
    amount: number;
    currency: string;
    supplier: string;
    senderName: string | null;
    senderEmail: string | null;
    senderDomain: string | null;
    documentType: string | null;
    reviewStatus: string | null;
    confidenceScore: string | null;
    decisionReason: string | null;
    emailMessageId: string | null;
    gmailMessageId: string | null;
    emailSubject: string | null;
    paymentSubject: string | null;
    paymentSource: string;
    duplicateHash: string | null;
    duplicateDetected: boolean;
    duplicateReason: string | null;
    scanItemId: string | null;
    scanItemCount: number;
    createdAt: Date;
    updatedAt: Date;
  }>>(
    `SELECT
      sp."id" AS "paymentId",
      sp."amount",
      sp."currency",
      sp."supplier",
      COALESCE(gsi."sender", sp."emailSender", em."fromAddress") AS "senderName",
      COALESCE(gsi."senderEmail", substring(COALESCE(sp."emailSender", em."fromAddress") from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}')) AS "senderEmail",
      lower(split_part(COALESCE(gsi."senderEmail", substring(COALESCE(sp."emailSender", em."fromAddress") from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'), 'unknown'), '@', 2)) AS "senderDomain",
      gsi."documentType",
      gsi."reviewStatus",
      gsi."confidenceScore",
      gsi."decisionReason",
      sp."emailMessageId",
      COALESCE(em."gmailId", gsi."gmailMessageId") AS "gmailMessageId",
      COALESCE(em."subject", gsi."subject") AS "emailSubject",
      sp."subject" AS "paymentSubject",
      sp."source" AS "paymentSource",
      sp."duplicateHash",
      sp."duplicateDetected",
      sp."duplicateReason",
      gsi."id" AS "scanItemId",
      COALESCE(gsic."scanItemCount", 0)::int AS "scanItemCount",
      sp."createdAt",
      sp."updatedAt"
    FROM "SupplierPayment" sp
    LEFT JOIN "EmailMessage" em
      ON em."organizationId" = sp."organizationId"
      AND (em."id" = sp."emailMessageId" OR em."gmailId" = sp."emailMessageId")
    LEFT JOIN LATERAL (
      SELECT *
      FROM "GmailScanItem" item
      WHERE item."organizationId" = sp."organizationId"
        AND (
          item."emailMessageId" = sp."emailMessageId"
          OR item."gmailMessageId" = sp."emailMessageId"
          OR item."emailMessageId" = em."id"
          OR item."gmailMessageId" = em."gmailId"
        )
      ORDER BY item."createdAt" DESC
      LIMIT 1
    ) gsi ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS "scanItemCount"
      FROM "GmailScanItem" item
      WHERE item."organizationId" = sp."organizationId"
        AND (
          item."emailMessageId" = sp."emailMessageId"
          OR item."gmailMessageId" = sp."emailMessageId"
          OR item."emailMessageId" = em."id"
          OR item."gmailMessageId" = em."gmailId"
        )
    ) gsic ON true
    WHERE sp."organizationId" = $1
      AND sp."paymentRequired" = true
      AND sp."paid" = false
    ORDER BY sp."amount" DESC, sp."createdAt" DESC`,
    orgId
  );

  const normalizedRows = rows.map((row) => ({
    ...row,
    senderDomain: row.senderDomain && row.senderDomain.length > 0 ? row.senderDomain : extractEmailDomain(row.senderEmail ?? row.senderName),
  }));

  const domainSummary = Array.from(
    normalizedRows.reduce((acc, row) => {
      const domain = row.senderDomain || "unknown";
      const existing = acc.get(domain) ?? {
        senderDomain: domain,
        count: 0,
        totalAmount: 0,
        examples: [] as Array<{ paymentId: string; supplier: string; amount: number; decisionReason: string | null }>,
      };
      existing.count += 1;
      existing.totalAmount += row.amount;
      if (existing.examples.length < 5) {
        existing.examples.push({
          paymentId: row.paymentId,
          supplier: row.supplier,
          amount: row.amount,
          decisionReason: row.decisionReason,
        });
      }
      acc.set(domain, existing);
      return acc;
    }, new Map<string, { senderDomain: string; count: number; totalAmount: number; examples: Array<{ paymentId: string; supplier: string; amount: number; decisionReason: string | null }> }>())
  )
    .map(([, value]) => value)
    .sort((a, b) => b.totalAmount - a.totalAmount);

  const duplicateSummary = Array.from(
    normalizedRows.reduce((acc, row) => {
      const key = row.duplicateHash || `${row.senderDomain}|${row.emailSubject}|${row.amount}`;
      const existing = acc.get(key) ?? { key, count: 0, totalAmount: 0, paymentIds: [] as string[] };
      existing.count += 1;
      existing.totalAmount += row.amount;
      if (existing.paymentIds.length < 10) existing.paymentIds.push(row.paymentId);
      acc.set(key, existing);
      return acc;
    }, new Map<string, { key: string; count: number; totalAmount: number; paymentIds: string[] }>())
  )
    .map(([, value]) => value)
    .filter((value) => value.count > 1)
    .sort((a, b) => b.totalAmount - a.totalAmount);

  return {
    orgId,
    endpoint: "/api/debug/payments/open-classification-inputs",
    readOnly: true,
    countedRows: normalizedRows.length,
    moneyToPay: normalizedRows.reduce((sum, row) => sum + row.amount, 0),
    domainSummary,
    duplicateSummary,
    rows: normalizedRows,
  };
}

apiRouter.get("/debug/sheets/supplier-payments/verify", async (req, res) => {
  try {
    const { verifySupplierPaymentsSheet } = await import("../services/supplierPaymentsSheet.js");
    res.json(await verifySupplierPaymentsSheet(req.auth!.organizationId));
  } catch (err) {
    console.error("[debug/sheets/supplier-payments/verify]", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Supplier payments sheet verification failed" });
  }
});

async function applyClassificationCleanupHandler(req: Request, res: Response) {
  const orgId = req.auth!.organizationId;
  try {
    res.json(await applyPaymentClassificationCleanup(orgId));
  } catch (err) {
    console.error("[debug/payments/apply-classification-cleanup] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Payment classification cleanup failed" });
  }
}

apiRouter
  .route("/debug/payments/apply-classification-cleanup")
  .post(applyClassificationCleanupHandler);

type GreenInvoiceConnectBody = {
  apiKeyId?: unknown;
  apiSecret?: unknown;
  env?: unknown;
};

function normalizeGreenInvoiceEnv(value: unknown): GreenInvoiceEnv | null {
  if (value === undefined || value === null || value === "") return "sandbox";
  if (value === "sandbox" || value === "production") return value;
  return null;
}

apiRouter.post("/green-invoice/connect", requirePerm("organization.settings"), async (req, res) => {
  const orgId = req.auth!.organizationId;
  const body = (req.body ?? {}) as GreenInvoiceConnectBody;
  const apiKeyId = typeof body.apiKeyId === "string" ? body.apiKeyId.trim() : "";
  const apiSecret = typeof body.apiSecret === "string" ? body.apiSecret.trim() : "";
  const env = normalizeGreenInvoiceEnv(body.env);

  if (!apiKeyId || !apiSecret) {
    res.status(400).json({ success: false, error: "apiKeyId and apiSecret are required" });
    return;
  }
  if (!env) {
    res.status(400).json({ success: false, error: "env must be either sandbox or production" });
    return;
  }

  try {
    const result = await testGreenInvoiceConnection(apiKeyId, apiSecret, env);
    if (!result.success) {
      res.json(result);
      return;
    }

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        greenInvoiceApiKeyId: apiKeyId,
        greenInvoiceApiSecret: apiSecret,
        greenInvoiceEnv: env,
        greenInvoiceConnectedAt: new Date(),
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[green-invoice/connect] failed", errorDetails(err));
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Green Invoice connect failed" });
  }
});

apiRouter.get("/green-invoice/status", async (req, res) => {
  const orgId = req.auth!.organizationId;
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        greenInvoiceApiKeyId: true,
        greenInvoiceEnv: true,
        greenInvoiceConnectedAt: true,
      },
    });

    res.json({
      connected: Boolean(organization?.greenInvoiceApiKeyId && organization.greenInvoiceConnectedAt),
      env: organization?.greenInvoiceEnv ?? "sandbox",
      connectedAt: organization?.greenInvoiceConnectedAt ?? null,
    });
  } catch (err) {
    console.error("[green-invoice/status] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Green Invoice status failed" });
  }
});

apiRouter.post("/green-invoice/test", requirePerm("organization.settings"), async (req, res) => {
  const orgId = req.auth!.organizationId;
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        greenInvoiceApiKeyId: true,
        greenInvoiceApiSecret: true,
        greenInvoiceEnv: true,
      },
    });

    const env = normalizeGreenInvoiceEnv(organization?.greenInvoiceEnv);
    if (!organization?.greenInvoiceApiKeyId || !organization.greenInvoiceApiSecret || !env) {
      res.json({ success: false, error: "Green Invoice is not connected" });
      return;
    }

    const result = await testGreenInvoiceConnection(
      organization.greenInvoiceApiKeyId,
      organization.greenInvoiceApiSecret,
      env
    );
    res.json(result);
  } catch (err) {
    console.error("[green-invoice/test] failed", errorDetails(err));
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Green Invoice test failed" });
  }
});

apiRouter.post("/bank/upload", requirePerm("payment.create"), bankUpload.single("file"), async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "Bank statement file is required" });
    return;
  }

  const statement = await prisma.bankStatement.create({
    data: {
      organizationId,
      fileName: file.originalname || "bank-statement",
      status: "processing",
    },
  });

  try {
    const parsed = parseBankStatementFile({
      buffer: file.buffer,
      fileName: file.originalname || "bank-statement",
      mimeType: file.mimetype,
    });
    const suggestions = await matchTransactions(organizationId, parsed.transactions);

    const rows = await prisma.$transaction(
      parsed.transactions.map((transaction, index) => {
        const suggestion = suggestions[index];
        const matchedInvoiceId = suggestion?.matchedRecordType === "invoice" ? suggestion.matchedRecordId : null;
        const matchedSupplierPaymentId = suggestion?.matchedRecordType === "supplierPayment" ? suggestion.matchedRecordId : null;
        const matchStatus = suggestion?.matchType === "suggested" ? "suggested" : "unmatched";

        return prisma.bankTransaction.create({
          data: {
            bankStatementId: statement.id,
            organizationId,
            date: transaction.date,
            amount: transaction.amount,
            description: transaction.description,
            direction: transaction.direction,
            rawData: transaction.rawData,
            matchStatus,
            matchedInvoiceId,
            matchedSupplierPaymentId,
            matchConfidence: suggestion?.confidence ?? null,
          },
        });
      })
    );

    const summary = summarizeBankTransactions(rows.map((row) => row.matchStatus));
    await prisma.bankStatement.update({
      where: { id: statement.id },
      data: {
        status: "ready",
        transactionCount: rows.length,
      },
    });

    res.json({
      statementId: statement.id,
      transactionCount: rows.length,
      summary,
      warnings: parsed.warnings,
    });
  } catch (err) {
    console.error("[bank/upload] failed", errorDetails(err));
    await prisma.bankStatement.update({
      where: { id: statement.id },
      data: { status: "error" },
    }).catch(() => undefined);
    res.status(500).json({ error: err instanceof Error ? err.message : "Bank statement upload failed" });
  }
});

apiRouter.get("/bank/statements", async (req, res) => {
  const organizationId = req.auth!.organizationId;
  try {
    const statements = await prisma.bankStatement.findMany({
      where: { organizationId },
      orderBy: { uploadedAt: "desc" },
      select: {
        id: true,
        fileName: true,
        uploadedAt: true,
        status: true,
        transactionCount: true,
      },
    });
    res.json({ statements });
  } catch (err) {
    console.error("[bank/statements] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Bank statements fetch failed" });
  }
});

apiRouter.get("/bank/statements/:id", async (req, res) => {
  const organizationId = req.auth!.organizationId;
  try {
    const statement = await prisma.bankStatement.findFirst({
      where: { id: routeId(req), organizationId },
      include: {
        transactions: {
          orderBy: { date: "desc" },
        },
      },
    });
    if (!statement) {
      res.status(404).json({ error: "Bank statement not found" });
      return;
    }

    const invoiceIds = statement.transactions
      .map((transaction) => transaction.matchedInvoiceId)
      .filter((id): id is string => Boolean(id));
    const supplierPaymentIds = statement.transactions
      .map((transaction) => transaction.matchedSupplierPaymentId)
      .filter((id): id is string => Boolean(id));

    const [invoices, supplierPayments] = await Promise.all([
      invoiceIds.length
        ? prisma.invoice.findMany({
            where: { organizationId, id: { in: invoiceIds } },
            select: {
              id: true,
              invoiceNumber: true,
              amount: true,
              date: true,
              status: true,
              client: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
      supplierPaymentIds.length
        ? prisma.supplierPayment.findMany({
            where: { organizationId, id: { in: supplierPaymentIds } },
            select: {
              id: true,
              supplier: true,
              amount: true,
              date: true,
              paid: true,
              subject: true,
            },
          })
        : Promise.resolve([]),
    ]);
    const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
    const supplierPaymentById = new Map(supplierPayments.map((payment) => [payment.id, payment]));

    res.json({
      statement: {
        id: statement.id,
        fileName: statement.fileName,
        uploadedAt: statement.uploadedAt,
        status: statement.status,
        transactionCount: statement.transactionCount,
      },
      transactions: statement.transactions.map((transaction) => ({
        ...transaction,
        matchedRecord: transaction.matchedInvoiceId
          ? { type: "invoice", record: invoiceById.get(transaction.matchedInvoiceId) ?? null }
          : transaction.matchedSupplierPaymentId
            ? { type: "supplierPayment", record: supplierPaymentById.get(transaction.matchedSupplierPaymentId) ?? null }
            : null,
      })),
    });
  } catch (err) {
    console.error("[bank/statements/:id] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Bank statement fetch failed" });
  }
});

apiRouter.post("/bank/transactions/:id/confirm", requirePerm("payment.update"), async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const body = (req.body ?? {}) as { matchedRecordType?: unknown; matchedRecordId?: unknown };

  try {
    const transaction = await prisma.bankTransaction.findFirst({
      where: { id: routeId(req), organizationId },
    });
    if (!transaction) {
      res.status(404).json({ error: "Bank transaction not found" });
      return;
    }

    const overrideType = body.matchedRecordType === "invoice" || body.matchedRecordType === "supplierPayment"
      ? body.matchedRecordType
      : null;
    const overrideId = typeof body.matchedRecordId === "string" && body.matchedRecordId.trim()
      ? body.matchedRecordId.trim()
      : null;

    const targetType = overrideType ?? (transaction.matchedInvoiceId ? "invoice" : transaction.matchedSupplierPaymentId ? "supplierPayment" : null);
    const targetId = overrideId ?? transaction.matchedInvoiceId ?? transaction.matchedSupplierPaymentId;
    if (!targetType || !targetId) {
      res.status(400).json({ error: "No matched record to confirm" });
      return;
    }

    const validTarget = targetType === "invoice"
      ? await prisma.invoice.findFirst({ where: { id: targetId, organizationId }, select: { id: true } })
      : await prisma.supplierPayment.findFirst({ where: { id: targetId, organizationId }, select: { id: true } });
    if (!validTarget) {
      res.status(404).json({ error: "Matched record not found" });
      return;
    }

    const updated = await prisma.bankTransaction.update({
      where: { id: transaction.id },
      data: {
        matchStatus: "matched",
        matchedInvoiceId: targetType === "invoice" ? targetId : null,
        matchedSupplierPaymentId: targetType === "supplierPayment" ? targetId : null,
        matchConfidence: transaction.matchConfidence ?? 1,
      },
    });
    res.json({ transaction: updated });
  } catch (err) {
    console.error("[bank/transactions/confirm] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Bank transaction confirm failed" });
  }
});

apiRouter.post("/bank/transactions/:id/reject", requirePerm("review.reject"), async (req, res) => {
  const organizationId = req.auth!.organizationId;
  try {
    const transaction = await prisma.bankTransaction.findFirst({
      where: { id: routeId(req), organizationId },
      select: { id: true },
    });
    if (!transaction) {
      res.status(404).json({ error: "Bank transaction not found" });
      return;
    }

    const updated = await prisma.bankTransaction.update({
      where: { id: transaction.id },
      data: {
        matchStatus: "unmatched",
        matchedInvoiceId: null,
        matchedSupplierPaymentId: null,
        matchConfidence: null,
      },
    });
    res.json({ transaction: updated });
  } catch (err) {
    console.error("[bank/transactions/reject] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Bank transaction reject failed" });
  }
});

function summarizeBankTransactions(statuses: string[]) {
  return {
    matched: statuses.filter((status) => status === "matched").length,
    suggested: statuses.filter((status) => status === "suggested").length,
    unmatched: statuses.filter((status) => status === "unmatched").length,
  };
}

apiRouter.post("/debug/invoices/fix-bad-amounts", async (req, res) => {
  const orgId = req.auth!.organizationId;
  const threshold = 10_000_000;
  try {
    const result = await prisma.invoice.updateMany({
      where: { organizationId: orgId, amount: { gt: threshold } },
      data: { amount: 0 },
    });

    console.log(`[debug/invoices/fix-bad-amounts] org=${orgId} threshold=${threshold} updated=${result.count}`);
    res.json({
      orgId,
      threshold,
      updatedCount: result.count,
    });
  } catch (err) {
    console.error("[debug/invoices/fix-bad-amounts] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Bad invoice amount cleanup failed" });
  }
});

type DriveMergeJobStatus = "running" | "done" | "error";
type DriveMergeFolder = {
  id: string;
  name: string;
  createdTime: string | null;
  parentLabel: string;
  appProperties?: Record<string, string> | null;
};
type DriveMergeChild = {
  id: string;
  name: string;
  mimeType: string | null;
};
type DriveMergeResult = {
  dryRun: boolean;
  rootFolderId: string;
  searchedRoots: Array<{
    id: string;
    name: string;
    matchedCandidateName: string;
    directSupplierFolderCount: number;
    legacySupplierFolderCount: number;
    supplierFolderCount: number;
  }>;
  duplicateGroups: number;
  foldersMerged: number;
  suppliersFixed: number;
  duplicateSubfoldersRemoved: number;
  filesMoved: number;
  finalSupplierCount: number;
  finalFolderStructure: Array<{
    supplier: string;
    supplierFolderId: string;
    documentFolders: Array<{ name: string; folderId: string; childCount: number }>;
    duplicateSubfoldersRemaining: Array<{ name: string; count: number }>;
  }>;
  groups: Array<{
    normalizedName: string;
    keep: DriveMergeFolder;
    duplicates: Array<DriveMergeFolder & { childCount: number; children: DriveMergeChild[] }>;
  }>;
};
type DriveMergeJob = {
  id: string;
  organizationId: string;
  dryRun: boolean;
  status: DriveMergeJobStatus;
  progress: string;
  result?: DriveMergeResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

const driveMergeJobs = new Map<string, DriveMergeJob>();
const supplierParentFolderNames = ["Invoices", "Receipts", "Payment Requests", "Missing Invoices", "Other"];

function updateDriveMergeJob(jobId: string, update: Partial<DriveMergeJob>) {
  const job = driveMergeJobs.get(jobId);
  if (!job) return;
  driveMergeJobs.set(jobId, { ...job, ...update, updatedAt: Date.now() });
}

function cleanupOldDriveMergeJobs() {
  const cutoff = Date.now() - 1000 * 60 * 60;
  for (const [jobId, job] of driveMergeJobs.entries()) {
    if (job.updatedAt < cutoff) driveMergeJobs.delete(jobId);
  }
}

async function runDriveDuplicateFolderMergeJob(jobId: string, organizationId: string, dryRun: boolean) {
  try {
    updateDriveMergeJob(jobId, { progress: "Connecting to Google Drive" });
    const { getGoogleClients } = await import("../services/google.js");
    const {
      INVOICE_DRIVE_FOLDER_NAME,
      canonicalSupplierFolderKey,
      normalizedSupplierFolderName,
      supplierFolderIdentityKey,
      writeSupplierFolderMetadata,
    } = await import("../services/driveService.js");
    const { config } = await import("../lib/config.js");
    const { drive } = await getGoogleClients(organizationId);

    async function listChildFolders(parentId: string, parentLabel: string): Promise<DriveMergeFolder[]> {
      const folders: DriveMergeFolder[] = [];
      let pageToken: string | undefined;
      do {
        const result = await drive.files.list({
          q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: "nextPageToken, files(id, name, createdTime, appProperties)",
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        for (const folder of result.data.files ?? []) {
          if (!folder.id || !folder.name) continue;
          if (parentLabel === "Root" && supplierParentFolderNames.includes(folder.name)) continue;
          folders.push({
            id: folder.id,
            name: folder.name,
            createdTime: folder.createdTime ?? null,
            parentLabel,
            appProperties: folder.appProperties ?? null,
          });
        }
        pageToken = result.data.nextPageToken ?? undefined;
      } while (pageToken);
      return folders;
    }

    async function findFoldersByName(name: string): Promise<DriveMergeFolder[]> {
      const folders: DriveMergeFolder[] = [];
      let pageToken: string | undefined;
      do {
        const result = await drive.files.list({
          q: `name='${escapeDriveMergeQueryValue(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: "nextPageToken, files(id, name, createdTime, appProperties)",
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        for (const folder of result.data.files ?? []) {
          if (!folder.id || !folder.name) continue;
          folders.push({
            id: folder.id,
            name: folder.name,
            createdTime: folder.createdTime ?? null,
            parentLabel: "Candidate root",
            appProperties: folder.appProperties ?? null,
          });
        }
        pageToken = result.data.nextPageToken ?? undefined;
      } while (pageToken);
      return folders;
    }

    async function listChildren(folderId: string): Promise<DriveMergeChild[]> {
      const children: DriveMergeChild[] = [];
      let pageToken: string | undefined;
      do {
        const result = await drive.files.list({
          q: `'${folderId}' in parents and trashed=false`,
          fields: "nextPageToken, files(id, name, mimeType)",
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        for (const child of result.data.files ?? []) {
          if (!child.id || !child.name) continue;
          children.push({ id: child.id, name: child.name, mimeType: child.mimeType ?? null });
        }
        pageToken = result.data.nextPageToken ?? undefined;
      } while (pageToken);
      return children;
    }

    async function listChildDocumentFolders(parentId: string): Promise<DriveMergeFolder[]> {
      return (await listChildFolders(parentId, "Document folders"))
        .filter((folder) => canonicalDocumentFolderName(folder.name));
    }

    async function ensureCanonicalDocumentFolder(parentId: string, folderName: string): Promise<string> {
      const existing = (await listChildFolders(parentId, "Document folders"))
        .filter((folder) => folder.name === folderName)
        .sort(sortDriveFoldersByCreatedTime)[0];
      if (existing) return existing.id;
      if (dryRun) return `dry-run:${parentId}:${folderName}`;
      const created = await drive.files.create({
        requestBody: {
          name: folderName,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parentId],
        },
        fields: "id",
        supportsAllDrives: true,
      });
      if (!created.data.id) throw new Error(`Failed to create Drive document folder: ${folderName}`);
      return created.data.id;
    }

    async function moveFolderContentsToFolder(sourceFolderId: string, targetFolderId: string) {
      const children = await listChildren(sourceFolderId);
      if (!dryRun) {
        for (const child of children) {
          await drive.files.update({
            fileId: child.id,
            addParents: targetFolderId,
            removeParents: sourceFolderId,
            fields: "id, parents",
            supportsAllDrives: true,
          });
        }
      }
      return children.length;
    }

    async function moveDuplicateSupplierChildToCanonicalFolder(child: DriveMergeChild, duplicateSupplierId: string, canonicalSupplierId: string) {
      const canonicalDocumentName = child.mimeType === "application/vnd.google-apps.folder"
        ? canonicalDocumentFolderName(child.name)
        : null;
      if (!canonicalDocumentName) {
        if (!dryRun) {
          await drive.files.update({
            fileId: child.id,
            addParents: canonicalSupplierId,
            removeParents: duplicateSupplierId,
            fields: "id, parents",
            supportsAllDrives: true,
          });
        }
        return { filesMoved: 1, foldersDeleted: 0 };
      }

      const targetFolderId = await ensureCanonicalDocumentFolder(canonicalSupplierId, canonicalDocumentName);
      const moved = await moveFolderContentsToFolder(child.id, targetFolderId);
      if (!dryRun) {
        await drive.files.delete({ fileId: child.id, supportsAllDrives: true });
      }
      return { filesMoved: moved, foldersDeleted: 1 };
    }

    async function normalizeSupplierDocumentSubfolders(supplier: DriveMergeFolder) {
      const documentFolders = await listChildDocumentFolders(supplier.id);
      const groupsByDocumentName = new Map<string, DriveMergeFolder[]>();
      for (const folder of documentFolders) {
        const canonicalName = canonicalDocumentFolderName(folder.name);
        if (!canonicalName) continue;
        const group = groupsByDocumentName.get(canonicalName) ?? [];
        group.push(folder);
        groupsByDocumentName.set(canonicalName, group);
      }

      let foldersDeleted = 0;
      let movedFiles = 0;
      const finalDocumentFolders: Array<{ name: string; folderId: string; childCount: number }> = [];
      const duplicateSubfoldersRemaining: Array<{ name: string; count: number }> = [];

      for (const folderName of supplierParentFolderNames) {
        const folders = [...(groupsByDocumentName.get(folderName) ?? [])].sort(sortDriveFoldersByCreatedTime);
        const keep = folders[0] ?? null;
        const keepId = keep?.id ?? await ensureCanonicalDocumentFolder(supplier.id, folderName);
        for (const duplicate of folders.slice(1)) {
          const moved = await moveFolderContentsToFolder(duplicate.id, keepId);
          movedFiles += moved;
          foldersDeleted++;
          if (!dryRun) {
            await drive.files.delete({ fileId: duplicate.id, supportsAllDrives: true });
          }
        }
        const childCount = keepId.startsWith("dry-run:") ? 0 : (await listChildren(keepId)).length;
        finalDocumentFolders.push({ name: folderName, folderId: keepId, childCount });
        if (dryRun && folders.length > 1) duplicateSubfoldersRemaining.push({ name: folderName, count: folders.length });
      }

      return { foldersDeleted, movedFiles, finalDocumentFolders, duplicateSubfoldersRemaining };
    }

    updateDriveMergeJob(jobId, { progress: "Resolving candidate Drive roots" });
    const candidateRootNames = Array.from(new Set([INVOICE_DRIVE_FOLDER_NAME, config.driveRootFolder].filter(Boolean)));
    const rootCandidates: Array<DriveMergeFolder & { matchedCandidateName: string }> = [];
    const seenRootIds = new Set<string>();

    for (const candidateName of candidateRootNames) {
      const matchingRoots = await findFoldersByName(candidateName);
      for (const root of matchingRoots) {
        if (seenRootIds.has(root.id)) continue;
        seenRootIds.add(root.id);
        rootCandidates.push({ ...root, matchedCandidateName: candidateName });
      }
    }

    updateDriveMergeJob(jobId, { progress: `Listing supplier folders under ${rootCandidates.length} Drive roots` });
    const allFolders: DriveMergeFolder[] = [];
    const searchedRoots: DriveMergeResult["searchedRoots"] = [];
    const excludedDirectFolderNames = new Set([...supplierParentFolderNames, ...candidateRootNames]);

    for (const root of rootCandidates) {
      const rootChildFolders = await listChildFolders(root.id, `${root.name} / Root`);
      const directSupplierFolders = rootChildFolders
        .filter((folder) => !excludedDirectFolderNames.has(folder.name))
        .map((folder) => ({ ...folder, parentLabel: `${root.name} / Root` }));
      const legacyParentFolders = rootChildFolders.filter((folder) => supplierParentFolderNames.includes(folder.name));
      const legacySupplierFolders = (await Promise.all(
        legacyParentFolders.map((folder) => listChildFolders(folder.id, `${root.name} / ${folder.name}`))
      )).flat();

      allFolders.push(...directSupplierFolders, ...legacySupplierFolders);
      searchedRoots.push({
        id: root.id,
        name: root.name,
        matchedCandidateName: root.matchedCandidateName,
        directSupplierFolderCount: directSupplierFolders.length,
        legacySupplierFolderCount: legacySupplierFolders.length,
        supplierFolderCount: directSupplierFolders.length + legacySupplierFolders.length,
      });
    }

    const groups = new Map<string, DriveMergeFolder[]>();
    for (const folder of allFolders) {
      const supplierTaxId = folder.appProperties?.supplierTaxId ?? null;
      const normalized = supplierTaxId
        ? supplierFolderIdentityKey({ supplierName: folder.name, supplierTaxId })
        : `name:${canonicalSupplierFolderKey(normalizedSupplierFolderName(folder.name))}`;
      const current = groups.get(normalized) ?? [];
      current.push(folder);
      groups.set(normalized, current);
    }

    const duplicatePlans: DriveMergeResult["groups"] = [];
    const finalFolderStructure: DriveMergeResult["finalFolderStructure"] = [];
    const canonicalSupplierFolders = new Map<string, DriveMergeFolder>();
    let foldersMerged = 0;
    let suppliersFixed = 0;
    let duplicateSubfoldersRemoved = 0;
    let filesMoved = 0;
    let processedGroups = 0;
    const duplicateGroups = Array.from(groups.values()).filter((folders) => folders.length > 1).length;

    for (const [normalizedName, folders] of groups.entries()) {
      if (folders.length < 2) continue;
      processedGroups++;
      updateDriveMergeJob(jobId, { progress: `Processing duplicate group ${processedGroups}/${duplicateGroups}: ${normalizedName}` });
      const sorted = [...folders].sort((a, b) => {
        const aTime = a.createdTime ? new Date(a.createdTime).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.createdTime ? new Date(b.createdTime).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      });
      const keep = sorted[0];
      canonicalSupplierFolders.set(normalizedName, keep);
      const duplicates = sorted.slice(1);
      const duplicateDetails: Array<DriveMergeFolder & { childCount: number; children: DriveMergeChild[] }> = [];

      for (const duplicate of duplicates) {
        const children = await listChildren(duplicate.id);
        foldersMerged++;
        duplicateDetails.push({
          ...duplicate,
          childCount: children.length,
          children: children.slice(0, 20),
        });

        if (!dryRun) {
          updateDriveMergeJob(jobId, { progress: `Moving ${children.length} items from ${duplicate.name}` });
          for (const child of children) {
            const moved = await moveDuplicateSupplierChildToCanonicalFolder(child, duplicate.id, keep.id);
            filesMoved += moved.filesMoved;
            duplicateSubfoldersRemoved += moved.foldersDeleted;
          }
          await drive.files.delete({ fileId: duplicate.id, supportsAllDrives: true });
        } else {
          for (const child of children) {
            const canonicalDocumentName = child.mimeType === "application/vnd.google-apps.folder"
              ? canonicalDocumentFolderName(child.name)
              : null;
            if (canonicalDocumentName) {
              filesMoved += await moveFolderContentsToFolder(child.id, `dry-run:${keep.id}:${canonicalDocumentName}`);
              duplicateSubfoldersRemoved++;
            } else {
              filesMoved++;
            }
          }
        }
      }

      duplicatePlans.push({
        normalizedName,
        keep,
        duplicates: duplicateDetails,
      });
      if (!dryRun) {
        const supplierTaxId = keep.appProperties?.supplierTaxId ?? null;
        const supplierKey = supplierTaxId
          ? supplierFolderIdentityKey({ supplierName: keep.name, supplierTaxId })
          : `name:${canonicalSupplierFolderKey(normalizedSupplierFolderName(keep.name))}`;
        await writeSupplierFolderMetadata(organizationId, supplierKey, {
          folderId: keep.id,
          folderName: normalizedSupplierFolderName(keep.name),
          supplierName: normalizedSupplierFolderName(keep.name),
          supplierTaxId,
          supplierKey,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    for (const [normalizedName, folders] of groups.entries()) {
      if (!canonicalSupplierFolders.has(normalizedName)) {
        canonicalSupplierFolders.set(normalizedName, [...folders].sort(sortDriveFoldersByCreatedTime)[0]);
      }
    }

    for (const [normalizedName, supplier] of canonicalSupplierFolders.entries()) {
      updateDriveMergeJob(jobId, { progress: `Normalizing document folders for ${supplier.name}` });
      const normalized = await normalizeSupplierDocumentSubfolders(supplier);
      if (normalized.foldersDeleted > 0 || normalized.movedFiles > 0) suppliersFixed++;
      duplicateSubfoldersRemoved += normalized.foldersDeleted;
      filesMoved += normalized.movedFiles;
      finalFolderStructure.push({
        supplier: normalizedName,
        supplierFolderId: supplier.id,
        documentFolders: normalized.finalDocumentFolders,
        duplicateSubfoldersRemaining: normalized.duplicateSubfoldersRemaining,
      });
    }

    updateDriveMergeJob(jobId, {
      status: "done",
      progress: dryRun ? "Dry-run complete" : "Merge complete",
      result: {
        dryRun,
        rootFolderId: rootCandidates[0]?.id ?? "",
        searchedRoots,
        duplicateGroups: duplicatePlans.length,
        foldersMerged,
        suppliersFixed,
        duplicateSubfoldersRemoved,
        filesMoved,
        finalSupplierCount: canonicalSupplierFolders.size,
        finalFolderStructure,
        groups: duplicatePlans,
      },
    });
  } catch (err) {
    console.error("[debug/drive/merge-duplicate-folders] job failed", errorDetails(err));
    updateDriveMergeJob(jobId, {
      status: "error",
      progress: "Drive duplicate folder merge failed",
      error: err instanceof Error ? err.message : "Drive duplicate folder merge failed",
    });
  }
}

function escapeDriveMergeQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function sortDriveFoldersByCreatedTime(a: DriveMergeFolder, b: DriveMergeFolder) {
  const aTime = a.createdTime ? new Date(a.createdTime).getTime() : Number.MAX_SAFE_INTEGER;
  const bTime = b.createdTime ? new Date(b.createdTime).getTime() : Number.MAX_SAFE_INTEGER;
  return aTime - bTime;
}

function canonicalDocumentFolderName(name: string): string | null {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^(invoice|invoices|חשבונית|חשבוניות)$/.test(normalized)) return "Invoices";
  if (/^(receipt|receipts|קבלה|קבלות)$/.test(normalized)) return "Receipts";
  if (/^(payment request|payment requests|דרישת תשלום|בקשת תשלום|בקשות תשלום)$/.test(normalized)) return "Payment Requests";
  if (/^(missing invoice|missing invoices|חשבוניות חסרות|חשבונית חסרה)$/.test(normalized)) return "Missing Invoices";
  if (/^(other|אחר|שונות)$/.test(normalized)) return "Other";
  return null;
}

apiRouter.post("/debug/drive/merge-duplicate-folders", (req, res) => {
  cleanupOldDriveMergeJobs();
  const dryRun = (req.body as { dryRun?: boolean } | undefined)?.dryRun !== false;
  const jobId = randomUUID();
  driveMergeJobs.set(jobId, {
    id: jobId,
    organizationId: req.auth!.organizationId,
    dryRun,
    status: "running",
    progress: dryRun ? "Queued dry-run Drive duplicate folder scan" : "Queued real Drive duplicate folder merge",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  void runDriveDuplicateFolderMergeJob(jobId, req.auth!.organizationId, dryRun);

  res.status(202).json({
    jobId,
    id: jobId,
    dryRun,
    status: "running",
    progress: dryRun ? "Queued dry-run Drive duplicate folder scan" : "Queued real Drive duplicate folder merge",
  });
});

apiRouter.get("/debug/drive/merge-status/:jobId", (req, res) => {
  const job = driveMergeJobs.get(req.params.jobId);
  if (!job || job.organizationId !== req.auth!.organizationId) {
    res.status(404).json({ error: "Drive merge job not found" });
    return;
  }

  res.json({
    jobId: job.id,
    id: job.id,
    dryRun: job.dryRun,
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
  });
});

apiRouter.get("/debug/invoices-auth", async (req, res) => {
  try {
    const organizationId = req.auth!.organizationId;
    const userId = req.auth!.userId;
    const email = req.auth!.email;
    const [invoiceCount, supplierPaymentCount, gmailScanItemCount, invoiceScanItemCount] = await Promise.all([
      prisma.invoice.count({ where: { organizationId } }),
      prisma.supplierPayment.count({ where: { organizationId } }),
      prisma.gmailScanItem.count({ where: { organizationId } }),
      prisma.gmailScanItem.count({ where: { organizationId, documentType: { in: ["invoice", "receipt"] } } }),
    ]);
    const latestInvoiceRows = await prisma.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        organizationId: true,
        clientId: true,
        invoiceNumber: true,
        amount: true,
        currency: true,
        date: true,
        status: true,
        driveUrl: true,
        emailId: true,
        gmailMessageId: true,
        createdAt: true,
        client: { select: { id: true, organizationId: true, name: true, email: true, domain: true } },
      },
    });
    const latestInvoiceScanItems = await prisma.gmailScanItem.findMany({
      where: { organizationId, documentType: { in: ["invoice", "receipt"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        organizationId: true,
        emailMessageId: true,
        gmailMessageId: true,
        subject: true,
        amount: true,
        supplierName: true,
        documentType: true,
        driveFileLink: true,
        reviewStatus: true,
        decisionReason: true,
        createdAt: true,
      },
    });
    const latestGmailScanLogs = await prisma.syncLog.findMany({
      where: { organizationId, type: "gmail_scan" },
      orderBy: { startedAt: "desc" },
      take: 5,
      select: {
        id: true,
        organizationId: true,
        status: true,
        scanMode: true,
        emailsProcessed: true,
        emailsSaved: true,
        invoicesFound: true,
        paymentsCreated: true,
        driveUploaded: true,
        sheetsUpdated: true,
        errorsCount: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true,
      },
    });

    res.json({
      authenticatedUser: { userId, email, organizationId },
      database: { host: databaseHost() },
      counts: {
        invoiceCount,
        supplierPaymentCount,
        gmailScanItemCount,
        invoiceScanItemCount,
      },
      latestInvoiceRows,
      latestInvoiceScanItems,
      latestGmailScanLogs,
    });
  } catch (err) {
    console.error("[debug/invoices-auth] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Invoice auth debug failed" });
  }
});

apiRouter.post("/debug/gmail/test-fetch", async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const integration = await debugGmailIntegrationForAuth(req.auth!);
  const base = debugGmailBase(req.auth!, integration);
  if (!integration?.refreshToken) {
    res.status(409).json({ ...base, error: "GMAIL_NOT_CONNECTED", errors: 1 });
    return;
  }

  try {
    const { getGoogleClients } = await import("../services/google.js");
    const { gmail } = await getGoogleClients(organizationId);
    const result = await gmail.users.messages.list({
      userId: "me",
      q: "newer_than:90d -category:promotions -category:social -in:spam -in:trash",
      maxResults: 10,
    });
    const messages = result.data.messages ?? [];
    const firstMessage = messages.find((message) => message.id);
    let trace: Record<string, unknown> = {
      parserRejected: true,
      rejectReason: "NO_MESSAGES_RETURNED",
      dbSaveAttempted: false,
    };
    let emailsSaved = 0;

    if (firstMessage?.id) {
      console.log(`[debug/gmail/test-fetch] trace start org=${organizationId} message=${firstMessage.id}`);
      const full = await gmail.users.messages.get({
        userId: "me",
        id: firstMessage.id,
        format: "full",
      });
      const headers = full.data.payload?.headers ?? [];
      const subject = headers.find((header) => header.name === "Subject")?.value ?? "(no subject)";
      const from = headers.find((header) => header.name === "From")?.value ?? "";
      const dateHeader = headers.find((header) => header.name === "Date")?.value ?? "";
      const receivedAt = dateHeader ? new Date(dateHeader) : new Date();
      const bodyText = debugBodyText(full.data.payload as DebugPayloadPart | undefined);
      const attachmentNames = debugAttachmentNames(full.data.payload as DebugPayloadPart | undefined);
      const parserRejected = bodyText.length === 0 && attachmentNames.length === 0;
      const rejectReason = parserRejected ? "EMPTY_BODY_AND_NO_ATTACHMENTS" : null;

      console.log(`[debug/gmail/test-fetch] message=${firstMessage.id} subject="${subject}" from="${from}" date="${receivedAt.toISOString()}" bodyLength=${bodyText.length} attachments=${attachmentNames.join(",") || "none"} parserRejected=${parserRejected} reason=${rejectReason ?? "accepted"}`);
      console.log(`[debug/gmail/test-fetch] DB save attempt message=${firstMessage.id}`);
      const emailRecord = await prisma.emailMessage.upsert({
        where: {
          organizationId_gmailId: {
            organizationId,
            gmailId: firstMessage.id,
          },
        },
        create: {
          organizationId,
          gmailId: firstMessage.id,
          threadId: full.data.threadId ?? undefined,
          subject,
          fromAddress: from,
          snippet: full.data.snippet ?? undefined,
          bodyText,
          receivedAt,
          source: "gmail",
        },
        update: {
          subject,
          fromAddress: from,
          snippet: full.data.snippet ?? undefined,
          bodyText,
          receivedAt,
        },
      });
      console.log(`[debug/gmail/test-fetch] DB EmailMessage upsert success message=${firstMessage.id} id=${emailRecord.id}`);

      const duplicateKey = createHash("sha256")
        .update(`${firstMessage.id}|debug-trace`)
        .digest("hex")
        .slice(0, 40);
      const scanItem = await prisma.gmailScanItem.upsert({
        where: {
          organizationId_duplicateKey: {
            organizationId,
            duplicateKey,
          },
        },
        create: {
          organizationId,
          emailMessageId: emailRecord.id,
          gmailMessageId: firstMessage.id,
          gmailMessageLink: `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(firstMessage.id)}`,
          sender: from || "unknown",
          senderEmail: null,
          subject,
          occurredAt: receivedAt,
          supplierName: from || "unknown",
          documentType: parserRejected ? "unknown_needs_review" : "supplier_message",
          attachmentFilename: attachmentNames[0] ?? null,
          confidenceScore: "low",
          reviewStatus: "needs_review",
          duplicateKey,
          decisionReason: rejectReason ?? "Debug trace accepted message for persistence verification",
          rawAnalysis: {
            debugTrace: true,
            bodyLength: bodyText.length,
            attachments: attachmentNames,
            snippet: full.data.snippet ?? null,
          },
        },
        update: {
          emailMessageId: emailRecord.id,
          subject,
          occurredAt: receivedAt,
          attachmentFilename: attachmentNames[0] ?? null,
          decisionReason: rejectReason ?? "Debug trace accepted message for persistence verification",
          rawAnalysis: {
            debugTrace: true,
            bodyLength: bodyText.length,
            attachments: attachmentNames,
            snippet: full.data.snippet ?? null,
          },
        },
      });
      emailsSaved = 1;
      console.log(`[debug/gmail/test-fetch] DB GmailScanItem upsert success message=${firstMessage.id} id=${scanItem.id}`);
      console.log(`[debug/gmail/test-fetch] Drive upload attempt skipped message=${firstMessage.id} reason=debug_test_fetch_no_attachment_upload`);
      trace = {
        gmailMessageId: firstMessage.id,
        subject,
        from,
        date: receivedAt.toISOString(),
        rawParsedBodyLength: bodyText.length,
        attachmentNames,
        parserRejected,
        rejectReason,
        dbSaveAttempted: true,
        emailMessageId: emailRecord.id,
        gmailScanItemId: scanItem.id,
        driveUploadAttempted: false,
        driveUploadResult: "skipped_debug_test_fetch",
      };
    }

    res.json({
      ...base,
      connected: true,
      emailsFetched: messages.length,
      emailsSaved,
      errors: 0,
      messageIds: messages.map((message) => message.id).filter(Boolean),
      trace,
    });
  } catch (err) {
    console.error("[debug/gmail/test-fetch] trace failed", err);
    res.status(500).json({
      ...base,
      errors: 1,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

apiRouter.post("/debug/gmail/scan-90", async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const integration = await debugGmailIntegrationForAuth(req.auth!);
  const base = debugGmailBase(req.auth!, integration);
  if (!integration?.refreshToken) {
    res.status(409).json({ ...base, error: "GMAIL_NOT_CONNECTED", errors: 1 });
    return;
  }

  try {
    const { syncGmailForOrganization } = await import("../services/gmail-sync.js");
    const { scanLog, created } = await createRunningGmailScanLog(organizationId, "manual");
    if (created) {
      void syncGmailForOrganization(organizationId, {
        daysBack: 90,
        forceReprocess: true,
        scanLogId: scanLog.id,
        scanMode: "manual",
      }).catch((err) => {
        console.error(`[debug/gmail/scan-90] background scan failed org=${organizationId} scanId=${scanLog.id}`, err);
      });
    }
    res.json({
      ...base,
      connected: true,
      scanId: scanLog.id,
      status: created ? "started" : "running",
      inProgress: true,
      progressUrl: `/api/gmail/scan/${scanLog.id}`,
    });
  } catch (err) {
    res.status(500).json({
      ...base,
      errors: 1,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});


apiRouter.post("/automation/first-scan", async (req, res) => {
  const { scheduler } = await import("../services/scheduler.js");
  scheduler.runFirstTimeScan(req.auth!.organizationId).catch((err) => {
    console.error("[automation] first-time scan failed", err);
  });
  res.json({ started: true, message: "ברוך הבא! מתחיל סריקה ראשונית..." });
});

apiRouter.get("/automation/scan-status", async (req, res) => {
  try {
  type ScanStatusLog = {
    id: string;
    type: string;
    status: string;
    found: number;
    saved: number;
    invoicesFound?: number;
    paymentsFound?: number;
    driveUploaded?: number;
    sheetsUpdated?: number;
    errors: string | null;
    windowTruncated?: boolean;
    totalMatched?: number | null;
    startedAt: Date;
    endedAt: Date | null;
  };

  const organizationId = req.auth!.organizationId;
  await closeStaleGmailScansForOrg(organizationId);
  // watchdog: סוגר זומבים בטבלת ScanLog הישנה (אין לה מנגנון סגירה אחר) —
  // בלעדיו שורת "running" יתומה מציגה "סורק..." לנצח בדשבורד. ממוסת ל-5 דק'.
  await reapOverdueLegacyScanLogsThrottled().catch((err) =>
    console.warn(`[scan-watchdog] reap failed: ${err instanceof Error ? err.message : String(err)}`)
  );
  // Reliability Center: persist/heal stale banner + stuck jobs safely (additive).
  void import("../services/reliability/center/reliabilitySelfHealing.js")
    .then(({ runReliabilitySelfHealing }) => runReliabilitySelfHealing({ organizationId }))
    .catch((err) =>
      console.warn(
        `[reliability] self-healing failed: ${err instanceof Error ? err.message : String(err)}`
      )
    );

  const [scanLogs, syncLogs] = await Promise.all([
    prisma.$queryRawUnsafe<ScanStatusLog[]>(
    'SELECT "id", "type", "status", "found", "saved", "errors", "startedAt", "endedAt" FROM "ScanLog" WHERE "orgId" = $1 ORDER BY "startedAt" DESC LIMIT 10',
    req.auth!.organizationId
    ),
    prisma.syncLog.findMany({
      where: { organizationId, type: "gmail_scan" },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: {
        id: true,
        type: true,
        status: true,
        emailsProcessed: true,
        emailsSaved: true,
        invoicesFound: true,
        paymentsCreated: true,
        tasksCreated: true,
        driveUploaded: true,
        sheetsUpdated: true,
        errorsCount: true,
        windowTruncated: true,
        totalMatched: true,
        scanMode: true,
        nextRetryAt: true,
        errorMessage: true,
        startedAt: true,
        updatedAt: true,
        finishedAt: true,
      },
    }),
  ]);

  const mapSyncLog = (log: (typeof syncLogs)[number]): ScanStatusLog => {
    const apiStatus = toApiGmailScanStatus(log.status, {
      errorsCount: log.errorsCount,
      errorMessage: log.errorMessage,
    });
    const mappedStatus =
      apiStatus === "error" || apiStatus === "failed"
        ? "failed"
        : apiStatus === "timed_out"
          ? "timed_out"
          : apiStatus === "stale"
            ? "stale"
            : apiStatus === "paused"
              ? "paused"
              : apiStatus === "cancelled"
                ? "cancelled"
                : apiStatus === "queued"
                  ? "queued"
                  : apiStatus;
    return {
      id: log.id,
      type: log.type,
      status: mappedStatus,
      found: log.emailsProcessed,
      saved: log.emailsSaved || log.paymentsCreated + log.tasksCreated,
      invoicesFound: log.invoicesFound,
      paymentsFound: log.paymentsCreated,
      driveUploaded: log.driveUploaded,
      sheetsUpdated: log.sheetsUpdated,
      errors: log.errorMessage || (log.errorsCount ? `${log.errorsCount} errors` : null),
      windowTruncated: log.windowTruncated,
      totalMatched: log.totalMatched,
      startedAt: log.startedAt,
      endedAt: log.finishedAt,
    };
  };

  // SyncLog is the authoritative Gmail scan source; legacy ScanLog is history-only.
  const syncMapped = syncLogs.map(mapSyncLog);
  const logs: ScanStatusLog[] = [...syncMapped, ...scanLogs]
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, 10);

  const last = syncMapped[0] ?? logs[0] ?? null;
  const hasActiveScan = syncMapped.some((log) => log.status === "running" || log.status === "queued");
  const activeOrLastSync = syncLogs[0] ?? null;
  const progressSnapshot = activeOrLastSync
    ? await buildGmailScanProgress(organizationId, activeOrLastSync.id)
    : null;
  const hasStaleTerminalBanner =
    !hasActiveScan &&
    logs.some((log) => log.status === "stale" || log.status === "timed_out" || log.status === "failed" || log.status === "error");
  if (hasStaleTerminalBanner) {
    void import("../services/reliability/center/reliabilitySelfHealing.js")
      .then(({ noteStaleDashboardBanner }) =>
        noteStaleDashboardBanner({
          organizationId,
          userId: req.auth!.userId,
          reason: `scan-status last=${last?.status ?? "none"}`,
        })
      )
      .catch(() => undefined);
  }
  const nextDaily = new Date();
  nextDaily.setHours(3, 0, 0, 0);
  if (nextDaily <= new Date()) nextDaily.setDate(nextDaily.getDate() + 1);
  res.json({
    last,
    logs,
    nextScheduledScanAt: nextDaily.toISOString(),
    // Authoritative dashboard contract (read recovers stale queued/running first).
    status: progressSnapshot?.authoritativeStatus ?? (hasActiveScan ? "running" : "idle"),
    scanId: progressSnapshot?.scanId ?? last?.id ?? null,
    startedAt: progressSnapshot?.startedAt ?? last?.startedAt ?? null,
    lastProgressAt: progressSnapshot?.lastProgressAt ?? null,
    currentStage: progressSnapshot?.currentStage ?? null,
    processedEmails: progressSnapshot?.emailsFetched ?? last?.found ?? 0,
    savedDocuments: progressSnapshot?.documentsFound ?? last?.saved ?? 0,
    failureReason: progressSnapshot?.failureReason ?? last?.errors ?? null,
    canStartNewScan: progressSnapshot?.canStartNewScan ?? !hasActiveScan,
    userMessageHe: progressSnapshot?.userMessageHe ?? null,
    progress: progressSnapshot,
  });
  } catch (err) {
    console.error("[automation/scan-status] failed", err);
    res.json({
      last: null,
      logs: [],
      nextScheduledScanAt: null,
      degraded: true,
      status: "idle",
      scanId: null,
      canStartNewScan: true,
      userMessageHe: "לא הצלחתי לבדוק את מצב הסריקה. אפשר לנסות שוב.",
    });
  }
});

apiRouter.post("/help/auto-fix/invoices", async (req, res) => {
  try {
    const { getGoogleClients } = await import("../services/google.js");
    const { syncGmailForOrganization } = await import("../services/gmail-sync.js");
    const { gmail } = await getGoogleClients(req.auth!.organizationId);

    const labelName = "AI Office Worker - חשבוניות";
    const labels = await gmail.users.labels.list({ userId: "me" });
    const existingLabel = labels.data.labels?.find((label) => label.name === labelName);
    let labelCreated = false;
    if (!existingLabel) {
      await gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name: labelName,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        },
      });
      labelCreated = true;
    }

    const { scanLog, created } = await createRunningGmailScanLog(req.auth!.organizationId, "manual");
    if (created) {
      void syncGmailForOrganization(req.auth!.organizationId, {
        daysBack: 90,
        forceReprocess: true,
        scanLogId: scanLog.id,
        scanMode: "manual",
      }).catch((err) => {
        console.error(`[help/auto-fix/invoices] background scan failed org=${req.auth!.organizationId} scanId=${scanLog.id}`, err);
      });
    }
    res.json({
      success: true,
      labelCreated,
      scanId: scanLog.id,
      status: created ? "started" : "running",
      inProgress: true,
      progressUrl: `/api/gmail/scan/${scanLog.id}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auto fix failed";
    if (message === "Gmail not connected") {
      res.status(409).json({ error: "Gmail לא מחובר - לחץ כאן לחיבור", code: "GMAIL_NOT_CONNECTED" });
      return;
    }
    res.status(500).json({ error: `התיקון האוטומטי נכשל: ${message}` });
  }
});

apiRouter.get("/dashboard", async (req, res) => {
  const stats = await getDashboardStats(req.auth!.organizationId);
  res.json(stats);
});

apiRouter.get(ACCURACY_ANALYTICS_ROUTE_PATH, async (req, res) => {
  try {
    const organizationId = req.auth!.organizationId;
    const query = parseAccuracyAnalyticsQuery(req.query as Record<string, unknown>);
    const analytics = await getAccuracyAnalyticsForOrganization(prisma, organizationId, query);
    res.json(analytics);
  } catch (err) {
    console.error("[internal/analytics/accuracy] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Accuracy analytics failed" });
  }
});

apiRouter.get(VERIFICATION_CENTER_ROUTE_PATH, async (req, res) => {
  try {
    const organizationId = req.auth!.organizationId;
    const query = parseVerificationQuery(req.query as Record<string, unknown>);
    const verification = await getVerificationCenterForOrganization(prisma, organizationId, query);
    res.json(verification);
  } catch (err) {
    console.error("[internal/verification] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Verification center failed" });
  }
});

apiRouter.get("/stats", async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const [stats, totalClients, openInvoices] = await Promise.all([
    getDashboardStats(organizationId),
    prisma.client.count({ where: { organizationId, isActive: true } }),
    prisma.invoice.count({ where: { organizationId, status: { not: "paid" } } }),
  ]);
  const sheetsReconciliation = await import("../services/supplierPaymentsSheet.js")
    .then(({ getSupplierPaymentsSheetReconciliation }) => getSupplierPaymentsSheetReconciliation(organizationId))
    .catch((err) => {
      console.warn("[stats] supplier payments sheet reconciliation failed", err instanceof Error ? err.message : String(err));
      return null;
    });

  res.json({
    ...stats,
    sheetsReconciliation,
    totalClients,
    openInvoices,
    amountToReceive: stats.moneyToReceive,
    amountToPay: stats.moneyToPay,
    summary: {
      totalClients,
      openInvoices,
      amountToReceive: stats.moneyToReceive,
      amountToPay: stats.moneyToPay,
      currency: stats.currency,
    },
  });
});

apiRouter.get("/dashboard/home-metrics", async (req, res) => {
  try {
  const payload = await getDashboardHomeMetrics(req.auth!.organizationId);
    res.json(payload);
  } catch (err) {
    console.error("[dashboard/home-metrics] failed", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to load dashboard home metrics" });
  }
});

apiRouter.get("/dashboard/bootstrap", async (req, res) => {
  const wallStart = res.locals.dashboardBootstrapWallStart ?? performance.now();
  const authStart = res.locals.dashboardBootstrapAuthStart ?? wallStart;
  const authEnd = res.locals.dashboardBootstrapAuthEnd ?? authStart;
  const tenantStart = res.locals.dashboardBootstrapTenantStart ?? authEnd;
  const tenantEnd = res.locals.dashboardBootstrapTenantEnd ?? tenantStart;
  const authMs = res.locals.dashboardBootstrapAuthMs ?? Math.max(0, Math.round(authEnd - authStart));
  const tenantMs = res.locals.dashboardBootstrapTenantMs ?? Math.max(0, Math.round(tenantEnd - tenantStart));
  const tenantCacheSource = res.locals.dashboardBootstrapTenantCacheSource ?? "unknown";
  const tenantDbMs =
    res.locals.dashboardBootstrapTenantDbMs ?? (tenantCacheSource === "hit" ? 0 : tenantMs);
  const collectTiming = process.env.DASHBOARD_BOOTSTRAP_TIMING === "1";

  try {
    const cached = await getDashboardBootstrapCached({
      userId: req.auth!.userId,
      organizationId: req.auth!.organizationId,
      collectTiming,
    });
    assertDashboardBootstrapPayloadBounds(cached.payload);

    const buildTiming = cached.timing;
    const fromCache = cached.cacheSource === "hit" || cached.cacheSource === "stale";
    const settingsMs = fromCache ? 0 : (buildTiming?.settingsWallMs ?? buildTiming?.organizationSettingsMs ?? 0);
    const homeMetricsMs = fromCache ? 0 : (buildTiming?.homeMetricsWallMs ?? buildTiming?.metricsWaveMs ?? 0);
    const gmailStatusMs = fromCache ? 0 : (buildTiming?.gmailStatusMs ?? 0);
    const tasksMs = fromCache ? 0 : (buildTiming?.tasksPreviewMs ?? 0);
    const queryWaitMs = fromCache ? 0 : (buildTiming?.queryWaitMs ?? 0);
    const mapMs = fromCache ? 0 : (buildTiming?.mapMs ?? 0);

    const serializeT0 = performance.now();
    const body = JSON.stringify(cached.payload);
    const serializeMs = Math.round(performance.now() - serializeT0);

    const responseT0 = performance.now();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const responseMs = Math.round(performance.now() - responseT0);
    const totalMs = Math.round(performance.now() - wallStart);

    const timingBase: Omit<DashboardBootstrapEndpointTiming, "unaccountedMs"> = {
      preRouteMs: Math.max(0, Math.round(authStart - wallStart)),
      authMs,
      tenantMs,
      tenantDbMs,
      organizationResolutionMs: 0,
      settingsMs,
      homeMetricsMs,
      gmailStatusMs,
      tasksMs,
      queryWaitMs,
      mapMs,
      serializeMs,
      responseMs,
      middlewareMs: Math.max(0, Math.round(tenantEnd - authEnd)),
      totalMs,
      tenantDbRoundTrips: tenantCacheSource === "hit" ? 0 : 2,
      orgLookupCount: cached.cacheSource === "hit" || cached.cacheSource === "stale" ? 0 : 1,
      bootstrapCacheSource: cached.cacheSource,
      bootstrapCacheAgeMs: cached.cacheAgeMs,
      bootstrapBuildMs: cached.buildMs,
    };
    const timing: DashboardBootstrapEndpointTiming = {
      ...timingBase,
      unaccountedMs: computeDashboardBootstrapUnaccountedMs(timingBase),
    };
    res.setHeader("Server-Timing", buildDashboardBootstrapServerTiming(timing));
    res.setHeader("X-Dashboard-Bootstrap-Cache", cached.cacheSource);
    res.send(body);
    logDashboardBootstrapTimingSafe(timing, {
      tenantCacheSource,
      tenantCacheAgeMs: res.locals.dashboardBootstrapTenantCacheAgeMs ?? null,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error("[dashboard/bootstrap] failed", raw);
    const classified = classifyDashboardBootstrapFailure(raw);
    res.status(classified.status).json({
      error: classified.error,
      code: classified.code,
    });
  }
});

apiRouter.get("/communications", requirePerm("chat.use"), async (req, res) => {
  const channel = typeof req.query.channel === "string" ? req.query.channel.trim() : undefined;
  const direction = typeof req.query.direction === "string" ? req.query.direction.trim() : undefined;
  const correlationId =
    typeof req.query.correlationId === "string" ? req.query.correlationId.trim().slice(0, 128) : undefined;
  if (correlationId && !/^[a-zA-Z0-9:_-]+$/.test(correlationId)) {
    res.status(400).json({ error: "Invalid correlationId" });
    return;
  }
  const fromRaw = typeof req.query.from === "string" ? req.query.from.trim() : undefined;
  const toRaw = typeof req.query.to === "string" ? req.query.to.trim() : undefined;
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? "50"), 10) || 50));
  const fromDate = fromRaw ? new Date(fromRaw) : undefined;
  const toDate = toRaw ? new Date(toRaw) : undefined;

  if (fromDate && Number.isNaN(fromDate.getTime())) {
    res.status(400).json({ error: "Invalid from date" });
    return;
  }
  if (toDate && Number.isNaN(toDate.getTime())) {
    res.status(400).json({ error: "Invalid to date" });
    return;
  }

  try {
    const result = await communicationService.loadCommunicationHistory({
      organizationId: req.auth!.organizationId,
      channel: channel || undefined,
      direction: direction || undefined,
      correlationId: correlationId || undefined,
      fromDate,
      toDate,
      offset: (page - 1) * limit,
      limit,
    });
    res.json({
      ...result,
      page,
    });
  } catch (err) {
    console.error("[communications] list failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load communications" });
  }
});

apiRouter.post("/natalie/ask", requirePerm("chat.use"), async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  const history = Array.isArray(req.body?.history)
    ? req.body.history
        .filter((item: unknown): item is { role: "user" | "assistant"; content: string } => {
          if (!item || typeof item !== "object") return false;
          const message = item as { role?: unknown; content?: unknown };
          return (message.role === "user" || message.role === "assistant") && typeof message.content === "string" && message.content.trim().length > 0;
        })
        .map((item: { role: "user" | "assistant"; content: string }) => ({ role: item.role, content: item.content.trim() }))
        .slice(-10)
    : [];
  const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : null;
  const channel = req.body?.channel === "web_voice" ? "web_voice" : "web_chat";
  const modality = req.body?.modality === "voice" ? "voice" : "text";
  const requestId = readRequestId(req);
  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  try {
    await recordWebChatCommunication({
      organizationId: req.auth!.organizationId,
      userId: req.auth!.userId,
      message: question,
      sessionId,
      correlationId: sessionId ?? undefined,
    });
    const result = await processNatalieTurn({
      organizationId: req.auth!.organizationId,
      userId: req.auth!.userId,
      channel,
      modality,
      message: question,
      requestId,
      sessionId,
      legacyHistory: sessionId ? undefined : history,
    });
    res.json(result);
  } catch (err) {
    console.error("[natalie/ask] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Natalie failed to answer" });
  }
});

apiRouter.get("/natalie/session", requirePerm("chat.use"), async (req, res) => {
  const sessionId = typeof req.query?.sessionId === "string" ? req.query.sessionId.trim() : "";
  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  try {
    const session = await getConversationSession({
      sessionId,
      organizationId: req.auth!.organizationId,
      userId: req.auth!.userId,
    });

    if (!session) {
      res.status(404).json({ status: "missing", sessionId });
      return;
    }

    if (isConversationSessionExpired(session)) {
      res.status(410).json({ status: "expired", sessionId, lastMessageAt: session.lastMessageAt });
      return;
    }

    res.json({
      status: "active",
      session: {
        id: session.id,
        currentChannel: session.currentChannel,
        structuredHistory: session.structuredHistory,
        pendingAction: session.pendingAction,
        pendingConfirmation: session.pendingConfirmation,
        interruptionState: session.interruptionState,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        lastMessageAt: session.lastMessageAt,
      },
    });
  } catch (err) {
    console.error("[natalie/session] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load Natalie session" });
  }
});

apiRouter.post("/natalie/voice/turn", requirePerm("chat.use"), async (req, res) => {
  const transcript = typeof req.body?.transcript === "string" ? req.body.transcript.trim() : "";
  const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : null;
  const turnId = typeof req.body?.turnId === "string" ? req.body.turnId.trim() : "";
  const history = Array.isArray(req.body?.history)
    ? req.body.history
        .filter((item: unknown): item is { role: "user" | "assistant"; content: string } => {
          if (!item || typeof item !== "object") return false;
          const message = item as { role?: unknown; content?: unknown };
          return (message.role === "user" || message.role === "assistant") && typeof message.content === "string" && message.content.trim().length > 0;
        })
        .map((item: { role: "user" | "assistant"; content: string }) => ({ role: item.role, content: item.content.trim() }))
        .slice(-10)
    : [];
  if (!transcript) {
    res.status(400).json({ error: "transcript is required" });
    return;
  }
  if (!turnId) {
    res.status(400).json({ error: "turnId is required" });
    return;
  }

  const requestId = readRequestId(req);
  const idempotencyBody = { transcript, sessionId, turnId };

  try {
    const idempotency = await beginVoiceTurnIdempotency({
      prisma,
      organizationId: req.auth!.organizationId,
      turnId,
      body: idempotencyBody,
    });

    if (idempotency.mode === "replay") {
      res.json({
        ...(typeof idempotency.responseBody === "object" && idempotency.responseBody
          ? idempotency.responseBody
          : { answer: String(idempotency.responseBody ?? "") }),
        idempotentReplay: true,
      });
      return;
    }

    await recordVoiceCommunication({
      organizationId: req.auth!.organizationId,
      userId: req.auth!.userId,
      turnId,
      transcript,
      sessionId,
      correlationId: turnId,
    });

    const result = await processVoiceTurn({
      organizationId: req.auth!.organizationId,
      userId: req.auth!.userId,
      transcript,
      sessionId,
      turnId,
      legacyHistory: sessionId ? undefined : history,
      requestId,
    });

    const responseBody = { ...result, requestId: requestId ?? null, turnId };
    if (idempotency.mode === "active") {
      await completeVoiceTurnIdempotency({
        prisma,
        recordId: idempotency.recordId,
        responseBody,
      });
    }
    res.json(responseBody);
  } catch (err) {
    console.error("[natalie/voice/turn] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Natalie voice turn failed" });
  }
});

apiRouter.post("/natalie/create-task", requirePerm("chat.use"), async (req, res) => {
  const body = (req.body ?? {}) as { title?: unknown; dueDate?: unknown; notes?: unknown };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (!title) {
    res.status(400).json({ error: "Task title is required" });
    return;
  }

  const dueDate = typeof body.dueDate === "string" && body.dueDate.trim() ? new Date(body.dueDate) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    res.status(400).json({ error: "Invalid due date" });
    return;
  }

  try {
    const task = await createTask({
      organizationId: req.auth!.organizationId,
      title,
      description: notes || null,
      dueDate,
      source: "natalie",
      status: "open",
    });
    res.status(201).json(task);
  } catch (err) {
    console.error("[natalie/create-task] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Task creation failed" });
  }
});

apiRouter.post("/natalie/create-appointment", requireCalendarCreate, async (req, res) => {
  const body = (req.body ?? {}) as {
    clientName?: unknown;
    clientId?: unknown;
    clientPhone?: unknown;
    clientEmail?: unknown;
    address?: unknown;
    dayReference?: unknown;
    time?: unknown;
    startTime?: unknown;
    durationMinutes?: unknown;
    serviceName?: unknown;
    notes?: unknown;
    employeeId?: unknown;
  };
  const organizationId = req.auth!.organizationId;
  const userId = req.auth!.userId;
  recordCalendarAudit({
    organizationId,
    entityType: "natalie_calendar",
    entityId: userId,
    action: "natalie_calendar_intent_detected",
    actor: { actorType: "AI", actorUserId: userId },
    sourceModule: "natalie-api",
    sourceRoute: "POST /natalie/create-appointment",
    metadata: {
      intent: "create_appointment",
      customerName: typeof body.clientName === "string" ? body.clientName : null,
      source: "natalie",
    },
  });

  try {
    const response = await handleIdempotentRequest({
      req,
      routeKey: "POST:/natalie/create-appointment",
      organizationId,
      body: body as Record<string, unknown>,
      execute: async () => {
        const result = await bookAppointmentViaNatalie({
          organizationId,
          userId,
          clientName: typeof body.clientName === "string" ? body.clientName : "",
          clientId: typeof body.clientId === "string" ? body.clientId : undefined,
          clientPhone: typeof body.clientPhone === "string" ? body.clientPhone : undefined,
          clientEmail: typeof body.clientEmail === "string" ? body.clientEmail : undefined,
          address: typeof body.address === "string" ? body.address : undefined,
          dayReference: typeof body.dayReference === "string" ? body.dayReference : undefined,
          time: typeof body.time === "string" ? body.time : undefined,
          startTime: typeof body.startTime === "string" ? body.startTime : undefined,
          durationMinutes:
            typeof body.durationMinutes === "number" && Number.isFinite(body.durationMinutes)
              ? body.durationMinutes
              : undefined,
          serviceName: typeof body.serviceName === "string" ? body.serviceName : undefined,
          notes: typeof body.notes === "string" ? body.notes : undefined,
          employeeId: typeof body.employeeId === "string" ? body.employeeId : undefined,
        });

        if (!result.engine) {
          return { statusCode: 201, body: result.appointment };
        }

        return {
          statusCode: 201,
          body: {
            id: result.calendarEventId,
            organizationId,
            clientId: result.clientId,
            startTime: result.startTime,
            durationMinutes: result.durationMinutes,
            status: result.status,
            source: "natalie",
            engineMode: true,
            pendingApproval: result.pendingApproval,
            decisionId: result.decisionId,
            queueType: result.queueType,
            message: result.message,
            workCaseId: result.workCaseId,
          },
        };
      },
    });
    res.status(response.statusCode).json(response.body);
  } catch (err) {
    recordCalendarAudit({
      organizationId,
      entityType: "natalie_calendar",
      entityId: userId,
      action: "natalie_calendar_action_failed",
      actor: { actorType: "AI", actorUserId: userId },
      sourceModule: "natalie-api",
      sourceRoute: "POST /natalie/create-appointment",
      reason: err instanceof Error ? err.message : String(err),
      metadata: { intent: "create_appointment", source: "natalie" },
    });
    if (err instanceof SchedulingFacadeError) {
      if (err.code === "multiple_clients") {
        res.status(409).json({
          error: err.message,
          code: err.code,
          clients: err.details?.clients,
        });
        return;
      }
      if (err.code === "bad_datetime") {
        res.status(400).json({ error: err.message, code: err.code });
        return;
      }
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof AppointmentConflictError) {
      res.status(409).json({
        error: err.message,
        code: "time_conflict",
      });
      return;
    }
    console.error("[natalie/create-appointment] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Appointment creation failed" });
  }
});

apiRouter.post("/natalie/cancel-appointment", requireCalendarCancel, async (req, res) => {
  const appointmentId = typeof req.body?.appointmentId === "string" ? req.body.appointmentId.trim() : "";
  if (!appointmentId) {
    res.status(400).json({ error: "appointmentId is required" });
    return;
  }

  recordCalendarAudit({
    organizationId: req.auth!.organizationId,
    entityType: "natalie_calendar",
    entityId: req.auth!.userId,
    action: "natalie_calendar_intent_detected",
    actor: { actorType: "AI", actorUserId: req.auth!.userId },
    sourceModule: "natalie-api",
    sourceRoute: "POST /natalie/cancel-appointment",
    metadata: { intent: "cancel_appointment", appointmentId, source: "natalie" },
  });
  try {
    const response = await handleIdempotentRequest({
      req,
      routeKey: "POST:/natalie/cancel-appointment",
      organizationId: req.auth!.organizationId,
      body: { appointmentId },
      execute: async () => {
        const result = await cancelAppointmentViaNatalie({
          organizationId: req.auth!.organizationId,
          userId: req.auth!.userId,
          schedulingItemId: appointmentId,
        });

        if (!result.engine) {
          return { statusCode: 200, body: { ok: true, appointment: result.appointment } };
        }

        return {
          statusCode: 200,
          body: {
            ok: true,
            pendingApproval: result.pendingApproval,
            decisionId: result.decisionId,
            queueType: result.queueType,
            message: result.message,
            engineMode: true,
          },
        };
      },
    });
    res.status(response.statusCode).json(response.body);
  } catch (err) {
    recordCalendarAudit({
      organizationId: req.auth!.organizationId,
      entityType: "natalie_calendar",
      entityId: req.auth!.userId,
      action: "natalie_calendar_action_failed",
      actor: { actorType: "AI", actorUserId: req.auth!.userId },
      sourceModule: "natalie-api",
      sourceRoute: "POST /natalie/cancel-appointment",
      reason: err instanceof Error ? err.message : String(err),
      metadata: { intent: "cancel_appointment", appointmentId, source: "natalie" },
    });
    if (err instanceof SchedulingFacadeError && err.code === "appointment_not_found") {
      res.status(404).json({ error: "התור לא נמצא", code: "appointment_not_found" });
      return;
    }
    if (err instanceof SchedulingFacadeError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    console.error("[natalie/cancel-appointment] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Appointment cancellation failed" });
  }
});

apiRouter.post("/natalie/reschedule-appointment", requireCalendarReschedule, async (req, res) => {
  const body = (req.body ?? {}) as {
    appointmentId?: unknown;
    newDayReference?: unknown;
    newTime?: unknown;
    newStartTime?: unknown;
  };
  const organizationId = req.auth!.organizationId;
  const appointmentId = typeof body.appointmentId === "string" ? body.appointmentId.trim() : "";
  if (!appointmentId) {
    res.status(400).json({ error: "appointmentId is required" });
    return;
  }

  recordCalendarAudit({
    organizationId,
    entityType: "natalie_calendar",
    entityId: req.auth!.userId,
    action: "natalie_calendar_intent_detected",
    actor: { actorType: "AI", actorUserId: req.auth!.userId },
    sourceModule: "natalie-api",
    sourceRoute: "POST /natalie/reschedule-appointment",
    metadata: { intent: "reschedule_appointment", appointmentId, source: "natalie" },
  });
  try {
    const response = await handleIdempotentRequest({
      req,
      routeKey: "POST:/natalie/reschedule-appointment",
      organizationId,
      body: body as Record<string, unknown>,
      execute: async () => {
        const result = await rescheduleAppointmentViaNatalie({
          organizationId,
          userId: req.auth!.userId,
          schedulingItemId: appointmentId,
          newDayReference: typeof body.newDayReference === "string" ? body.newDayReference : undefined,
          newTime: typeof body.newTime === "string" ? body.newTime : undefined,
          newStartTime: typeof body.newStartTime === "string" ? body.newStartTime : undefined,
        });

        if (!result.engine) {
          return { statusCode: 200, body: { ok: true, appointment: result.appointment } };
        }

        return {
          statusCode: 200,
          body: {
            ok: true,
            pendingApproval: result.pendingApproval,
            decisionId: result.decisionId,
            queueType: result.queueType,
            message: result.message,
            engineMode: true,
          },
        };
      },
    });
    res.status(response.statusCode).json(response.body);
  } catch (err) {
    recordCalendarAudit({
      organizationId,
      entityType: "natalie_calendar",
      entityId: req.auth!.userId,
      action: "natalie_calendar_action_failed",
      actor: { actorType: "AI", actorUserId: req.auth!.userId },
      sourceModule: "natalie-api",
      sourceRoute: "POST /natalie/reschedule-appointment",
      reason: err instanceof Error ? err.message : String(err),
      metadata: { intent: "reschedule_appointment", appointmentId, source: "natalie" },
    });
    if (err instanceof AppointmentConflictError) {
      res.status(409).json({
        error: "קיים תור אחר בזמן הזה",
        code: "time_conflict",
      });
      return;
    }
    if (err instanceof SchedulingFacadeError && err.code === "appointment_not_found") {
      res.status(404).json({ error: "התור לא נמצא", code: "appointment_not_found" });
      return;
    }
    if (err instanceof SchedulingFacadeError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    console.error("[natalie/reschedule-appointment] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Appointment reschedule failed" });
  }
});

apiRouter.post("/natalie/save-invoice-draft", requirePerm("payment.create"), async (req, res) => {
  const validation = validateInvoiceDraftInput(req.body);
  if (!validation.ok) {
    res.status(400).json({ error: validation.reason });
    return;
  }

  try {
    const draft = await saveInvoiceDraft({
      organizationId: req.auth!.organizationId,
      draft: validation.value,
    });
    res.status(201).json({
      ok: true,
      draftId: draft.id,
      confirmationMessage: INVOICE_DRAFT_SAVED_CONFIRMATION_MESSAGE,
    });
  } catch (err) {
    console.error("[natalie/save-invoice-draft] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Invoice draft save failed" });
  }
});

apiRouter.post("/natalie/invoice-import/preview", bankUpload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "קובץ נדרש" });
    return;
  }

  try {
    const preview = buildImportPreview({
      buffer: file.buffer,
      fileName: file.originalname || "import",
      mimeType: file.mimetype,
    });
    res.json(preview);
  } catch (err) {
    console.error("[natalie/invoice-import/preview] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Invoice import preview failed" });
  }
});

apiRouter.post("/natalie/invoice-import/save", requirePerm("payment.create"), async (req, res) => {
  const body = req.body as { rows?: unknown; mappings?: unknown };
  if (!Array.isArray(body.rows) || !Array.isArray(body.mappings)) {
    res.status(400).json({ error: "rows and mappings are required arrays" });
    return;
  }

  const rows = body.rows as string[][];
  const mappings = body.mappings as ColumnMapping[];

  const { drafts, warnings } = buildInvoiceDraftsFromRows({ rows, mappings });
  if (drafts.length === 0) {
    res.status(400).json({ error: "לא נמצאו שורות תקינות לשמירה", warnings });
    return;
  }

  try {
    const { savedCount, draftIds } = await saveInvoiceDraftsBatch({
      organizationId: req.auth!.organizationId,
      drafts,
    });
    res.status(201).json({
      ok: true,
      savedCount,
      draftIds,
      warnings,
      confirmationMessage: `✅ נשמרו ${savedCount} טיוטות פנימיות. אלה טיוטות בלבד — לא הונפקו חשבוניות מס רשמיות.`,
    });
  } catch (err) {
    console.error("[natalie/invoice-import/save] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Invoice import save failed" });
  }
});

apiRouter.get("/natalie/invoice-drafts", async (req, res) => {
  try {
    const drafts = await listOutgoingInvoiceDrafts({ organizationId: req.auth!.organizationId });
    const unissuedDrafts = drafts.filter((draft) => !draft.greenInvoiceDocumentId);
    const duplicateMap = findDuplicateDrafts(
      unissuedDrafts.map((draft) => ({
        id: draft.id,
        customerName: draft.customerName,
        customerEmail: draft.customerEmail,
        amount: draft.amount,
      }))
    );
    res.json(
      drafts.map((draft) => ({
        ...draft,
        duplicateOf: duplicateMap[draft.id] ?? [],
      }))
    );
  } catch (err) {
    console.error("[natalie/invoice-drafts] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Invoice drafts list failed" });
  }
});

apiRouter.delete("/natalie/invoice-drafts/:id", requirePerm("payment.delete"), async (req, res) => {
  try {
    const result = await deleteOutgoingInvoiceDraft({
      organizationId: req.auth!.organizationId,
      id: routeId(req),
    });
    if (!result.deleted) {
      res.status(404).json({ error: "טיוטה לא נמצאה" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[natalie/invoice-drafts/:id] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Invoice draft delete failed" });
  }
});

apiRouter.post("/natalie/invoice-drafts/:id/issue", requirePerm("payment.create"), async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const draftId = routeId(req);
  const result = await issueDraftHandler({
    draftId,
    organizationId,
    loadDraft: async (id, orgId) => {
      const row = await prisma.outgoingInvoiceDraft.findFirst({ where: { id, organizationId: orgId } });
      if (!row) return null;
      const draft: IssueDraftInput = {
        id: row.id,
        customerName: row.customerName,
        customerEmail: row.customerEmail ?? undefined,
        customerTaxId: row.customerTaxId ?? undefined,
        description: row.description,
        amount: row.amount,
        currency: row.currency,
        issueDate: row.issueDate ? row.issueDate.toISOString().slice(0, 10) : undefined,
        approvedAt: row.approvedAt,
        greenInvoiceDocumentId: row.greenInvoiceDocumentId,
      };
      return draft;
    },
    loadOrganization: (orgId) =>
      prisma.organization.findUnique({
        where: { id: orgId },
        select: { greenInvoiceApiKeyId: true, greenInvoiceApiSecret: true, greenInvoiceEnv: true },
      }),
    createDocument,
    saveDocumentId: async (id, documentId) => {
      await prisma.outgoingInvoiceDraft.updateMany({
        where: { id, organizationId },
        data: { greenInvoiceDocumentId: documentId, status: "issued" },
      });
    },
  });
  res.status(result.status).json(result.body);
});

apiRouter.post("/natalie/complete-task", requirePerm("chat.use"), async (req, res) => {
  const body = (req.body ?? {}) as { taskId?: unknown };
  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  if (!taskId) {
    res.status(400).json({ error: "Task id is required" });
    return;
  }

  try {
    const task = await completeTask({
      organizationId: req.auth!.organizationId,
      taskId,
    });
    if (!task) {
      res.status(404).json({ error: "Task not found for organization" });
      return;
    }
    res.json(task);
  } catch (err) {
    console.error("[natalie/complete-task] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Task completion failed" });
  }
});

export type NatalieVoiceCredentialsInput = {
  azure: {
    speechKey: string;
    speechRegion: string;
    speechVoice: string;
  };
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsModel: string;
  openAiApiKey: string;
  openAiModel: string;
  openAiVoice: string;
};

export function resolveNatalieVoiceSynthesizeProvider(
  provider: string
): "azure" | "elevenlabs" | "openai" | null {
  if (provider === "azure") return "azure";
  if (provider === "elevenlabs") return "elevenlabs";
  if (provider === "openai") return "openai";
  return null;
}

export function buildNatalieVoiceCredentials(aiVoice: NatalieVoiceCredentialsInput) {
  return {
    azureSpeechKey: aiVoice.azure.speechKey,
    azureSpeechRegion: aiVoice.azure.speechRegion,
    azureSpeechVoice: aiVoice.azure.speechVoice,
    elevenLabsApiKey: aiVoice.elevenLabsApiKey,
    elevenLabsVoiceId: aiVoice.elevenLabsVoiceId,
    elevenLabsModel: aiVoice.elevenLabsModel,
    openAiApiKey: aiVoice.openAiApiKey,
    openAiModel: aiVoice.openAiModel,
    openAiVoice: aiVoice.openAiVoice,
  };
}

apiRouter.post("/natalie/voice", requirePerm("chat.use"), async (req, res) => {
  const body = req.body as { text?: string };
  const text = body.text?.trim();
  if (!text) {
    res.status(400).json({ error: "Voice text is required" });
    return;
  }

  const synthesizeProvider = resolveNatalieVoiceSynthesizeProvider(config.aiVoice.provider);
  if (!synthesizeProvider) {
    res.status(503).json({ error: "AI voice is not configured", fallback: "browser_speech" });
    return;
  }

  const result = await synthesizeSpeech(
    { text, provider: synthesizeProvider },
    buildNatalieVoiceCredentials(config.aiVoice),
    { fetchFn: fetch }
  );

  if (!result.ok) {
    res.status(result.status).json(
      result.status === 503
        ? { error: result.error, fallback: "browser_speech" }
        : { error: result.error }
    );
    return;
  }

  res.setHeader("Content-Type", result.contentType);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(result.audio);
});

apiRouter.post("/natalie/transcribe", requirePerm("chat.use"), natalieAudioUpload.single("audio"), async (req, res) => {
  const file = req.file;
  if (!file?.buffer?.length) {
    res.status(400).json({ error: "Audio file is required" });
    return;
  }

  const organizationId = req.auth!.organizationId;
  let vocabulary;
  let promptHint: string | undefined;
  try {
    vocabulary = await loadSttVocabulary(organizationId);
    promptHint = buildWhisperPromptHint(vocabulary);
  } catch (err) {
    console.warn("[natalie/transcribe] failed to build STT vocabulary", errorDetails(err));
  }

  const result = await transcribeAudio(
    file.buffer,
    file.mimetype || "application/octet-stream",
    { openAiApiKey: config.aiVoice.openAiApiKey },
    { fetchFn: fetch },
    promptHint
  );

  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  try {
    const accuracy = await processTranscriptAccuracy({
      organizationId,
      rawTranscript: result.text,
      vocabulary,
      skipClarification: true,
      requestId: readRequestId(req),
    });
    res.json({
      text: accuracy.normalizedTranscript,
      confidence: accuracy.confidence,
      confidenceLevel: accuracy.confidenceLevel,
      clarificationRequired: accuracy.clarificationRequired,
      actionBlocked: accuracy.actionBlocked,
      correctionsApplied: accuracy.corrections.length,
    });
  } catch (err) {
    console.warn("[natalie/transcribe] failed to normalize transcript", {
      organizationId,
      requestId: readRequestId(req) ?? null,
      ...errorDetails(err),
    });
    res.json({ text: result.text });
  }
});

apiRouter.get("/message-scans", async (req, res) => {
  const channel = typeof req.query.channel === "string" ? req.query.channel : undefined;
  const contactType = typeof req.query.contactType === "string" ? req.query.contactType : undefined;
  const urgency = typeof req.query.urgency === "string" ? req.query.urgency : undefined;
  const scans = await prisma.messageScan.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(channel && channel !== "all" && { channel }),
      ...(contactType && contactType !== "all" && { contactType }),
      ...(urgency && urgency !== "all" && { urgency }),
    },
    orderBy: { occurredAt: "desc" },
    take: 200,
  });
  res.json({ scans });
});

apiRouter.get("/message-scans/stats", async (req, res) => {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const scans = await prisma.messageScan.findMany({
    where: { organizationId: req.auth!.organizationId, occurredAt: { gte: since } },
    select: { channel: true, contactType: true, intent: true, urgency: true, sentiment: true },
    take: 5000,
  });
  res.json({
    total: scans.length,
    byChannel: countBy(scans, "channel"),
    byContactType: countBy(scans, "contactType"),
    byIntent: countBy(scans, "intent"),
    urgent: scans.filter((scan) => scan.urgency === "high").length,
    sentiment: countBy(scans, "sentiment"),
  });
});

apiRouter.get("/leads", async (req, res) => {
  const { listCrmLeads } = await import("../services/crm.js");
  res.json(await listCrmLeads(req.auth!.organizationId, req.query));
});

apiRouter.get("/leads/kpis", async (req, res) => {
  const { getCrmKpis } = await import("../services/crm.js");
  res.json(await getCrmKpis(req.auth!.organizationId));
});

apiRouter.get("/leads/templates", async (req, res) => {
  const { listMessageTemplates } = await import("../services/crm.js");
  res.json({ templates: await listMessageTemplates(req.auth!.organizationId) });
});

apiRouter.put("/leads/templates/:id", async (req, res) => {
  try {
    const { updateMessageTemplate } = await import("../services/crm.js");
    res.json(await updateMessageTemplate(req.auth!.organizationId, req.params.id, req.body as { content?: string }));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Template update failed" });
  }
});

apiRouter.get("/leads/:id", async (req, res) => {
  try {
    const { getCrmLead } = await import("../services/crm.js");
    res.json(await getCrmLead(req.auth!.organizationId, req.params.id));
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Lead not found" });
  }
});

apiRouter.post("/leads", async (req, res) => {
  try {
    const { createCrmLead } = await import("../services/crm.js");
    // רצף הודעות אוטומטי מופעל כברירת מחדל; ה-UI יכול לבקש במפורש לא
    // להפעיל (הפיצ'ר מוסתר מהמסך כרגע). ה-backend של הרצפים לא נמחק.
    const startSequence = (req.body as { startSequence?: unknown })?.startSequence !== false;
    res.json(await createCrmLead(req.auth!.organizationId, req.body as Record<string, unknown>, req.auth!.userId, startSequence));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Create lead failed" });
  }
});

apiRouter.put("/leads/:id", async (req, res) => {
  try {
    const { updateCrmLead } = await import("../services/crm.js");
    res.json(await updateCrmLead(req.auth!.organizationId, req.params.id, req.body as Record<string, unknown>, req.auth!.userId));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Update lead failed" });
  }
});

apiRouter.get("/leads/:id/appointments", requireCalendarView, async (req, res) => {
  try {
    const appointments = await findAppointmentsForLead({
      organizationId: req.auth!.organizationId,
      leadId: routeId(req),
    });
    res.json({
      appointments: appointments.map((appointment) => ({
        id: appointment.id,
        startTime: appointment.startTime.toISOString(),
        durationMinutes: appointment.durationMinutes,
        status: appointment.status,
        notes: appointment.notes ?? null,
        service: appointment.service ? { id: appointment.service.id, name: appointment.service.name } : null,
        employee: appointment.employee ? { id: appointment.employee.id, name: appointment.employee.name } : null,
        client: appointment.client ? { id: appointment.client.id, name: appointment.client.name } : null,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load lead appointments";
    res.status(message === "Lead not found" ? 404 : 500).json({ error: message });
  }
});

apiRouter.post("/leads/:id/timeline", async (req, res) => {
  try {
    const { addLeadTimeline } = await import("../services/crm.js");
    res.json(await addLeadTimeline(req.auth!.organizationId, req.params.id, req.body as { type?: string; content?: string; channel?: string }, req.auth!.userId));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Timeline update failed" });
  }
});

apiRouter.post("/leads/reply", async (req, res) => {
  try {
    const { handleLeadReply } = await import("../services/crm.js");
    const lead = await handleLeadReply(req.auth!.organizationId, req.body as { phone?: string; email?: string; message?: string; channel?: string });
    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    res.json({ lead });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Lead reply failed" });
  }
});

apiRouter.get("/deals", async (req, res) => {
  try {
    const { listDeals } = await import("../services/sales/dealService.js");
    res.json({ deals: await listDeals(req.auth!.organizationId, req.query as Record<string, unknown>) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "List deals failed" });
  }
});

apiRouter.get("/deals/:id", async (req, res) => {
  try {
    const { getDeal } = await import("../services/sales/dealService.js");
    res.json({ deal: await getDeal(req.auth!.organizationId, req.params.id) });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Deal not found" });
  }
});

apiRouter.post("/deals", async (req, res) => {
  try {
    const { createDeal, createDealFromLead } = await import("../services/sales/dealService.js");
    const body = req.body as { leadId?: string; clientId?: string; title?: string; assignedTo?: string };
    const deal = body.leadId
      ? await createDealFromLead(req.auth!.organizationId, body.leadId, body.assignedTo)
      : await createDeal(req.auth!.organizationId, body);
    res.json({ deal });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Create deal failed" });
  }
});

apiRouter.patch("/deals/:id", async (req, res) => {
  try {
    const { updateDealStage } = await import("../services/sales/dealService.js");
    const body = req.body as { stage?: string };
    if (!body.stage) {
      res.status(400).json({ error: "stage is required" });
      return;
    }
    res.json({ deal: await updateDealStage(req.auth!.organizationId, req.params.id, body.stage) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Update deal failed" });
  }
});

apiRouter.get("/deals/:dealId/quotes", async (req, res) => {
  try {
    const { listQuotesForDeal } = await import("../services/sales/quoteService.js");
    res.json({ quotes: await listQuotesForDeal(req.auth!.organizationId, req.params.dealId) });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "List quotes failed" });
  }
});

apiRouter.post("/deals/:dealId/quotes", async (req, res) => {
  try {
    const { createQuoteForDeal } = await import("../services/sales/quoteService.js");
    res.json({
      quote: await createQuoteForDeal(req.auth!.organizationId, req.params.dealId, req.body as import("../services/sales/quoteService.js").CreateQuoteInput),
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Create quote failed" });
  }
});

apiRouter.get("/quotes/:id", async (req, res) => {
  try {
    const { getQuote } = await import("../services/sales/quoteService.js");
    res.json({ quote: await getQuote(req.auth!.organizationId, req.params.id) });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Quote not found" });
  }
});

apiRouter.patch("/quotes/:id", async (req, res) => {
  try {
    const { updateQuote } = await import("../services/sales/quoteService.js");
    res.json({
      quote: await updateQuote(req.auth!.organizationId, req.params.id, req.body as import("../services/sales/quoteService.js").UpdateQuoteInput),
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Update quote failed" });
  }
});

apiRouter.post("/leads/scan-gmail", async (req, res) => {
  try {
    const keywords = ["מעוניין", "פרטים", "מחיר", "interested", "details", "price"];
    const leads = await prisma.emailMessage.findMany({
      where: {
        organizationId: req.auth!.organizationId,
        receivedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        OR: keywords.flatMap((keyword) => [
          { subject: { contains: keyword, mode: "insensitive" as const } },
          { bodyText: { contains: keyword, mode: "insensitive" as const } },
        ]),
      },
      take: 25,
      orderBy: { receivedAt: "desc" },
    });
    const { createCrmLead } = await import("../services/crm.js");
    const created = [];
    for (const email of leads) {
      const phone = email.fromAddress.match(/\+?\d[\d\s-]{7,}/)?.[0]?.replace(/\s/g, "");
      const exists = await prisma.lead.findFirst({
        where: {
          organizationId: req.auth!.organizationId,
          OR: [{ email: email.fromAddress }, ...(phone ? [{ phone }] : [])],
        },
      });
      if (exists) continue;
      created.push(await createCrmLead(req.auth!.organizationId, {
        name: email.fromAddress.replace(/<[^>]+>/g, "").trim() || "ליד ממייל",
        email: email.fromAddress,
        phone,
        source: "email",
        notes: `${email.subject}\n\n${email.bodyText ?? email.snippet ?? ""}`.slice(0, 1000),
      }, req.auth!.userId));
    }
    res.json({ scanned: leads.length, created: created.length, leads: created });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Gmail lead scan failed" });
  }
});

apiRouter.post("/help/ask", async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question : "";
  const { answerHelpQuestion } = await import("../services/helpAI.js");
  res.json({ answer: await answerHelpQuestion(question) });
});

apiRouter.get("/accountant/settings", async (req, res) => {
  const { getAccountantSettings } = await import("../services/accountantReports.js");
  res.json(await getAccountantSettings(req.auth!.organizationId));
});

apiRouter.put("/accountant/settings", async (req, res) => {
  const { updateAccountantSettings } = await import("../services/accountantReports.js");
  res.json(await updateAccountantSettings(req.auth!.organizationId, req.body as Record<string, unknown>));
});

apiRouter.get("/accountant/summary", async (req, res) => {
  const period = typeof req.query.period === "string" ? req.query.period : undefined;
  const { buildAccountantSummary } = await import("../services/accountantReports.js");
  res.json(await buildAccountantSummary(req.auth!.organizationId, period));
});

apiRouter.post("/accountant/generate", requirePerm("report.export"), async (req, res) => {
  const period = typeof req.body?.period === "string" ? req.body.period : undefined;
  const { generateAccountantReport } = await import("../services/accountantReports.js");
  res.json(await generateAccountantReport(req.auth!.organizationId, period));
});

apiRouter.get("/accountant/download.zip", async (req, res) => {
  const period = typeof req.query.period === "string" ? req.query.period : undefined;
  const { accountantZipBuffer, buildAccountantSummary } = await import("../services/accountantReports.js");
  const buffer = accountantZipBuffer(await buildAccountantSummary(req.auth!.organizationId, period));
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", "attachment; filename=accountant-report.zip");
  res.send(buffer);
});

apiRouter.post("/accountant/send", requirePerm("report.export"), async (req, res) => {
  const period = typeof req.body?.period === "string" ? req.body.period : undefined;
  const { generateAccountantReport } = await import("../services/accountantReports.js");
  const report = await generateAccountantReport(req.auth!.organizationId, period);
  res.json({ sent: false, reason: "Email provider is not configured yet", report });
});

type ReviewInvoiceCandidate = {
  id: string;
  clientId: string;
  invoiceNumber: string | null;
  amount: number | null;
  amountLabel: string;
  amountResolved: boolean;
  currency: string;
  currencyExplicit: boolean;
  date: Date;
  documentDateExplicit: boolean;
  dueDate: Date | null;
  status: string;
  reviewStatus: string;
  source: "invoice" | "gmail_scan_item" | "financial_document_review" | "supplier_payment";
  reviewSourceId: string | null;
  description: string | null;
  driveUrl: string | null;
  driveFileUrl: string | null;
  client: { id: string; name: string; color: string | null } | null;
  supplierName: string | null;
  fromEmail: string | null;
  gmailMessageId: string | null;
  gmailMessageLink?: string | null;
  confidenceScore?: string | number | null;
  decisionReason?: string | null;
  attachmentFilename?: string | null;
  documentType: string | null;
  parsedFieldsJson?: unknown;
  rawReviewStatus?: string;
  dataComplete: boolean;
  approvalRequired: boolean;
  isComplete: boolean;
  missingDataReasons: string[];
  approvalReasons: string[];
  completionReasons: string[];
  canApproveDirectly?: boolean;
  supplierNeedsConfirmation?: boolean;
  approvalBlockReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RawRecord = Record<string, unknown>;

export function invoiceReviewStatusFilter(status: string | undefined) {
  return status === "approved" || status === "needs_review" || status === "rejected" ? status : undefined;
}

export type LinkedFinancialDocumentReviewAmountSource = {
  totalAmount: number | null;
  amountBeforeVat?: number | null;
  vatAmount?: number | null;
  parsedFieldsJson?: unknown;
};

export function assessReviewInvoiceCandidate(candidate: ReviewInvoiceCandidate): InvoiceCompletenessAssessment {
  return assessInvoiceCompleteness({
    supplierName: candidate.supplierName,
    amount: candidate.amount,
    amountResolved: candidate.amountResolved,
    currency: candidate.currency,
    currencyExplicit: candidate.currencyExplicit,
    date: candidate.date,
    documentDateExplicit: candidate.documentDateExplicit,
    documentType: candidate.documentType,
    reviewStatus: candidate.reviewStatus,
    rawReviewStatus: candidate.rawReviewStatus ?? candidate.reviewStatus,
    confidenceScore: candidate.confidenceScore,
    decisionReason: candidate.decisionReason,
    parsedFieldsJson: candidate.parsedFieldsJson,
  });
}

export function enrichReviewInvoiceCandidateWithCompleteness(
  candidate: Omit<
    ReviewInvoiceCandidate,
    "isComplete" | "completionReasons" | "dataComplete" | "approvalRequired" | "missingDataReasons" | "approvalReasons"
  >,
): ReviewInvoiceCandidate {
  const assessment = assessInvoiceCompleteness({
    supplierName: candidate.supplierName,
    amount: candidate.amount,
    amountResolved: candidate.amountResolved,
    currency: candidate.currency,
    currencyExplicit: candidate.currencyExplicit,
    date: candidate.date,
    documentDateExplicit: candidate.documentDateExplicit,
    documentType: candidate.documentType,
    reviewStatus: candidate.reviewStatus,
    rawReviewStatus: candidate.rawReviewStatus ?? candidate.reviewStatus,
    confidenceScore: candidate.confidenceScore,
    decisionReason: candidate.decisionReason,
    parsedFieldsJson: candidate.parsedFieldsJson,
  });
  return {
    ...candidate,
    dataComplete: assessment.dataComplete,
    approvalRequired: assessment.approvalRequired,
    isComplete: assessment.isComplete,
    missingDataReasons: assessment.missingDataReasons,
    approvalReasons: assessment.approvalReasons,
    completionReasons: assessment.completionReasons,
  };
}

export function mapInvoiceCompletionContextToCandidate(
  ctx: InvoiceCompletionContext,
  organizationId: string,
): ReviewInvoiceCandidate {
  if (ctx.review) {
    return mapDocumentReviewToInvoiceCandidate(ctx.review, organizationId);
  }
  if (ctx.gsi) {
    return mapGmailScanItemToInvoiceCandidate(ctx.gsi, organizationId, null);
  }
  if (ctx.payment) {
    return mapSupplierPaymentToInvoiceCandidate(ctx.payment, organizationId);
  }
  throw new Error("Invoice completion context is empty");
}

async function enrichInvoiceCandidatesWithReadiness(
  candidates: ReviewInvoiceCandidate[],
  organizationId: string,
): Promise<ReviewInvoiceCandidate[]> {
  const targets = candidates.filter((candidate) => candidate.dataComplete && candidate.approvalRequired);
  if (targets.length === 0) return candidates;

  const fdrIds = new Set<string>();
  const gsiIds = new Set<string>();
  const paymentIds = new Set<string>();

  for (const candidate of targets) {
    if (candidate.source === "financial_document_review" && candidate.reviewSourceId) {
      fdrIds.add(candidate.reviewSourceId);
    } else if (candidate.source === "gmail_scan_item" && candidate.reviewSourceId) {
      gsiIds.add(candidate.reviewSourceId);
    } else if (candidate.source === "supplier_payment" && candidate.reviewSourceId) {
      if (candidate.id.startsWith("supplier-payment:")) {
        paymentIds.add(candidate.reviewSourceId);
      } else {
        fdrIds.add(candidate.reviewSourceId);
      }
    }
  }

  const [reviews, gsiItems, paymentReviews] = await Promise.all([
    fdrIds.size > 0
      ? prisma.financialDocumentReview.findMany({ where: { organizationId, id: { in: [...fdrIds] } } })
      : Promise.resolve([]),
    gsiIds.size > 0
      ? prisma.gmailScanItem.findMany({ where: { organizationId, id: { in: [...gsiIds] } } })
      : Promise.resolve([]),
    paymentIds.size > 0
      ? prisma.financialDocumentReview.findMany({
          where: { organizationId, supplierPaymentId: { in: [...paymentIds] } },
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const readinessByFdrId = new Map<string, Awaited<ReturnType<typeof evaluateReviewApprovalReadiness>>>();
  await Promise.all(
    [...reviews, ...paymentReviews].map(async (review) => {
      if (readinessByFdrId.has(review.id)) return;
      readinessByFdrId.set(review.id, await evaluateReviewApprovalReadiness(review));
    }),
  );

  const gsiLinkedReviewByGsiId = new Map<string, (typeof reviews)[number]>();
  if (gsiItems.length > 0) {
    const orClauses: Prisma.FinancialDocumentReviewWhereInput[] = [];
    for (const gsi of gsiItems) {
      if (gsi.gmailMessageId) orClauses.push({ gmailMessageId: gsi.gmailMessageId });
      if (gsi.emailMessageId) orClauses.push({ emailMessageId: gsi.emailMessageId });
      if (gsi.duplicateKey) orClauses.push({ documentFingerprint: gsi.duplicateKey });
    }
    const linkedReviews = orClauses.length > 0
      ? await prisma.financialDocumentReview.findMany({
          where: { organizationId, OR: orClauses },
          orderBy: { updatedAt: "desc" },
        })
      : [];
    for (const gsi of gsiItems) {
      const linked = linkedReviews.find(
        (review) =>
          (gsi.gmailMessageId && review.gmailMessageId === gsi.gmailMessageId) ||
          (gsi.emailMessageId && review.emailMessageId === gsi.emailMessageId) ||
          (gsi.duplicateKey && review.documentFingerprint === gsi.duplicateKey),
      );
      if (linked) gsiLinkedReviewByGsiId.set(gsi.id, linked);
    }
    await Promise.all(
      [...gsiLinkedReviewByGsiId.values()].map(async (review) => {
        if (readinessByFdrId.has(review.id)) return;
        readinessByFdrId.set(review.id, await evaluateReviewApprovalReadiness(review));
      }),
    );
  }

  const readinessByPaymentId = new Map<string, Awaited<ReturnType<typeof evaluateReviewApprovalReadiness>>>();
  for (const review of paymentReviews) {
    if (!review.supplierPaymentId || readinessByPaymentId.has(review.supplierPaymentId)) continue;
    readinessByPaymentId.set(review.supplierPaymentId, readinessByFdrId.get(review.id)!);
  }

  return candidates.map((candidate) => {
    if (!candidate.dataComplete || !candidate.approvalRequired) return candidate;

    let readiness: Awaited<ReturnType<typeof evaluateReviewApprovalReadiness>> | undefined;
    if (candidate.source === "financial_document_review" && candidate.reviewSourceId) {
      readiness = readinessByFdrId.get(candidate.reviewSourceId);
    } else if (candidate.source === "gmail_scan_item" && candidate.reviewSourceId) {
      const linked = gsiLinkedReviewByGsiId.get(candidate.reviewSourceId);
      readiness = linked ? readinessByFdrId.get(linked.id) : { canApprove: true, blockReason: null, supplierNeedsConfirmation: false, recommendedAction: "approve" };
    } else if (candidate.source === "supplier_payment" && candidate.reviewSourceId) {
      readiness = candidate.id.startsWith("supplier-payment:")
        ? readinessByPaymentId.get(candidate.reviewSourceId)
        : readinessByFdrId.get(candidate.reviewSourceId);
    }

    if (!readiness) return candidate;
    return {
      ...candidate,
      canApproveDirectly: readiness.canApprove,
      supplierNeedsConfirmation: readiness.supplierNeedsConfirmation,
      approvalBlockReason: readiness.blockReason,
    };
  });
}

export function mapGmailScanItemToInvoiceCandidate(item: {
  id: string;
  gmailMessageId: string;
  emailMessageId: string | null;
  gmailMessageLink: string;
  sender: string;
  senderEmail: string | null;
  subject: string;
  occurredAt: Date;
  amount: number | null;
  supplierName: string;
  attachmentFilename: string | null;
  driveFileLink: string | null;
  confidenceScore: string;
  reviewStatus: string;
  decisionReason: string;
  documentType: string | null;
  rawAnalysis: unknown;
  createdAt: Date;
  updatedAt: Date;
}, organizationId?: string, linkedReview?: LinkedFinancialDocumentReviewAmountSource | null): ReviewInvoiceCandidate {
  const raw = asRecord(item.rawAnalysis);
  const analysis = asRecord(raw?.analysis);
  const gsiParsedFieldsJson = asRecord(raw?.parsed_fields_json) ?? asRecord(raw?.parsedFieldsJson);
  const parsedFieldsJson = linkedReview?.parsedFieldsJson ?? gsiParsedFieldsJson;
  const invoiceNumber = stringValue(raw?.invoiceNumber) ?? stringValue(analysis?.invoiceNumber);
  const explicitDate = dateValue(raw?.invoiceDate) ?? dateValue(analysis?.invoiceDate);
  const date = explicitDate ?? item.occurredAt;
  const dueDate = dateValue(raw?.dueDate) ?? dateValue(analysis?.dueDate);
  const explicitCurrency = stringValue(analysis?.currency);
  const currency = explicitCurrency ?? "ILS";
  const display = resolveInvoiceListDisplayAmount({
    totalAmount: pickInvoiceListPersistedTotalAmount({
      financialDocumentReviewTotalAmount: linkedReview?.totalAmount,
      gmailScanItemAmount: item.amount,
    }),
    amountBeforeVat: linkedReview?.amountBeforeVat,
    vatAmount: linkedReview?.vatAmount,
    parsedFieldsJson,
    currency,
  });

  return enrichReviewInvoiceCandidateWithCompleteness({
    id: `gmail-scan:${item.id}`,
    clientId: "",
    invoiceNumber,
    amount: display.amount,
    amountLabel: display.amountLabel,
    amountResolved: display.resolved,
    currency,
    currencyExplicit: explicitCurrency != null,
    date,
    documentDateExplicit: explicitDate != null,
    dueDate,
    // שלב 6: auto_saved מוצג כ"מאושר" — שכבת הצגה בלבד, הערך ב-DB לא משתנה.
    status: presentedReviewStatus(item.reviewStatus),
    reviewStatus: presentedReviewStatus(item.reviewStatus),
    rawReviewStatus: item.reviewStatus,
    source: "gmail_scan_item",
    reviewSourceId: item.id,
    description: [item.subject, item.attachmentFilename].filter(Boolean).join(" · ") || null,
    driveUrl: signLocalUploadUrlIfNeeded(resolveDriveLink(item), organizationId ?? null),
    driveFileUrl: signLocalUploadUrlIfNeeded(resolveDriveLink(item), organizationId ?? null),
    client: null,
    supplierName: item.supplierName,
    fromEmail: item.senderEmail ?? item.sender,
    gmailMessageId: item.gmailMessageId,
    gmailMessageLink: item.gmailMessageLink,
    confidenceScore: item.confidenceScore,
    decisionReason: item.decisionReason,
    attachmentFilename: item.attachmentFilename,
    documentType: item.documentType,
    parsedFieldsJson,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
}

export function mapDocumentReviewToInvoiceCandidate(item: {
  id: string;
  sender: string | null;
  subject: string | null;
  fileName: string | null;
  invoiceNumber: string | null;
  documentDate: Date | null;
  dueDate: Date | null;
  totalAmount: number | null;
  amountBeforeVat?: number | null;
  vatAmount?: number | null;
  currency: string;
  driveFileUrl: string | null;
  supplierName: string | null;
  supplierTaxId?: string | null;
  confidenceScore: number;
  reviewStatus: string;
  uncertaintyReason: string | null;
  emailMessageId: string | null;
  gmailMessageId: string | null;
  documentType: string | null;
  parsedFieldsJson?: unknown;
  rawAnalysis?: unknown;
  supplierPaymentId?: string | null;
  normalizedDocumentDate?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}, organizationId?: string): ReviewInvoiceCandidate {
  const display = resolveInvoiceListDisplayAmount({
    totalAmount: pickInvoiceListPersistedTotalAmount({
      financialDocumentReviewTotalAmount: item.totalAmount,
    }),
    amountBeforeVat: item.amountBeforeVat,
    vatAmount: item.vatAmount,
    parsedFieldsJson: item.parsedFieldsJson,
    currency: item.currency,
  });
  const supplier = resolveReviewSupplierContext({
    supplierName: item.supplierName,
    sender: item.sender,
    supplierTaxId: item.supplierTaxId,
    parsedFieldsJson: item.parsedFieldsJson,
    rawAnalysis: item.rawAnalysis,
  });
  const explicitDate = item.normalizedDocumentDate ?? item.documentDate;

  return enrichReviewInvoiceCandidateWithCompleteness({
    id: item.supplierPaymentId ? `supplier-payment:${item.supplierPaymentId}` : `document-review:${item.id}`,
    clientId: "",
    invoiceNumber: item.invoiceNumber,
    amount: display.amount,
    amountLabel: display.amountLabel,
    amountResolved: display.resolved,
    currency: item.currency,
    currencyExplicit: Boolean(item.currency?.trim()),
    date: explicitDate ?? item.createdAt,
    documentDateExplicit: explicitDate != null,
    dueDate: item.dueDate,
    status: presentedReviewStatus(item.reviewStatus),
    reviewStatus: presentedReviewStatus(item.reviewStatus),
    rawReviewStatus: item.reviewStatus,
    source: item.supplierPaymentId ? "supplier_payment" : "financial_document_review",
    reviewSourceId: item.id,
    description: [item.subject, item.fileName].filter(Boolean).join(" · ") || null,
    driveUrl: signLocalUploadUrlIfNeeded(resolveDriveLink(item), organizationId ?? null),
    driveFileUrl: signLocalUploadUrlIfNeeded(resolveDriveLink(item), organizationId ?? null),
    client: null,
    supplierName: supplier.displaySupplierName ?? item.supplierName,
    fromEmail: item.sender,
    gmailMessageId: item.gmailMessageId,
    confidenceScore: item.confidenceScore,
    decisionReason: item.uncertaintyReason,
    attachmentFilename: item.fileName,
    documentType: item.documentType,
    parsedFieldsJson: item.parsedFieldsJson,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
}

export function mapSupplierPaymentToInvoiceCandidate(item: {
  id: string;
  supplier: string;
  supplierName: string | null;
  amount: number;
  totalAmount: number | null;
  currency: string;
  date: Date;
  normalizedDocumentDate: Date | null;
  dueDate: Date | null;
  invoiceNumber: string | null;
  documentTypeDetailed: string | null;
  documentLink: string | null;
  invoiceLink: string | null;
  driveFileUrl: string | null;
  emailSender: string | null;
  emailMessageId: string | null;
  subject: string | null;
  confidenceScore: number | null;
  parsedFieldsJson: unknown;
  approvalStatus?: string;
  createdAt: Date;
  updatedAt: Date;
}, organizationId?: string): ReviewInvoiceCandidate {
  const display = resolveInvoiceListDisplayAmount({
    totalAmount: pickInvoiceListPersistedTotalAmount({
      supplierPaymentAmount: item.totalAmount ?? item.amount,
    }),
    parsedFieldsJson: item.parsedFieldsJson,
    currency: item.currency,
  });
  const docDate = item.normalizedDocumentDate ?? item.date ?? item.createdAt;
  const rawStatus = item.approvalStatus ?? "approved";

  return enrichReviewInvoiceCandidateWithCompleteness({
    id: `supplier-payment:${item.id}`,
    clientId: "",
    invoiceNumber: item.invoiceNumber,
    amount: display.amount,
    amountLabel: display.amountLabel,
    amountResolved: display.resolved,
    currency: item.currency,
    currencyExplicit: Boolean(item.currency?.trim()),
    date: docDate,
    documentDateExplicit: Boolean(item.normalizedDocumentDate ?? item.date),
    dueDate: item.dueDate,
    status: presentedReviewStatus(rawStatus),
    reviewStatus: presentedReviewStatus(rawStatus),
    rawReviewStatus: rawStatus,
    source: "supplier_payment",
    reviewSourceId: item.id,
    description: item.subject,
    driveUrl: signLocalUploadUrlIfNeeded(resolveDriveLink(item), organizationId ?? null),
    driveFileUrl: signLocalUploadUrlIfNeeded(resolveDriveLink(item), organizationId ?? null),
    client: null,
    supplierName: item.supplierName ?? item.supplier,
    fromEmail: item.emailSender,
    gmailMessageId: null,
    confidenceScore: item.confidenceScore,
    decisionReason: null,
    attachmentFilename: null,
    documentType: item.documentTypeDetailed,
    parsedFieldsJson: item.parsedFieldsJson,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
}

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const DEFAULT_ORGANIZATION_TIMEZONE = "Asia/Jerusalem";
const INVOICE_MONTH_PARAM_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type InvoiceReviewCandidateStatus = "needs_review" | "rejected" | "approved";

/** Document types that belong on the חשבוניות screen after manual approval. */
export const INVOICE_LIKE_SUPPLIER_PAYMENT_TYPES = ["tax_invoice", "receipt", "tax_invoice_receipt"] as const;

export type InvoiceListQueryContext = {
  organizationId: string;
  clientId?: string;
  search: string;
  paymentStatus?: string;
  includeApprovedInvoices: boolean;
  includeReviewCandidates: boolean;
  reviewCandidateStatuses?: string[];
};

export function buildReviewCandidateStatuses(
  reviewStatus: InvoiceReviewCandidateStatus | undefined
): string[] | undefined {
  // שלב 6: מקור האמת הוא reviewStatusPolicy — טאב "מאושר" כולל auto_saved,
  // כדי שרשומות שאושרו אוטומטית לא ייעלמו מכל הטאבים (הבאג המקורי).
  return reviewCandidateStatusesForTab(reviewStatus);
}

export type InvoiceListMonthBounds = { gte: Date; lt: Date };

export type InvoiceListWhereInput = {
  invoiceWhere: Prisma.InvoiceWhereInput;
  gmailScanItemWhere: Prisma.GmailScanItemWhereInput;
  financialDocumentReviewWhere: Prisma.FinancialDocumentReviewWhereInput;
  supplierPaymentWhere: Prisma.SupplierPaymentWhereInput;
  includeApprovedInvoices: boolean;
  includeReviewCandidates: boolean;
  includeApprovedSupplierPayments: boolean;
};

export type InvoiceMonthAggregationRow = {
  year: number;
  month: number;
  currency: string;
  count: number;
  total: number;
};

export type InvoiceMonthSummary = {
  year: number;
  month: number;
  count: number;
  totalsByCurrency: Record<string, number>;
};

export function buildInvoiceListQueryContext(input: {
  organizationId: string;
  status?: string;
  clientId?: string;
  search?: string;
}): InvoiceListQueryContext {
  const reviewStatus = invoiceReviewStatusFilter(input.status);
  const paymentStatus = input.status && input.status !== "all" && !reviewStatus ? input.status : undefined;
  const reviewCandidateStatuses = buildReviewCandidateStatuses(reviewStatus);
  return {
    organizationId: input.organizationId,
    clientId: input.clientId,
    search: input.search?.trim() ?? "",
    paymentStatus,
    includeApprovedInvoices: !reviewStatus || reviewStatus === "approved",
    includeReviewCandidates:
      !paymentStatus && !input.clientId && reviewCandidateStatuses !== undefined,
    reviewCandidateStatuses,
  };
}

export function parseInvoiceMonthParam(month: string | undefined) {
  if (!month) return null;
  const match = INVOICE_MONTH_PARAM_PATTERN.exec(month);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function formatInvoiceMonthStartDate(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function nextInvoiceMonth(year: number, month: number) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export async function resolveInvoiceMonthBounds(
  organizationId: string,
  year: number,
  month: number,
  timezone = DEFAULT_ORGANIZATION_TIMEZONE
): Promise<InvoiceListMonthBounds> {
  const startDate = formatInvoiceMonthStartDate(year, month);
  const end = nextInvoiceMonth(year, month);
  const endDate = formatInvoiceMonthStartDate(end.year, end.month);
  const [row] = await prisma.$queryRawUnsafe<Array<{ gte: Date; lt: Date }>>(
    `SELECT
      ($1::date::timestamp AT TIME ZONE $3) AS gte,
      ($2::date::timestamp AT TIME ZONE $3) AS lt`,
    startDate,
    endDate,
    timezone
  );
  if (!row) throw new Error("Failed to resolve invoice month bounds");
  return row;
}

function normalizedDocumentDateRangeFilter(monthBounds?: InvoiceListMonthBounds): Prisma.DateTimeFilter | undefined {
  if (!monthBounds) return undefined;
  return { gte: monthBounds.gte, lt: monthBounds.lt };
}

export function buildInvoiceListWhereInput(
  ctx: InvoiceListQueryContext,
  monthBounds?: InvoiceListMonthBounds
): InvoiceListWhereInput {
  const normalizedDocumentDate = normalizedDocumentDateRangeFilter(monthBounds);
  const invoiceWhere: Prisma.InvoiceWhereInput = {
    organizationId: ctx.organizationId,
    ...(normalizedDocumentDate && { normalizedDocumentDate }),
    ...(ctx.clientId && { clientId: ctx.clientId }),
    ...(ctx.paymentStatus && { status: ctx.paymentStatus }),
    ...(ctx.search && {
      OR: [
        { invoiceNumber: { contains: ctx.search, mode: "insensitive" } },
        { description: { contains: ctx.search, mode: "insensitive" } },
        { supplierName: { contains: ctx.search, mode: "insensitive" } },
        { fromEmail: { contains: ctx.search, mode: "insensitive" } },
        { client: { name: { contains: ctx.search, mode: "insensitive" } } },
      ],
    }),
  };
  const gmailScanItemWhere: Prisma.GmailScanItemWhereInput = {
    organizationId: ctx.organizationId,
    ...(normalizedDocumentDate && { normalizedDocumentDate }),
    documentType: { in: ["invoice", "receipt", "unknown_needs_review"] },
    ...(ctx.reviewCandidateStatuses?.length
      ? { reviewStatus: { in: ctx.reviewCandidateStatuses } }
      : {}),
    ...(ctx.search && {
      OR: [
        { subject: { contains: ctx.search, mode: "insensitive" } },
        { supplierName: { contains: ctx.search, mode: "insensitive" } },
        { sender: { contains: ctx.search, mode: "insensitive" } },
        { senderEmail: { contains: ctx.search, mode: "insensitive" } },
        { attachmentFilename: { contains: ctx.search, mode: "insensitive" } },
        { decisionReason: { contains: ctx.search, mode: "insensitive" } },
      ],
    }),
  };
  const financialDocumentReviewWhere: Prisma.FinancialDocumentReviewWhereInput = {
    organizationId: ctx.organizationId,
    ...(normalizedDocumentDate && { normalizedDocumentDate }),
    documentType: { in: ["tax_invoice", "receipt", "tax_invoice_receipt"] },
    ...(ctx.reviewCandidateStatuses?.length
      ? { reviewStatus: { in: ctx.reviewCandidateStatuses } }
      : {}),
    ...(ctx.search && {
      OR: [
        { subject: { contains: ctx.search, mode: "insensitive" } },
        { supplierName: { contains: ctx.search, mode: "insensitive" } },
        { sender: { contains: ctx.search, mode: "insensitive" } },
        { fileName: { contains: ctx.search, mode: "insensitive" } },
        { invoiceNumber: { contains: ctx.search, mode: "insensitive" } },
        { uncertaintyReason: { contains: ctx.search, mode: "insensitive" } },
      ],
    }),
  };
  const supplierPaymentWhere: Prisma.SupplierPaymentWhereInput = {
    organizationId: ctx.organizationId,
    approvalStatus: "approved",
    documentTypeDetailed: { in: [...INVOICE_LIKE_SUPPLIER_PAYMENT_TYPES] },
    ...(normalizedDocumentDate && { normalizedDocumentDate }),
    ...(ctx.search && {
      OR: [
        { subject: { contains: ctx.search, mode: "insensitive" } },
        { supplierName: { contains: ctx.search, mode: "insensitive" } },
        { supplier: { contains: ctx.search, mode: "insensitive" } },
        { emailSender: { contains: ctx.search, mode: "insensitive" } },
        { invoiceNumber: { contains: ctx.search, mode: "insensitive" } },
      ],
    }),
  };
  return {
    invoiceWhere,
    gmailScanItemWhere,
    financialDocumentReviewWhere,
    supplierPaymentWhere,
    includeApprovedInvoices: ctx.includeApprovedInvoices,
    includeReviewCandidates: ctx.includeReviewCandidates,
    includeApprovedSupplierPayments: includeApprovedSupplierPayments(ctx),
  };
}

function pushSqlParam(params: unknown[], value: unknown) {
  params.push(value);
  return `$${params.length}`;
}

function appendInvoiceSqlFilters(alias: string, ctx: InvoiceListQueryContext, params: unknown[]) {
  const clauses: string[] = [];
  if (ctx.clientId) clauses.push(`${alias}."clientId" = ${pushSqlParam(params, ctx.clientId)}`);
  if (ctx.paymentStatus) clauses.push(`${alias}."status" = ${pushSqlParam(params, ctx.paymentStatus)}`);
  if (ctx.search) {
    const searchParam = pushSqlParam(params, `%${ctx.search}%`);
    clauses.push(`(
      ${alias}."invoiceNumber" ILIKE ${searchParam}
      OR ${alias}."description" ILIKE ${searchParam}
      OR ${alias}."supplierName" ILIKE ${searchParam}
      OR ${alias}."fromEmail" ILIKE ${searchParam}
      OR EXISTS (
        SELECT 1 FROM "Client" c
        WHERE c."id" = ${alias}."clientId"
          AND c."name" ILIKE ${searchParam}
      )
    )`);
  }
  return clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
}

function appendGmailScanItemSqlFilters(alias: string, ctx: InvoiceListQueryContext, params: unknown[]) {
  let sql = ` AND ${alias}."documentType" IN ('invoice', 'receipt', 'unknown_needs_review')`;
  if (ctx.reviewCandidateStatuses?.length) {
    const statusParams = ctx.reviewCandidateStatuses.map((status) => pushSqlParam(params, status));
    sql += ` AND ${alias}."reviewStatus" IN (${statusParams.join(", ")})`;
  }
  if (ctx.search) {
    const searchParam = pushSqlParam(params, `%${ctx.search}%`);
    sql += ` AND (
      ${alias}."subject" ILIKE ${searchParam}
      OR ${alias}."supplierName" ILIKE ${searchParam}
      OR ${alias}."sender" ILIKE ${searchParam}
      OR ${alias}."senderEmail" ILIKE ${searchParam}
      OR ${alias}."attachmentFilename" ILIKE ${searchParam}
      OR ${alias}."decisionReason" ILIKE ${searchParam}
    )`;
  }
  return sql;
}

function appendFinancialDocumentReviewSqlFilters(alias: string, ctx: InvoiceListQueryContext, params: unknown[]) {
  let sql = ` AND ${alias}."documentType" IN ('tax_invoice', 'receipt', 'tax_invoice_receipt')`;
  if (ctx.reviewCandidateStatuses?.length) {
    const statusParams = ctx.reviewCandidateStatuses.map((status) => pushSqlParam(params, status));
    sql += ` AND ${alias}."reviewStatus" IN (${statusParams.join(", ")})`;
  }
  if (ctx.search) {
    const searchParam = pushSqlParam(params, `%${ctx.search}%`);
    sql += ` AND (
      ${alias}."subject" ILIKE ${searchParam}
      OR ${alias}."supplierName" ILIKE ${searchParam}
      OR ${alias}."sender" ILIKE ${searchParam}
      OR ${alias}."fileName" ILIKE ${searchParam}
      OR ${alias}."invoiceNumber" ILIKE ${searchParam}
      OR ${alias}."uncertaintyReason" ILIKE ${searchParam}
    )`;
  }
  return sql;
}

function appendSupplierPaymentSqlFilters(alias: string, ctx: InvoiceListQueryContext, params: unknown[]) {
  let sql = ` AND ${alias}."approvalStatus" = 'approved'`;
  sql += ` AND ${alias}."documentTypeDetailed" IN ('tax_invoice', 'receipt', 'tax_invoice_receipt')`;
  if (ctx.search) {
    const searchParam = pushSqlParam(params, `%${ctx.search}%`);
    sql += ` AND (
      ${alias}."subject" ILIKE ${searchParam}
      OR ${alias}."supplierName" ILIKE ${searchParam}
      OR ${alias}."supplier" ILIKE ${searchParam}
      OR ${alias}."emailSender" ILIKE ${searchParam}
      OR ${alias}."invoiceNumber" ILIKE ${searchParam}
    )`;
  }
  return sql;
}

export function includeApprovedSupplierPayments(ctx: InvoiceListQueryContext): boolean {
  return (
    !ctx.paymentStatus &&
    !ctx.clientId &&
    (!ctx.reviewCandidateStatuses?.length || ctx.reviewCandidateStatuses.includes("approved"))
  );
}

function supplierPaymentInvoiceDedupExistsSql(
  paymentAlias: string,
  invoiceAlias: string,
  ctx: InvoiceListQueryContext,
  params: unknown[]
) {
  return `EXISTS (
    SELECT 1 FROM "Invoice" ${invoiceAlias}
    WHERE ${invoiceAlias}."organizationId" = ${paymentAlias}."organizationId"
      AND ${paymentAlias}."emailMessageId" IS NOT NULL
      AND ${invoiceAlias}."emailId" = ${paymentAlias}."emailMessageId"
      ${appendInvoiceSqlFilters(invoiceAlias, ctx, params)}
  )`;
}

function invoiceDedupExistsSql(sourceAlias: string, invoiceAlias: string, ctx: InvoiceListQueryContext, params: unknown[]) {
  return `EXISTS (
    SELECT 1 FROM "Invoice" ${invoiceAlias}
    WHERE ${invoiceAlias}."organizationId" = ${sourceAlias}."organizationId"
      AND (
        (${sourceAlias}."gmailMessageId" IS NOT NULL AND ${invoiceAlias}."gmailMessageId" = ${sourceAlias}."gmailMessageId")
        OR (${sourceAlias}."emailMessageId" IS NOT NULL AND ${invoiceAlias}."emailId" = ${sourceAlias}."emailMessageId")
      )
      ${appendInvoiceSqlFilters(invoiceAlias, ctx, params)}
  )`;
}

export function buildInvoiceMonthsAggregationSql(ctx: InvoiceListQueryContext, timezone: string) {
  const params: unknown[] = [];
  const orgParam = pushSqlParam(params, ctx.organizationId);
  const tzParam = pushSqlParam(params, timezone);
  const parts: string[] = [];

  if (ctx.includeApprovedInvoices) {
    parts.push(`SELECT
      i."normalizedDocumentDate" AS doc_date,
      i."amount"::double precision AS amount,
      COALESCE(NULLIF(TRIM(i."currency"), ''), 'ILS') AS currency
    FROM "Invoice" i
    WHERE i."organizationId" = ${orgParam}
      AND i."normalizedDocumentDate" IS NOT NULL
      ${appendInvoiceSqlFilters("i", ctx, params)}`);
  }

  if (ctx.includeReviewCandidates) {
    parts.push(`SELECT
      gsi."normalizedDocumentDate" AS doc_date,
      CASE
        WHEN gsi."amount" IS NOT NULL AND gsi."amount" > 0 THEN gsi."amount"::double precision
        WHEN NULLIF(gsi."rawAnalysis"->'analysis'->>'totalAmount', '') IS NOT NULL
          AND NULLIF(gsi."rawAnalysis"->'analysis'->>'totalAmount', '')::double precision > 0
          THEN NULLIF(gsi."rawAnalysis"->'analysis'->>'totalAmount', '')::double precision
        ELSE NULL
      END AS amount,
      COALESCE(NULLIF(TRIM(gsi."rawAnalysis"->'analysis'->>'currency'), ''), 'ILS') AS currency
    FROM "GmailScanItem" gsi
    WHERE gsi."organizationId" = ${orgParam}
      AND gsi."normalizedDocumentDate" IS NOT NULL
      ${appendGmailScanItemSqlFilters("gsi", ctx, params)}
      AND NOT ${invoiceDedupExistsSql("gsi", "i", ctx, params)}`);

    parts.push(`SELECT
      fdr."normalizedDocumentDate" AS doc_date,
      CASE
        WHEN fdr."totalAmount" IS NOT NULL AND fdr."totalAmount" > 0 THEN fdr."totalAmount"::double precision
        ELSE NULL
      END AS amount,
      COALESCE(NULLIF(TRIM(fdr."currency"), ''), 'ILS') AS currency
    FROM "FinancialDocumentReview" fdr
    WHERE fdr."organizationId" = ${orgParam}
      AND fdr."normalizedDocumentDate" IS NOT NULL
      ${appendFinancialDocumentReviewSqlFilters("fdr", ctx, params)}
      AND NOT ${invoiceDedupExistsSql("fdr", "i", ctx, params)}
      AND NOT EXISTS (
        SELECT 1 FROM "GmailScanItem" gsi
        WHERE gsi."organizationId" = fdr."organizationId"
          ${appendGmailScanItemSqlFilters("gsi", ctx, params)}
          AND (
            (fdr."gmailMessageId" IS NOT NULL AND gsi."gmailMessageId" = fdr."gmailMessageId")
            OR (fdr."emailMessageId" IS NOT NULL AND gsi."emailMessageId" = fdr."emailMessageId")
          )
          AND NOT ${invoiceDedupExistsSql("gsi", "i2", ctx, params)}
      )`);
  }

  if (includeApprovedSupplierPayments(ctx)) {
    parts.push(`SELECT
      sp."normalizedDocumentDate" AS doc_date,
      CASE
        WHEN sp."totalAmount" IS NOT NULL AND sp."totalAmount" > 0 THEN sp."totalAmount"::double precision
        WHEN sp."amount" IS NOT NULL AND sp."amount" > 0 THEN sp."amount"::double precision
        ELSE NULL
      END AS amount,
      COALESCE(NULLIF(TRIM(sp."currency"), ''), 'ILS') AS currency
    FROM "SupplierPayment" sp
    WHERE sp."organizationId" = ${orgParam}
      AND sp."normalizedDocumentDate" IS NOT NULL
      ${appendSupplierPaymentSqlFilters("sp", ctx, params)}
      AND NOT ${supplierPaymentInvoiceDedupExistsSql("sp", "i", ctx, params)}`);
  }

  const sql = `WITH deduped AS (
    ${parts.join("\n    UNION ALL\n    ")}
  )
  SELECT
    EXTRACT(YEAR FROM doc_date AT TIME ZONE ${tzParam})::int AS year,
    EXTRACT(MONTH FROM doc_date AT TIME ZONE ${tzParam})::int AS month,
    currency,
    COUNT(*)::int AS count,
    COALESCE(SUM(amount), 0)::double precision AS total
  FROM deduped
  GROUP BY 1, 2, currency
  ORDER BY year DESC, month DESC, currency`;

  return { sql, params };
}

export function summarizeInvoiceMonthRows(rows: InvoiceMonthAggregationRow[]): InvoiceMonthSummary[] {
  const byMonth = new Map<string, InvoiceMonthSummary>();
  for (const row of rows) {
    const key = `${row.year}-${row.month}`;
    let summary = byMonth.get(key);
    if (!summary) {
      summary = { year: row.year, month: row.month, count: 0, totalsByCurrency: {} };
      byMonth.set(key, summary);
    }
    summary.count += row.count;
    summary.totalsByCurrency[row.currency] = (summary.totalsByCurrency[row.currency] ?? 0) + row.total;
  }
  return [...byMonth.values()].sort((a, b) => b.year - a.year || b.month - a.month);
}

export function buildPaymentMonthsAggregationSql(organizationId: string, timezone: string) {
  const params: unknown[] = [];
  const orgParam = pushSqlParam(params, organizationId);
  const tzParam = pushSqlParam(params, timezone);
  const sql = `
  SELECT
    EXTRACT(YEAR FROM sp."normalizedDocumentDate" AT TIME ZONE ${tzParam})::int AS year,
    EXTRACT(MONTH FROM sp."normalizedDocumentDate" AT TIME ZONE ${tzParam})::int AS month,
    COALESCE(NULLIF(TRIM(sp."currency"), ''), 'ILS') AS currency,
    COUNT(*)::int AS count,
    COALESCE(SUM(sp."amount"), 0)::double precision AS total
  FROM "SupplierPayment" sp
  WHERE sp."organizationId" = ${orgParam}
    AND sp."approvalStatus" = 'approved'
    AND sp."normalizedDocumentDate" IS NOT NULL
  GROUP BY 1, 2, currency
  ORDER BY year DESC, month DESC, currency`;
  return { sql, params };
}

export function sumPaymentMonthCounts(months: InvoiceMonthSummary[]) {
  return months.reduce((sum, month) => sum + month.count, 0);
}

type InvoiceRowForMerge = {
  id: string;
  clientId: string;
  invoiceNumber: string | null;
  amount: number;
  currency: string;
  date: Date;
  normalizedDocumentDate?: Date | null;
  dueDate: Date | null;
  status: string;
  description: string | null;
  supplierName: string | null;
  fromEmail: string | null;
  gmailMessageId: string | null;
  emailId: string | null;
  driveFileUrl?: string | null;
  driveUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
  client?: { id: string; name: string; color: string | null } | null;
};

export function mergeInvoiceListCandidates<
  TInvoice extends InvoiceRowForMerge,
  TGmailScanItem extends Parameters<typeof mapGmailScanItemToInvoiceCandidate>[0],
  TDocumentReview extends Parameters<typeof mapDocumentReviewToInvoiceCandidate>[0],
  TSupplierPayment extends Parameters<typeof mapSupplierPaymentToInvoiceCandidate>[0],
>(input: {
  invoiceRows: TInvoice[];
  gmailScanItems: TGmailScanItem[];
  documentReviews: TDocumentReview[];
  supplierPayments?: TSupplierPayment[];
  paymentDriveFallbackByInvoiceKey?: Map<string, { link: string | null; ambiguous: boolean }>;
  organizationId?: string;
}) {
  const invoicePaymentDriveFallbackKey = (gmailMessageId: string | null | undefined, amount: number | null | undefined) => {
    const normalizedAmount = Number(amount);
    return gmailMessageId && Number.isFinite(normalizedAmount) ? `${gmailMessageId}:${normalizedAmount.toFixed(2)}` : null;
  };
  const existingInvoiceRefs = new Set(
    input.invoiceRows.flatMap((invoice) => [invoice.gmailMessageId, invoice.emailId].filter((value): value is string => Boolean(value)))
  );
  const usedReviewRefs = new Set<string>();
  const usedPaymentIds = new Set<string>();
  const paymentDriveFallbackByInvoiceKey = input.paymentDriveFallbackByInvoiceKey ?? new Map();
  const linkedReviewByGmailId = new Map<string, TDocumentReview>();
  const linkedReviewByEmailId = new Map<string, TDocumentReview>();
  for (const review of input.documentReviews) {
    if (review.gmailMessageId) linkedReviewByGmailId.set(review.gmailMessageId, review);
    if (review.emailMessageId) linkedReviewByEmailId.set(review.emailMessageId, review);
  }

  const fromSupplierPayments = (input.supplierPayments ?? [])
    .filter((payment) => {
      if (payment.emailMessageId && existingInvoiceRefs.has(payment.emailMessageId)) return false;
      return true;
    })
    .map((payment) => {
      usedPaymentIds.add(payment.id);
      if (payment.emailMessageId) usedReviewRefs.add(`email:${payment.emailMessageId}`);
      return mapSupplierPaymentToInvoiceCandidate(payment, input.organizationId);
    });

  return [
    ...input.invoiceRows.map((invoice) => {
      const invoiceDriveFileUrl = resolveDriveLink(invoice);
      const fallbackKey = invoiceDriveFileUrl ? null : invoicePaymentDriveFallbackKey(invoice.gmailMessageId, invoice.amount);
      const fallback = fallbackKey ? paymentDriveFallbackByInvoiceKey.get(fallbackKey) : undefined;
      const driveFileUrl = signLocalUploadUrlIfNeeded(
        invoiceDriveFileUrl ?? (fallback && !fallback.ambiguous ? fallback.link : null),
        input.organizationId ?? null
      );
      const display = resolveInvoiceListDisplayAmount({
        totalAmount: pickInvoiceListPersistedTotalAmount({ invoiceAmount: invoice.amount }),
        currency: invoice.currency,
      });
      const invoiceDate = invoice.normalizedDocumentDate ?? invoice.date;
      return enrichReviewInvoiceCandidateWithCompleteness({
        id: invoice.id,
        clientId: invoice.clientId,
        invoiceNumber: invoice.invoiceNumber,
        amount: display.amount ?? invoice.amount,
        amountLabel: display.amountLabel,
        amountResolved: display.resolved,
        currency: invoice.currency,
        currencyExplicit: true,
        date: invoiceDate,
        documentDateExplicit: true,
        dueDate: invoice.dueDate,
        status: invoice.status,
        reviewStatus: "approved",
        rawReviewStatus: "approved",
        source: "invoice",
        reviewSourceId: null,
        description: invoice.description,
        driveUrl: driveFileUrl,
        driveFileUrl,
        client: invoice.client ?? null,
        supplierName: invoice.supplierName ?? invoice.client?.name ?? null,
        fromEmail: invoice.fromEmail,
        gmailMessageId: invoice.gmailMessageId,
        confidenceScore: null,
        decisionReason: null,
        attachmentFilename: null,
        documentType: "invoice",
        parsedFieldsJson: null,
        createdAt: invoice.createdAt,
        updatedAt: invoice.updatedAt,
      });
    }),
    ...input.gmailScanItems
      .filter((item) => !existingInvoiceRefs.has(item.gmailMessageId) && !existingInvoiceRefs.has(item.emailMessageId ?? ""))
      .map((item) => {
        if (item.gmailMessageId) usedReviewRefs.add(`gmail:${item.gmailMessageId}`);
        if (item.emailMessageId) usedReviewRefs.add(`email:${item.emailMessageId}`);
        const linkedReview =
          (item.gmailMessageId ? linkedReviewByGmailId.get(item.gmailMessageId) : undefined) ??
          (item.emailMessageId ? linkedReviewByEmailId.get(item.emailMessageId) : undefined);
        return mapGmailScanItemToInvoiceCandidate(
          item,
          input.organizationId,
          linkedReview
            ? {
                totalAmount: linkedReview.totalAmount,
                amountBeforeVat: linkedReview.amountBeforeVat,
                vatAmount: linkedReview.vatAmount,
                parsedFieldsJson: linkedReview.parsedFieldsJson,
              }
            : null,
        );
      }),
    ...fromSupplierPayments,
    ...input.documentReviews
      .filter((item) => {
        if (item.supplierPaymentId && usedPaymentIds.has(item.supplierPaymentId)) return false;
        const refs = [item.gmailMessageId && `gmail:${item.gmailMessageId}`, item.emailMessageId && `email:${item.emailMessageId}`].filter((value): value is string => Boolean(value));
        if (refs.some((ref) => existingInvoiceRefs.has(ref.replace(/^(gmail|email):/, "")) || usedReviewRefs.has(ref))) return false;
        refs.forEach((ref) => usedReviewRefs.add(ref));
        return true;
      })
      .map((item) => mapDocumentReviewToInvoiceCandidate(item, input.organizationId)),
  ];
}

async function applyFinancialReadIsolationToInvoiceListWhere(
  whereInput: InvoiceListWhereInput,
  organizationId: string,
): Promise<InvoiceListWhereInput> {
  const contaminatedGmailIds = await loadCrossOrgContaminatedGmailIdsForReads();
  return {
    ...whereInput,
    gmailScanItemWhere: mergePrismaWhere(
      whereInput.gmailScanItemWhere,
      buildGmailScanItemReadIsolationWhere(organizationId, contaminatedGmailIds),
    ),
    financialDocumentReviewWhere: mergePrismaWhere(
      whereInput.financialDocumentReviewWhere,
      buildFinancialDocumentReviewReadIsolationWhere(organizationId, contaminatedGmailIds),
    ),
    supplierPaymentWhere: mergePrismaWhere(
      whereInput.supplierPaymentWhere,
      buildSupplierPaymentReadIsolationWhere(organizationId, contaminatedGmailIds),
    ),
  };
}

async function loadOrganizationTimezone(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  return organization?.timezone || DEFAULT_ORGANIZATION_TIMEZONE;
}

type InvoiceListSupplierPaymentRow = Parameters<typeof mapSupplierPaymentToInvoiceCandidate>[0];

async function fetchInvoiceListSourceRows(
  whereInput: InvoiceListWhereInput,
  options: { limit?: number }
): Promise<
  [
    Awaited<ReturnType<typeof prisma.invoice.findMany>>,
    Awaited<ReturnType<typeof prisma.gmailScanItem.findMany>>,
    Awaited<ReturnType<typeof prisma.financialDocumentReview.findMany>>,
    InvoiceListSupplierPaymentRow[],
  ]
> {
  const listQuery = {
    orderBy: { createdAt: "desc" as const },
    ...(options.limit ? { take: options.limit } : {}),
  };
  return Promise.all([
    whereInput.includeApprovedInvoices
      ? prisma.invoice.findMany({
          where: whereInput.invoiceWhere,
          include: { client: { select: { id: true, name: true, color: true } } },
          ...listQuery,
        })
      : Promise.resolve([]),
    whereInput.includeReviewCandidates
      ? prisma.gmailScanItem.findMany({
          where: whereInput.gmailScanItemWhere,
          ...listQuery,
        })
      : Promise.resolve([]),
    whereInput.includeReviewCandidates
      ? prisma.financialDocumentReview.findMany({
          where: whereInput.financialDocumentReviewWhere,
          ...listQuery,
        })
      : Promise.resolve([]),
    whereInput.includeApprovedSupplierPayments
      ? prisma.supplierPayment.findMany({
          where: whereInput.supplierPaymentWhere,
          ...listQuery,
        })
      : Promise.resolve([]),
  ]);
}

async function buildPaymentDriveFallbackByInvoiceKey(organizationId: string, invoiceRows: Array<{ driveFileUrl?: string | null; driveUrl?: string | null; gmailMessageId: string | null; amount: number }>) {
  const missingDriveInvoiceGmailIds = Array.from(new Set(
    invoiceRows
      .filter((invoice) => !resolveDriveLink(invoice) && invoice.gmailMessageId)
      .map((invoice) => invoice.gmailMessageId!)
  ));
  const paymentDriveFallbackByInvoiceKey = new Map<string, { link: string | null; ambiguous: boolean }>();
  const invoicePaymentDriveFallbackKey = (gmailMessageId: string | null | undefined, amount: number | null | undefined) => {
    const normalizedAmount = Number(amount);
    return gmailMessageId && Number.isFinite(normalizedAmount) ? `${gmailMessageId}:${normalizedAmount.toFixed(2)}` : null;
  };
  if (missingDriveInvoiceGmailIds.length === 0) return paymentDriveFallbackByInvoiceKey;

  const emailMessagesForDriveFallback = await prisma.emailMessage.findMany({
    where: {
      organizationId,
      gmailId: { in: missingDriveInvoiceGmailIds },
    },
    select: { id: true, gmailId: true },
  });
  const gmailIdByEmailMessageId = new Map(emailMessagesForDriveFallback.map((email) => [email.id, email.gmailId]));
  const emailMessageIds = emailMessagesForDriveFallback.map((email) => email.id);
  const supplierPaymentsWithDrive = emailMessageIds.length > 0
    ? await prisma.supplierPayment.findMany({
        where: {
          organizationId,
          emailMessageId: { in: emailMessageIds },
          OR: [
            { driveFileUrl: { not: null } },
            { invoiceLink: { not: null } },
            { documentLink: { not: null } },
          ],
        },
        select: {
          emailMessageId: true,
          amount: true,
          driveFileUrl: true,
          invoiceLink: true,
          documentLink: true,
        },
      })
    : [];
  for (const payment of supplierPaymentsWithDrive) {
    const gmailMessageId = payment.emailMessageId ? gmailIdByEmailMessageId.get(payment.emailMessageId) : null;
    const fallbackKey = invoicePaymentDriveFallbackKey(gmailMessageId, Number(payment.amount));
    const link = resolveDriveLink(payment);
    if (!fallbackKey || !link) continue;
    const existing = paymentDriveFallbackByInvoiceKey.get(fallbackKey);
    if (existing) {
      paymentDriveFallbackByInvoiceKey.set(fallbackKey, { link: null, ambiguous: true });
    } else {
      paymentDriveFallbackByInvoiceKey.set(fallbackKey, { link, ambiguous: false });
    }
  }
  return paymentDriveFallbackByInvoiceKey;
}

async function fetchEnrichedInvoiceListCandidates(
  organizationId: string,
  ctx: InvoiceListQueryContext,
  options?: { monthBounds?: InvoiceListMonthBounds; limit?: number },
): Promise<ReviewInvoiceCandidate[]> {
  const whereInput = await applyFinancialReadIsolationToInvoiceListWhere(
    buildInvoiceListWhereInput(ctx, options?.monthBounds),
    organizationId,
  );
  const [invoiceRows, gmailScanItems, documentReviews, supplierPayments] = await fetchInvoiceListSourceRows(whereInput, {
    limit: options?.monthBounds ? undefined : options?.limit ?? 100,
  });
  const paymentDriveFallbackByInvoiceKey = await buildPaymentDriveFallbackByInvoiceKey(organizationId, invoiceRows);
  return mergeInvoiceListCandidates({
    invoiceRows,
    gmailScanItems,
    documentReviews,
    supplierPayments,
    paymentDriveFallbackByInvoiceKey,
    organizationId,
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function summarizeCandidatesByMonth<T extends { date: Date; amount: number; currency: string }>(
  candidates: T[],
  getDate: (candidate: T) => Date,
  timezone = DEFAULT_ORGANIZATION_TIMEZONE
): InvoiceMonthSummary[] {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
  });
  const byMonth = new Map<string, InvoiceMonthSummary>();
  for (const candidate of candidates) {
    const parts = formatter.formatToParts(getDate(candidate));
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const key = `${year}-${month}`;
    let summary = byMonth.get(key);
    if (!summary) {
      summary = { year, month, count: 0, totalsByCurrency: {} };
      byMonth.set(key, summary);
    }
    summary.count += 1;
    if (candidate.amount != null && candidate.amount > 0) {
      summary.totalsByCurrency[candidate.currency] =
        (summary.totalsByCurrency[candidate.currency] ?? 0) + candidate.amount;
    }
  }
  return [...byMonth.values()].sort((a, b) => b.year - a.year || b.month - a.month);
}

async function getInvoicesBootstrapCachedForRequest(input: {
  userId: string;
  organizationId: string;
  collectTiming?: boolean;
}) {
  const key = invoicesBootstrapCacheKey(input.userId, input.organizationId);
  const peeked = peekInvoicesBootstrapCache(input.userId, input.organizationId);
  if (peeked?.freshness === "fresh") {
    return {
      payload: peeked.entry.payload,
      cacheSource: "hit" as const,
      cacheAgeMs: Math.max(0, Date.now() - peeked.entry.loadedAt),
      buildMs: 0,
    };
  }
  if (peeked?.freshness === "stale") {
    const generationAtStart = getInvoicesBootstrapCacheGeneration(input.userId, input.organizationId);
    if (!getInvoicesBootstrapInflight(key)) {
      void setInvoicesBootstrapInflight(
        key,
        (async () => {
          try {
            const payload = await getInvoicesBootstrap(input.organizationId);
            assertInvoicesBootstrapPayloadBounds(payload);
            setInvoicesBootstrapCache({
              userId: input.userId,
              organizationId: input.organizationId,
              payload,
              generationAtStart,
            });
          } catch {
            /* keep stale */
          }
          return null;
        })()
      );
    }
    return {
      payload: peeked.entry.payload,
      cacheSource: "stale" as const,
      cacheAgeMs: Math.max(0, Date.now() - peeked.entry.loadedAt),
      buildMs: 0,
    };
  }

  const existing = getInvoicesBootstrapInflight<{
    payload: Awaited<ReturnType<typeof getInvoicesBootstrap>>;
    cacheSource: "miss" | "inflight";
    cacheAgeMs: null;
    buildMs: number;
  }>(key);
  if (existing) {
    const shared = await existing;
    return { ...shared, cacheSource: "inflight" as const };
  }

  return setInvoicesBootstrapInflight(key, (async () => {
    const generationAtStart = getInvoicesBootstrapCacheGeneration(input.userId, input.organizationId);
    const buildT0 = performance.now();
    const payload = await getInvoicesBootstrap(input.organizationId, {
      collectTiming: input.collectTiming,
    });
    const buildMs = Math.round(performance.now() - buildT0);
    assertInvoicesBootstrapPayloadBounds(payload);
    setInvoicesBootstrapCache({
      userId: input.userId,
      organizationId: input.organizationId,
      payload,
      generationAtStart,
    });
    return { payload, cacheSource: "miss" as const, cacheAgeMs: null, buildMs };
  })());
}

async function loadCompletionQueuePage(input: {
  organizationId: string;
  status?: string;
  clientId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: CompletionListSort;
}) {
  const ctx = buildInvoiceListQueryContext({
    organizationId: input.organizationId,
    status: input.status,
    clientId: input.clientId,
    search: input.search,
  });
  // Completion queue is review candidates; approved Invoice rows are complete and filtered out.
  const whereInput = await applyFinancialReadIsolationToInvoiceListWhere(
    {
      ...buildInvoiceListWhereInput(ctx),
      includeApprovedInvoices: false,
      includeApprovedSupplierPayments: false,
      includeReviewCandidates: true,
    },
    input.organizationId,
  );

  const gsiOrderBy = [
    { occurredAt: "desc" as const },
    { id: "desc" as const },
  ];
  const fdrOrderBy = [
    { documentDate: "desc" as const },
    { createdAt: "desc" as const },
    { id: "desc" as const },
  ];

  const pageResult = await scanCompletionQueueFromSources(
    [
      {
        name: "gmail_scan_item",
        load: ({ skip, take }) =>
          whereInput.includeReviewCandidates
            ? prisma.gmailScanItem.findMany({
                where: whereInput.gmailScanItemWhere,
                orderBy: gsiOrderBy,
                skip,
                take,
              })
            : Promise.resolve([]),
        map: (row) => mapGmailScanItemToInvoiceCandidate(row),
      },
      {
        name: "financial_document_review",
        load: ({ skip, take }) =>
          whereInput.includeReviewCandidates
            ? prisma.financialDocumentReview.findMany({
                where: whereInput.financialDocumentReviewWhere,
                orderBy: fdrOrderBy,
                skip,
                take,
              })
            : Promise.resolve([]),
        map: (row) => mapDocumentReviewToInvoiceCandidate(row, input.organizationId),
      },
    ],
    {
      page: input.page,
      pageSize: input.pageSize,
      sort: input.sort,
      status: input.status,
      search: input.search,
      chunk: COMPLETION_SCAN_CHUNK,
      maxSourceRows: COMPLETION_SCAN_MAX_SOURCE_ROWS,
    },
  );

  return pageResult;
}

async function loadCompletionQueueMatchedForBootstrap(input: {
  organizationId: string;
}) {
  return loadCompletionQueuePage({
    organizationId: input.organizationId,
    page: 1,
    pageSize: COMPLETION_SCAN_MAX_SOURCE_ROWS,
    sort: "date_desc",
  });
}

async function getCompletionBootstrapCachedForRequest(input: {
  userId: string;
  organizationId: string;
}) {
  const key = completionBootstrapCacheKey(input.userId, input.organizationId);
  const peeked = peekCompletionBootstrapCache(input.userId, input.organizationId);
  if (peeked?.freshness === "fresh") {
    return {
      payload: peeked.entry.payload,
      cacheSource: "hit" as const,
      cacheAgeMs: Math.max(0, Date.now() - peeked.entry.loadedAt),
      buildMs: 0,
    };
  }
  if (peeked?.freshness === "stale") {
    const generationAtStart = getCompletionBootstrapCacheGeneration(input.userId, input.organizationId);
    if (!getCompletionBootstrapInflight(key)) {
      void setCompletionBootstrapInflight(
        key,
        (async () => {
          try {
            const scanned = await loadCompletionQueueMatchedForBootstrap({
              organizationId: input.organizationId,
            });
            const payload = buildCompletionBootstrapPayload(scanned.matched, {
              truncated: scanned.truncated,
            });
            assertCompletionBootstrapPayloadBounds(payload);
            setCompletionBootstrapCache({
              userId: input.userId,
              organizationId: input.organizationId,
              payload,
              generationAtStart,
            });
          } catch {
            /* keep stale */
          }
          return null;
        })()
      );
    }
    return {
      payload: peeked.entry.payload,
      cacheSource: "stale" as const,
      cacheAgeMs: Math.max(0, Date.now() - peeked.entry.loadedAt),
      buildMs: 0,
    };
  }

  const existing = getCompletionBootstrapInflight<{
    payload: ReturnType<typeof buildCompletionBootstrapPayload>;
    cacheSource: "miss" | "inflight";
    cacheAgeMs: null;
    buildMs: number;
  }>(key);
  if (existing) {
    const shared = await existing;
    return { ...shared, cacheSource: "inflight" as const };
  }

  const generationAtStart = getCompletionBootstrapCacheGeneration(input.userId, input.organizationId);
  return setCompletionBootstrapInflight(key, (async () => {
    const buildT0 = performance.now();
    const scanned = await loadCompletionQueueMatchedForBootstrap({
      organizationId: input.organizationId,
    });
    const payload = buildCompletionBootstrapPayload(scanned.matched, {
      truncated: scanned.truncated,
    });
    assertCompletionBootstrapPayloadBounds(payload);
    const buildMs = Math.round(performance.now() - buildT0);
    setCompletionBootstrapCache({
      userId: input.userId,
      organizationId: input.organizationId,
      payload,
      generationAtStart,
    });
    return { payload, cacheSource: "miss" as const, cacheAgeMs: null, buildMs };
  })());
}

apiRouter.get("/invoice-completion/bootstrap", async (req, res) => {
  const wallStart = res.locals.invoicesFpWallStart ?? performance.now();
  const authStart = res.locals.invoicesFpAuthStart ?? wallStart;
  const authEnd = res.locals.invoicesFpAuthEnd ?? authStart;
  const tenantStart = res.locals.invoicesFpTenantStart ?? authEnd;
  const tenantEnd = res.locals.invoicesFpTenantEnd ?? tenantStart;
  const authMs = res.locals.invoicesFpAuthMs ?? Math.max(0, Math.round(authEnd - authStart));
  const tenantMs = res.locals.invoicesFpTenantMs ?? Math.max(0, Math.round(tenantEnd - tenantStart));
  const tenantCacheSource = res.locals.invoicesFpTenantCacheSource ?? "unknown";
  const tenantDbMs = res.locals.invoicesFpTenantDbMs ?? (tenantCacheSource === "hit" ? 0 : tenantMs);

  try {
    const cached = await getCompletionBootstrapCachedForRequest({
      userId: req.auth!.userId,
      organizationId: req.auth!.organizationId,
    });

    const serializeT0 = performance.now();
    const body = JSON.stringify(cached.payload);
    const serializeMs = Math.round(performance.now() - serializeT0);
    const responseT0 = performance.now();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const responseMs = Math.round(performance.now() - responseT0);
    const totalMs = Math.round(performance.now() - wallStart);
    const timingBase: Omit<InvoiceCompletionEndpointTiming, "unaccountedMs"> = {
      preRouteMs: Math.max(0, Math.round(authStart - wallStart)),
      authMs,
      tenantMs,
      tenantDbMs,
      orgMs: 0,
      queryMs: cached.cacheSource === "hit" || cached.cacheSource === "stale" ? 0 : cached.buildMs,
      countMs: 0,
      relationsMs: 0,
      mapMs: 0,
      serializeMs,
      responseMs,
      totalMs,
      tenantDbRoundTrips: tenantCacheSource === "hit" ? 0 : 2,
    };
    const timing: InvoiceCompletionEndpointTiming = {
      ...timingBase,
      unaccountedMs: computeCompletionUnaccountedMs(timingBase),
    };
    res.setHeader("Server-Timing", buildCompletionServerTiming(timing));
    res.setHeader("X-Invoice-Completion-Bootstrap-Cache", cached.cacheSource);
    res.send(body);
    logCompletionTimingSafe("invoice-completion/bootstrap", timing, {
      cacheSource: cached.cacheSource,
      payloadBytes: Buffer.byteLength(body, "utf8"),
    });
  } catch (err) {
    console.error(
      "[invoice-completion/bootstrap] failed",
      err instanceof Error ? err.message : String(err)
    );
    res.status(500).json({ error: "Failed to load invoice completion bootstrap" });
  }
});

apiRouter.get("/invoice-completion/list", async (req, res) => {
  const wallStart = res.locals.invoicesFpWallStart ?? performance.now();
  const authStart = res.locals.invoicesFpAuthStart ?? wallStart;
  const authEnd = res.locals.invoicesFpAuthEnd ?? authStart;
  const tenantStart = res.locals.invoicesFpTenantStart ?? authEnd;
  const tenantEnd = res.locals.invoicesFpTenantEnd ?? tenantStart;
  const authMs = res.locals.invoicesFpAuthMs ?? Math.max(0, Math.round(authEnd - authStart));
  const tenantMs = res.locals.invoicesFpTenantMs ?? Math.max(0, Math.round(tenantEnd - tenantStart));
  const tenantCacheSource = res.locals.invoicesFpTenantCacheSource ?? "unknown";
  const tenantDbMs = res.locals.invoicesFpTenantDbMs ?? (tenantCacheSource === "hit" ? 0 : tenantMs);

  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const page = clampCompletionListPage(Number.parseInt(String(req.query.page ?? "1"), 10));
    const pageSize = clampCompletionListPageSize(
      Number.parseInt(String(req.query.pageSize ?? "25"), 10)
    );
    const sortRaw = typeof req.query.sort === "string" ? req.query.sort : "date_desc";
    const sort = (
      ["date_desc", "date_asc", "amount_desc", "amount_asc"].includes(sortRaw) ? sortRaw : "date_desc"
    ) as CompletionListSort;

    const organizationId = req.auth!.organizationId;

    const queryT0 = performance.now();
    const scanned = await loadCompletionQueuePage({
      organizationId,
      status,
      clientId,
      search,
      page,
      pageSize,
      sort,
    });
    const queryMs = Math.round(performance.now() - queryT0);

    const relationsT0 = performance.now();
    // Readiness only for the current page — never block first rows on full-queue enrichment.
    const pageEnriched = await enrichInvoiceCandidatesWithReadiness(
      scanned.pageRows,
      organizationId
    );
    const relationsMs = Math.round(performance.now() - relationsT0);

    const mapT0 = performance.now();
    const payload = buildCompletionListPayload(pageEnriched, {
      page: scanned.page,
      pageSize: scanned.pageSize,
      total: scanned.total,
      hasMore: scanned.hasMore,
      truncated: scanned.truncated,
    });
    assertCompletionListPayloadBounds(payload);
    const mapMs = Math.round(performance.now() - mapT0);

    const serializeT0 = performance.now();
    const body = JSON.stringify(payload);
    const serializeMs = Math.round(performance.now() - serializeT0);
    const responseT0 = performance.now();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const responseMs = Math.round(performance.now() - responseT0);
    const totalMs = Math.round(performance.now() - wallStart);

    const timingBase: Omit<InvoiceCompletionEndpointTiming, "unaccountedMs"> = {
      preRouteMs: Math.max(0, Math.round(authStart - wallStart)),
      authMs,
      tenantMs,
      tenantDbMs,
      orgMs: 0,
      queryMs,
      countMs: 0,
      relationsMs,
      mapMs,
      serializeMs,
      responseMs,
      totalMs,
      tenantDbRoundTrips: tenantCacheSource === "hit" ? 0 : 2,
    };
    const timing: InvoiceCompletionEndpointTiming = {
      ...timingBase,
      unaccountedMs: computeCompletionUnaccountedMs(timingBase),
    };
    res.setHeader("Server-Timing", buildCompletionServerTiming(timing));
    res.send(body);
    logCompletionTimingSafe("invoice-completion/list", timing, {
      rowCount: payload.rows.length,
      total: payload.total,
      payloadBytes: Buffer.byteLength(body, "utf8"),
      page: payload.page,
      pageSize: payload.pageSize,
      sourceRowsScanned: scanned.sourceRowsScanned,
      waves: scanned.waves,
      truncated: scanned.truncated,
    });
  } catch (err) {
    console.error("[invoice-completion/list] failed", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to load invoice completion list" });
  }
});

apiRouter.get("/invoices/bootstrap", async (req, res) => {
  const wallStart = res.locals.invoicesFpWallStart ?? performance.now();
  const authStart = res.locals.invoicesFpAuthStart ?? wallStart;
  const authEnd = res.locals.invoicesFpAuthEnd ?? authStart;
  const tenantStart = res.locals.invoicesFpTenantStart ?? authEnd;
  const tenantEnd = res.locals.invoicesFpTenantEnd ?? tenantStart;
  const authMs = res.locals.invoicesFpAuthMs ?? Math.max(0, Math.round(authEnd - authStart));
  const tenantMs = res.locals.invoicesFpTenantMs ?? Math.max(0, Math.round(tenantEnd - tenantStart));
  const tenantCacheSource = res.locals.invoicesFpTenantCacheSource ?? "unknown";
  const tenantDbMs = res.locals.invoicesFpTenantDbMs ?? (tenantCacheSource === "hit" ? 0 : tenantMs);

  try {
    const cached = await getInvoicesBootstrapCachedForRequest({
      userId: req.auth!.userId,
      organizationId: req.auth!.organizationId,
      collectTiming: process.env.INVOICES_FP_DEBUG === "1" || process.env.INVOICES_TIMING === "1",
    });

    const serializeT0 = performance.now();
    const body = JSON.stringify(cached.payload);
    const serializeMs = Math.round(performance.now() - serializeT0);
    const responseT0 = performance.now();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const responseMs = Math.round(performance.now() - responseT0);
    const totalMs = Math.round(performance.now() - wallStart);
    const timingBase: Omit<InvoicesEndpointTiming, "unaccountedMs"> = {
      preRouteMs: Math.max(0, Math.round(authStart - wallStart)),
      authMs,
      tenantMs,
      tenantDbMs,
      orgMs: 0,
      queryMs: cached.cacheSource === "hit" || cached.cacheSource === "stale" ? 0 : cached.buildMs,
      countMs: 0,
      relationsMs: 0,
      mapMs: 0,
      serializeMs,
      responseMs,
      totalMs,
      tenantDbRoundTrips: tenantCacheSource === "hit" ? 0 : 2,
    };
    const timing: InvoicesEndpointTiming = {
      ...timingBase,
      unaccountedMs: computeInvoicesUnaccountedMs(timingBase),
    };
    res.setHeader("Server-Timing", buildInvoicesServerTiming(timing));
    res.setHeader("X-Invoices-Bootstrap-Cache", cached.cacheSource);
    res.send(body);
    logInvoicesTimingSafe("invoices/bootstrap", timing, {
      cacheSource: cached.cacheSource,
      payloadBytes: Buffer.byteLength(body, "utf8"),
    });
  } catch (err) {
    console.error("[invoices/bootstrap] failed", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to load invoices bootstrap" });
  }
});

apiRouter.get("/invoices/list", async (req, res) => {
  const wallStart = res.locals.invoicesFpWallStart ?? performance.now();
  const authStart = res.locals.invoicesFpAuthStart ?? wallStart;
  const authEnd = res.locals.invoicesFpAuthEnd ?? authStart;
  const tenantStart = res.locals.invoicesFpTenantStart ?? authEnd;
  const tenantEnd = res.locals.invoicesFpTenantEnd ?? tenantStart;
  const authMs = res.locals.invoicesFpAuthMs ?? Math.max(0, Math.round(authEnd - authStart));
  const tenantMs = res.locals.invoicesFpTenantMs ?? Math.max(0, Math.round(tenantEnd - tenantStart));
  const tenantCacheSource = res.locals.invoicesFpTenantCacheSource ?? "unknown";
  const tenantDbMs = res.locals.invoicesFpTenantDbMs ?? (tenantCacheSource === "hit" ? 0 : tenantMs);

  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const monthParam = typeof req.query.month === "string" ? req.query.month : undefined;
    const completeness = parseInvoiceCompletenessParam(req.query.completeness ?? "complete");
    const page = clampInvoiceListPage(Number.parseInt(String(req.query.page ?? "1"), 10));
    const pageSize = clampInvoiceListPageSize(Number.parseInt(String(req.query.pageSize ?? "25"), 10));
    const sortRaw = typeof req.query.sort === "string" ? req.query.sort : "date_desc";
    const sort = (
      ["date_desc", "date_asc", "amount_desc", "amount_asc"].includes(sortRaw) ? sortRaw : "date_desc"
    ) as InvoicesListSort;

    const organizationId = req.auth!.organizationId;
    const ctx = buildInvoiceListQueryContext({ organizationId, status, clientId, search });
    const parsedMonth = monthParam ? parseInvoiceMonthParam(monthParam) : null;
    if (monthParam && !parsedMonth) {
      res.status(400).json({ error: "Invalid month parameter. Expected YYYY-MM." });
      return;
    }
    const monthBounds = parsedMonth
      ? await resolveInvoiceMonthBounds(
          organizationId,
          parsedMonth.year,
          parsedMonth.month,
          await loadOrganizationTimezone(organizationId)
        )
      : undefined;

    const fetchLimit = monthBounds ? undefined : Math.min(page * pageSize + pageSize, 300);
    const queryT0 = performance.now();
    const invoices = await fetchEnrichedInvoiceListCandidates(organizationId, ctx, {
      monthBounds,
      limit: fetchLimit,
    });
    const queryMs = Math.round(performance.now() - queryT0);

    const filterT0 = performance.now();
    const filtered = filterInvoicesByCompleteness(invoices, completeness);
    let visible =
      completeness === "incomplete" ? filterInvoiceCompletionQueueCandidates(filtered) : filtered;
    if (completeness === "incomplete") {
      visible = await enrichInvoiceCandidatesWithReadiness(visible, organizationId);
    }
    const filterMs = Math.round(performance.now() - filterT0);

    const mapT0 = performance.now();
    const payload = buildInvoicesListPayload(visible, { page, pageSize, sort });
    assertInvoicesListPayloadBounds(payload);
    const mapMs = Math.round(performance.now() - mapT0);

    const serializeT0 = performance.now();
    const body = JSON.stringify(payload);
    const serializeMs = Math.round(performance.now() - serializeT0);
    const responseT0 = performance.now();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const responseMs = Math.round(performance.now() - responseT0);
    const totalMs = Math.round(performance.now() - wallStart);

    const timingBase: Omit<InvoicesEndpointTiming, "unaccountedMs"> = {
      preRouteMs: Math.max(0, Math.round(authStart - wallStart)),
      authMs,
      tenantMs,
      tenantDbMs,
      orgMs: 0,
      queryMs,
      countMs: filterMs,
      relationsMs: 0,
      mapMs,
      serializeMs,
      responseMs,
      totalMs,
      tenantDbRoundTrips: tenantCacheSource === "hit" ? 0 : 2,
    };
    const timing: InvoicesEndpointTiming = {
      ...timingBase,
      unaccountedMs: computeInvoicesUnaccountedMs(timingBase),
    };
    res.setHeader("Server-Timing", buildInvoicesServerTiming(timing));
    res.send(body);
    logInvoicesTimingSafe("invoices/list", timing, {
      rowCount: payload.invoices.length,
      total: payload.total,
      payloadBytes: Buffer.byteLength(body, "utf8"),
      page: payload.page,
      pageSize: payload.pageSize,
    });
  } catch (err) {
    console.error("[invoices/list] failed", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to load invoices list" });
  }
});

apiRouter.get("/invoices/months", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const completeness = parseInvoiceCompletenessParam(req.query.completeness);
  const organizationId = req.auth!.organizationId;
  const ctx = buildInvoiceListQueryContext({ organizationId, status, clientId, search });
  const timezone = await loadOrganizationTimezone(organizationId);

  if (completeness !== "all") {
    const candidates = await fetchEnrichedInvoiceListCandidates(organizationId, ctx, { limit: undefined });
    const filtered = filterInvoicesByCompleteness(candidates, completeness);
    const visible =
      completeness === "incomplete" ? filterInvoiceCompletionQueueCandidates(filtered) : filtered;
    const months = summarizeCandidatesByMonth(
      visible.map((candidate) => ({ ...candidate, amount: candidate.amount ?? 0 })),
      (candidate) => candidate.date,
      timezone,
    );
    res.json({ months });
    return;
  }

  const { sql, params } = buildInvoiceMonthsAggregationSql(ctx, timezone);
  const rows = await prisma.$queryRawUnsafe<InvoiceMonthAggregationRow[]>(sql, ...params);
  const months = summarizeInvoiceMonthRows(rows);
  res.json({ months });
});

apiRouter.get("/invoices", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const monthParam = typeof req.query.month === "string" ? req.query.month : undefined;
  const completeness = parseInvoiceCompletenessParam(req.query.completeness);
  const organizationId = req.auth!.organizationId;
  const ctx = buildInvoiceListQueryContext({ organizationId, status, clientId, search });
  const parsedMonth = monthParam ? parseInvoiceMonthParam(monthParam) : null;
  if (monthParam && !parsedMonth) {
    res.status(400).json({ error: "Invalid month parameter. Expected YYYY-MM." });
    return;
  }
  const monthBounds = parsedMonth
    ? await resolveInvoiceMonthBounds(organizationId, parsedMonth.year, parsedMonth.month, await loadOrganizationTimezone(organizationId))
    : undefined;

  const parsedLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
  const defaultListLimit = completeness === "incomplete" ? 300 : 100;
  const listLimit = monthBounds
    ? undefined
    : Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(300, parsedLimit)
      : defaultListLimit;

  const invoices = await fetchEnrichedInvoiceListCandidates(organizationId, ctx, {
    monthBounds,
    limit: listLimit,
  });
  const filtered = filterInvoicesByCompleteness(invoices, completeness);
  const visible =
    completeness === "incomplete" ? filterInvoiceCompletionQueueCandidates(filtered) : filtered;
  let responseInvoices = monthBounds ? visible : visible.slice(0, listLimit);
  if (completeness === "incomplete") {
    responseInvoices = await enrichInvoiceCandidatesWithReadiness(responseInvoices, organizationId);
  }

  const needsReviewCount = responseInvoices.filter((invoice) => invoice.reviewStatus === "needs_review").length;
  console.log(`[invoices] UI_INVOICES_API_RETURNED count=${responseInvoices.length} org=${organizationId}${monthBounds ? ` month=${monthParam}` : ""} completeness=${completeness}`);
  console.log(`[invoices] NEEDS_REVIEW_INVOICES_RETURNED count=${needsReviewCount} org=${organizationId}`);
  res.json({ invoices: responseInvoices });
});

apiRouter.post("/invoices/:sourceType/:id/complete", requirePerm("review.approve"), async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const sourceTypeParam = Array.isArray(req.params.sourceType) ? req.params.sourceType[0] : req.params.sourceType;
  const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sourceType = parseInvoiceCompletionSourceType(sourceTypeParam);
  if (!sourceType) {
    res.status(400).json({ error: "Invalid invoice source type" });
    return;
  }

  const body = req.body as InvoiceCompletionRequest;
  const rawId = stripInvoiceCompletionId(idParam);
  const input: InvoiceCompletionRequest = {
    supplier: typeof body.supplier === "string" ? body.supplier : undefined,
    amount: typeof body.amount === "number" && Number.isFinite(body.amount) ? body.amount : undefined,
    date: typeof body.date === "string" ? body.date : undefined,
    documentType: typeof body.documentType === "string" ? body.documentType : undefined,
    currency: typeof body.currency === "string" ? body.currency : undefined,
    approve: body.approve === true,
  };

  try {
    let ctx = await loadInvoiceCompletionContext(organizationId, sourceType, rawId);
    const hasFieldUpdates =
      input.supplier !== undefined ||
      input.amount !== undefined ||
      input.date !== undefined ||
      input.documentType !== undefined ||
      input.currency !== undefined;

    if (hasFieldUpdates) {
      ctx = await applyInvoiceCompletionFieldUpdates(ctx, input);
    }

    let candidate = mapInvoiceCompletionContextToCandidate(ctx, organizationId);
    let assessment = assessReviewInvoiceCandidate(candidate);

    if (input.approve) {
      validateApproveAllowed(assessment);
      if (assessment.approvalRequired) {
        ctx = await approveInvoiceCompletionContext(organizationId, ctx, {
          userId: req.auth!.userId,
          sourceRoute: "POST /api/invoices/:sourceType/:id/complete",
          supplier: input.supplier,
        });
        ctx = await loadInvoiceCompletionContext(organizationId, sourceType, rawId);
        candidate = mapInvoiceCompletionContextToCandidate(ctx, organizationId);
        assessment = assessReviewInvoiceCandidate(candidate);
      }
    }

    const approved = !assessment.approvalRequired && isInvoiceRecordApproved(candidate.rawReviewStatus ?? candidate.reviewStatus);
    const destination = assessment.isComplete ? "invoices" : "completion";

    safeInvalidateCompletionBootstrap(undefined, organizationId);
    safeInvalidateInvoicesBootstrap(undefined, organizationId);

    res.json({
      dataComplete: assessment.dataComplete,
      approved,
      destination,
      invoice: candidate,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invoice completion failed";
    const status = mapCompletionErrorStatus(message);
    console.warn(`[invoices] complete failed org=${organizationId} source=${sourceType} id=${rawId} status=${status} error=${message}`);
    const code = message.includes("supplier.needs_confirmation")
      ? "supplier.needs_confirmation"
      : message.includes("BLOCKED") || message.includes("blocked")
        ? "blocked_outcome"
        : message.includes("לא ניתן לאשר")
          ? "approve_blocked"
          : "completion_failed";
    res.status(status).json({ error: message, code });
  }
});

apiRouter.put("/invoices/:id/status", requirePerm("invoice.update"), async (req, res) => {
  const body = req.body as { status?: string };
  if (!body.status || !["paid", "pending", "overdue"].includes(body.status)) {
    res.status(400).json({ error: "Invalid invoice status" });
    return;
  }
  const invoice = await prisma.invoice.findFirst({
    where: { id: routeId(req), organizationId: req.auth!.organizationId },
  });
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const updated = await prisma.invoice.update({ where: { id: invoice.id }, data: { status: body.status } });
  recordPlatformAudit({
    ...userAuditContext(req.auth!.userId, "api", "PUT /invoices/:id/status", resolveWorkflowCorrelationId({ gmailMessageId: invoice.gmailMessageId, emailMessageId: invoice.emailId })),
    organizationId: req.auth!.organizationId,
    entityType: "invoice",
    entityId: invoice.id,
    action: "invoice_updated",
    beforeState: invoiceAuditSnapshot(invoice),
    afterState: invoiceAuditSnapshot(updated),
    metadata: { field: "status", previousStatus: invoice.status, nextStatus: body.status },
  });
  try {
    const { updateInvoiceStatusInSheets } = await import("../services/clientSheetsService.js");
    await updateInvoiceStatusInSheets(invoice.clientId, invoice.sheetsRow, body.status);
  } catch (err) {
    console.error("[invoices] failed to update sheet status", err);
  }
  res.json({ invoice: updated });
});

type InvoiceArtifactDeleteSeed = {
  invoiceId?: string;
  gmailScanItemId?: string;
  documentReviewId?: string;
};

async function deleteInvoiceArtifacts(organizationId: string, seed: InvoiceArtifactDeleteSeed) {
  const [seedInvoice, seedScanItem, seedReview] = await Promise.all([
    seed.invoiceId
      ? prisma.invoice.findFirst({
          where: { id: seed.invoiceId, organizationId },
          select: { id: true, emailId: true, gmailMessageId: true, invoiceNumber: true, amount: true, date: true, supplierName: true },
        })
      : Promise.resolve(null),
    seed.gmailScanItemId
      ? prisma.gmailScanItem.findFirst({
          where: { id: seed.gmailScanItemId, organizationId },
          select: { id: true, emailMessageId: true, gmailMessageId: true },
        })
      : Promise.resolve(null),
    seed.documentReviewId
      ? prisma.financialDocumentReview.findFirst({
          where: { id: seed.documentReviewId, organizationId },
          select: { id: true, emailMessageId: true, gmailMessageId: true, invoiceNumber: true, totalAmount: true, documentDate: true, supplierName: true },
        })
      : Promise.resolve(null),
  ]);

  if ((seed.invoiceId && !seedInvoice) || (seed.gmailScanItemId && !seedScanItem) || (seed.documentReviewId && !seedReview)) {
    return { found: false as const };
  }

  const invoiceIds = new Set<string>();
  const gmailScanItemIds = new Set<string>();
  const documentReviewIds = new Set<string>();
  const gmailMessageIds = new Set<string>();
  const emailMessageIds = new Set<string>();
  const invoiceFingerprints: Array<{ invoiceNumber: string; amount: number; date: Date | null; supplierName: string | null }> = [];

  function addRefs(input: { gmailMessageId?: string | null; emailMessageId?: string | null }) {
    if (input.gmailMessageId) gmailMessageIds.add(input.gmailMessageId);
    if (input.emailMessageId) emailMessageIds.add(input.emailMessageId);
  }

  function addInvoiceFingerprint(input: { invoiceNumber?: string | null; amount?: number | null; date?: Date | null; supplierName?: string | null }) {
    if (!input.invoiceNumber || input.amount == null || !Number.isFinite(input.amount)) return;
    invoiceFingerprints.push({
      invoiceNumber: input.invoiceNumber,
      amount: input.amount,
      date: input.date ?? null,
      supplierName: input.supplierName ?? null,
    });
  }

  if (seedInvoice) {
    invoiceIds.add(seedInvoice.id);
    addRefs({ gmailMessageId: seedInvoice.gmailMessageId, emailMessageId: seedInvoice.emailId });
    addInvoiceFingerprint(seedInvoice);
  }
  if (seedScanItem) {
    gmailScanItemIds.add(seedScanItem.id);
    addRefs(seedScanItem);
  }
  if (seedReview) {
    documentReviewIds.add(seedReview.id);
    addRefs(seedReview);
    addInvoiceFingerprint({ invoiceNumber: seedReview.invoiceNumber, amount: seedReview.totalAmount, date: seedReview.documentDate, supplierName: seedReview.supplierName });
  }

  for (let round = 0; round < 2; round += 1) {
    const invoiceWhere = buildLinkedInvoiceWhere(organizationId, gmailMessageIds, emailMessageIds, invoiceFingerprints);
    const scanItemWhere = buildLinkedGmailScanItemWhere(organizationId, gmailMessageIds, emailMessageIds);
    const reviewWhere = buildLinkedDocumentReviewWhere(organizationId, gmailMessageIds, emailMessageIds, invoiceFingerprints);
    const [linkedInvoices, linkedScanItems, linkedReviews] = await Promise.all([
      invoiceWhere ? prisma.invoice.findMany({ where: invoiceWhere, select: { id: true, emailId: true, gmailMessageId: true, invoiceNumber: true, amount: true, date: true, supplierName: true } }) : Promise.resolve([]),
      scanItemWhere ? prisma.gmailScanItem.findMany({ where: scanItemWhere, select: { id: true, emailMessageId: true, gmailMessageId: true } }) : Promise.resolve([]),
      reviewWhere ? prisma.financialDocumentReview.findMany({ where: reviewWhere, select: { id: true, emailMessageId: true, gmailMessageId: true, invoiceNumber: true, totalAmount: true, documentDate: true, supplierName: true } }) : Promise.resolve([]),
    ]);

    for (const invoice of linkedInvoices) {
      invoiceIds.add(invoice.id);
      addRefs({ gmailMessageId: invoice.gmailMessageId, emailMessageId: invoice.emailId });
      addInvoiceFingerprint(invoice);
    }
    for (const item of linkedScanItems) {
      gmailScanItemIds.add(item.id);
      addRefs(item);
    }
    for (const review of linkedReviews) {
      documentReviewIds.add(review.id);
      addRefs(review);
      addInvoiceFingerprint({ invoiceNumber: review.invoiceNumber, amount: review.totalAmount, date: review.documentDate, supplierName: review.supplierName });
    }
  }

  const invoiceIdList = [...invoiceIds];
  const gmailScanItemIdList = [...gmailScanItemIds];
  const documentReviewIdList = [...documentReviewIds];
  const emailMessageIdList = [...emailMessageIds];

  const before = {
    invoices: invoiceIdList.length,
    gmailScanItems: gmailScanItemIdList.length,
    documentReviews: documentReviewIdList.length,
  };

  const [bankMatches, whatsappMessages, tasks, documentReviews, gmailScanItems, invoices] = await prisma.$transaction([
    prisma.bankTransaction.updateMany({
      where: { organizationId, matchedInvoiceId: { in: invoiceIdList } },
      data: { matchedInvoiceId: null, matchStatus: "unmatched", matchConfidence: null },
    }),
    prisma.whatsAppMessage.updateMany({
      where: { invoiceId: { in: invoiceIdList } },
      data: { invoiceId: null, hasInvoice: false },
    }),
    prisma.task.updateMany({
      where: {
        organizationId,
        emailMessageId: { in: emailMessageIdList },
        status: "open",
      },
      data: { status: "completed" },
    }),
    prisma.financialDocumentReview.deleteMany({
      where: { organizationId, id: { in: documentReviewIdList } },
    }),
    prisma.gmailScanItem.deleteMany({
      where: { organizationId, id: { in: gmailScanItemIdList } },
    }),
    prisma.invoice.deleteMany({
      where: { organizationId, id: { in: invoiceIdList } },
    }),
  ]);

  const after = {
    invoices: invoiceIdList.length
      ? await prisma.invoice.count({ where: { organizationId, id: { in: invoiceIdList } } })
      : 0,
    gmailScanItems: gmailScanItemIdList.length
      ? await prisma.gmailScanItem.count({ where: { organizationId, id: { in: gmailScanItemIdList } } })
      : 0,
    documentReviews: documentReviewIdList.length
      ? await prisma.financialDocumentReview.count({ where: { organizationId, id: { in: documentReviewIdList } } })
      : 0,
  };

  console.log(
    `[invoice-delete] org=${organizationId} seed=${JSON.stringify(seed)} before=${JSON.stringify(before)} deleted=${JSON.stringify({ invoices: invoices.count, gmailScanItems: gmailScanItems.count, documentReviews: documentReviews.count })} after=${JSON.stringify(after)} unlinked=${JSON.stringify({ bankTransactions: bankMatches.count, whatsappMessages: whatsappMessages.count, tasks: tasks.count })}`
  );

  const { safeInvalidateDashboardBootstrap } = await import("../services/dashboardBootstrapCache.js");
  safeInvalidateDashboardBootstrap(undefined, organizationId);
  const { safeInvalidateInvoicesBootstrap } = await import("../services/invoices/invoiceBootstrapCache.js");
  safeInvalidateInvoicesBootstrap(undefined, organizationId);
  const { safeInvalidateCompletionBootstrap } = await import(
    "../services/invoiceCompletion/completionBootstrapCache.js"
  );
  safeInvalidateCompletionBootstrap(undefined, organizationId);

  return {
    found: true as const,
    deleted: {
      invoices: invoices.count,
      gmailScanItems: gmailScanItems.count,
      documentReviews: documentReviews.count,
    },
    verification: { before, after },
    unlinked: {
      bankTransactions: bankMatches.count,
      whatsappMessages: whatsappMessages.count,
      tasks: tasks.count,
    },
  };
}

function buildLinkedInvoiceWhere(
  organizationId: string,
  gmailMessageIds: Set<string>,
  emailMessageIds: Set<string>,
  fingerprints: Array<{ invoiceNumber: string; amount: number; date: Date | null; supplierName: string | null }>
): Prisma.InvoiceWhereInput | null {
  const OR: Prisma.InvoiceWhereInput[] = [];
  if (gmailMessageIds.size) OR.push({ gmailMessageId: { in: [...gmailMessageIds] } });
  if (emailMessageIds.size) OR.push({ emailId: { in: [...emailMessageIds] } });
  for (const fingerprint of fingerprints) {
    OR.push({
      invoiceNumber: fingerprint.invoiceNumber,
      amount: fingerprint.amount,
      ...(fingerprint.supplierName ? { supplierName: fingerprint.supplierName } : {}),
      ...(fingerprint.date ? { date: dateDayWhere(fingerprint.date) } : {}),
    });
  }
  return OR.length ? { organizationId, OR } : null;
}

function buildLinkedGmailScanItemWhere(
  organizationId: string,
  gmailMessageIds: Set<string>,
  emailMessageIds: Set<string>
): Prisma.GmailScanItemWhereInput | null {
  const OR: Prisma.GmailScanItemWhereInput[] = [];
  if (gmailMessageIds.size) OR.push({ gmailMessageId: { in: [...gmailMessageIds] } });
  if (emailMessageIds.size) OR.push({ emailMessageId: { in: [...emailMessageIds] } });
  return OR.length ? { organizationId, OR } : null;
}

function buildLinkedDocumentReviewWhere(
  organizationId: string,
  gmailMessageIds: Set<string>,
  emailMessageIds: Set<string>,
  fingerprints: Array<{ invoiceNumber: string; amount: number; date: Date | null; supplierName: string | null }>
): Prisma.FinancialDocumentReviewWhereInput | null {
  const OR: Prisma.FinancialDocumentReviewWhereInput[] = [];
  if (gmailMessageIds.size) OR.push({ gmailMessageId: { in: [...gmailMessageIds] } });
  if (emailMessageIds.size) OR.push({ emailMessageId: { in: [...emailMessageIds] } });
  for (const fingerprint of fingerprints) {
    OR.push({
      invoiceNumber: fingerprint.invoiceNumber,
      totalAmount: fingerprint.amount,
      ...(fingerprint.supplierName ? { supplierName: fingerprint.supplierName } : {}),
      ...(fingerprint.date ? { documentDate: dateDayWhere(fingerprint.date) } : {}),
    });
  }
  return OR.length ? { organizationId, OR } : null;
}

function dateDayWhere(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { gte: start, lt: end };
}

apiRouter.delete("/invoices/:id", requirePerm("invoice.delete"), async (req, res) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id: routeId(req), organizationId: req.auth!.organizationId },
    select: { id: true, status: true, amount: true, currency: true, gmailMessageId: true, emailId: true },
  });
  const result = await deleteInvoiceArtifacts(req.auth!.organizationId, { invoiceId: routeId(req) });
  if (!result.found) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  if (invoice) {
    recordPlatformAudit({
      ...userAuditContext(req.auth!.userId, "api", "DELETE /invoices/:id", resolveWorkflowCorrelationId({ gmailMessageId: invoice.gmailMessageId, emailMessageId: invoice.emailId })),
      organizationId: req.auth!.organizationId,
      entityType: "invoice",
      entityId: invoice.id,
      action: "invoice_deleted",
      beforeState: invoiceAuditSnapshot(invoice),
      afterState: null,
    });
  }
  res.json({
    ok: true,
    deleted: result.deleted,
    verification: result.verification,
    unlinked: result.unlinked,
  });
});

apiRouter.get("/organizations/:id/invoices/summary", async (req, res) => {
  if (req.params.id !== req.auth!.organizationId) {
    res.status(403).json({ error: "Organization access denied" });
    return;
  }
  const invoices = await prisma.invoice.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: { client: { select: { id: true, name: true } } },
  });
  const byStatus = invoices.reduce<Record<string, number>>((acc, invoice) => {
    acc[invoice.status] = (acc[invoice.status] ?? 0) + invoice.amount;
    return acc;
  }, {});
  const byClient = invoices.reduce<Record<string, { clientId: string; clientName: string; count: number; amount: number }>>((acc, invoice) => {
    const current = acc[invoice.clientId] ?? { clientId: invoice.clientId, clientName: invoice.client.name, count: 0, amount: 0 };
    current.count += 1;
    current.amount += invoice.amount;
    acc[invoice.clientId] = current;
    return acc;
  }, {});
  res.json({ count: invoices.length, byStatus, byClient: Object.values(byClient) });
});

apiRouter.get("/payments/months", async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const timezone = await loadOrganizationTimezone(organizationId);
  const { sql, params } = buildPaymentMonthsAggregationSql(organizationId, timezone);
  const rows = await prisma.$queryRawUnsafe<InvoiceMonthAggregationRow[]>(sql, ...params);
  const months = summarizeInvoiceMonthRows(rows);
  const totalApprovedWithDate = await prisma.supplierPayment.count({
    where: {
      organizationId,
      approvalStatus: "approved",
      normalizedDocumentDate: { not: null },
    },
  });
  const monthCountSum = sumPaymentMonthCounts(months);
  if (totalApprovedWithDate !== monthCountSum) {
    console.warn(
      `[payments] MONTH_COUNT_MISMATCH org=${organizationId} db=${totalApprovedWithDate} summed=${monthCountSum}`
    );
  }
  res.json({ months });
});

apiRouter.get("/payments", async (req, res) => {
  const duplicatesOnly = req.query.duplicatesOnly === "true";
  const monthParam = typeof req.query.month === "string" ? req.query.month : undefined;
  const organizationId = req.auth!.organizationId;
  const parsedMonth = monthParam ? parseInvoiceMonthParam(monthParam) : null;
  if (monthParam && !parsedMonth) {
    res.status(400).json({ error: "Invalid month parameter. Expected YYYY-MM." });
    return;
  }
  const monthBounds = parsedMonth
    ? await resolveInvoiceMonthBounds(
        organizationId,
        parsedMonth.year,
        parsedMonth.month,
        await loadOrganizationTimezone(organizationId)
      )
    : undefined;
  const payments = await prisma.supplierPayment.findMany({
    where: mergePrismaWhere(
      {
        organizationId,
        approvalStatus: "approved",
        ...(duplicatesOnly ? { duplicateDetected: true } : {}),
        ...(monthBounds
          ? { normalizedDocumentDate: { gte: monthBounds.gte, lt: monthBounds.lt } }
          : {}),
      },
      buildSupplierPaymentReadIsolationWhere(
        organizationId,
        await loadCrossOrgContaminatedGmailIdsForReads(),
      ),
    ),
    orderBy: { date: "desc" },
    ...(monthBounds ? {} : { take: 100 }),
  });
  res.json(payments.map(enrichPaymentSources));
});

const APPOINTMENT_STATUSES = new Set(["pending", "confirmed", "completed", "cancelled", "no_show"]);

function parseIsoDateTime(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return parsed;
}

function parseOptionalIsoDateTime(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") return undefined;
  return parseIsoDateTime(value, fieldName);
}

async function handleIdempotentRequest(params: {
  req: Request;
  routeKey: string;
  organizationId: string;
  body: unknown;
  execute: () => Promise<{ statusCode: number; body: unknown }>;
}): Promise<{ statusCode: number; body: unknown }> {
  let begun;
  try {
    begun = await beginIdempotentRequest({
      prisma,
      organizationId: params.organizationId,
      routeKey: params.routeKey,
      method: params.req.method,
      idempotencyKeyHeader:
        typeof params.req.headers["idempotency-key"] === "string"
          ? params.req.headers["idempotency-key"]
          : undefined,
      body: params.body,
    });
  } catch (err) {
    const idempotencyKey =
      typeof params.req.headers["idempotency-key"] === "string" ? params.req.headers["idempotency-key"] : null;
    const mapped = idempotencyErrorResponse(err);
    if (mapped.body.code === "idempotency_mismatch") {
      recordCalendarAudit({
        organizationId: params.organizationId,
        entityType: "idempotency",
        entityId: params.routeKey,
        action: "calendar_idempotency_conflict",
        actor: { actorType: "user", actorUserId: params.req.auth?.userId ?? null },
        sourceModule: "api",
        sourceRoute: `${params.req.method} ${params.req.path}`,
        reason: mapped.body.error,
        metadata: { routeKey: params.routeKey, idempotencyKey },
      });
    }
    return mapped;
  }

  if (begun.mode === "replay") {
    recordCalendarAudit({
      organizationId: params.organizationId,
      entityType: "idempotency",
      entityId: params.routeKey,
      action: "calendar_idempotency_replay",
      actor: { actorType: "user", actorUserId: params.req.auth?.userId ?? null },
      sourceModule: "api",
      sourceRoute: `${params.req.method} ${params.req.path}`,
      metadata: {
        routeKey: params.routeKey,
        idempotencyKey:
          typeof params.req.headers["idempotency-key"] === "string" ? params.req.headers["idempotency-key"] : null,
      },
    });
    return { statusCode: begun.statusCode, body: begun.responseBody };
  }

  const result = await params.execute();
  if (begun.mode === "active") {
    await completeIdempotentRequest({
      prisma,
      recordId: begun.recordId,
      statusCode: result.statusCode,
      responseBody: result.body,
    });
  }
  return result;
}


apiRouter.get("/services", requireCalendarView, async (req, res) => {
  try {
    const services = await prisma.service.findMany({
      where: { organizationId: req.auth!.organizationId },
      orderBy: { name: "asc" },
      include: { employeeLinks: { select: { employeeId: true } } },
    });
    res.json(
      services.map((service) => ({
        ...service,
        // אילו עובדים מבצעים את השירות; ריק = כולם
        employeeIds: service.employeeLinks.map((link) => link.employeeId),
        employeeLinks: undefined,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load services" });
  }
});

apiRouter.post("/services", requireCalendarCreate, async (req, res) => {
  try {
    const body = req.body as {
      name?: string;
      durationMinutes?: number;
      price?: number;
      color?: string;
      employeeIds?: string[];
    };
    const name = body.name?.trim();
    if (!name) {
      res.status(400).json({ error: "Service name is required" });
      return;
    }
    const durationMinutes = Number.isFinite(body.durationMinutes) ? Number(body.durationMinutes) : 30;
    if (durationMinutes <= 0) {
      res.status(400).json({ error: "durationMinutes must be a positive number" });
      return;
    }
    const service = await prisma.service.create({
      data: {
        organizationId: req.auth!.organizationId,
        name,
        durationMinutes,
        ...(body.price !== undefined && Number.isFinite(body.price) ? { price: body.price } : {}),
        ...(body.color?.trim() ? { color: body.color.trim() } : {}),
      },
    });
    let employeeIds: string[] = [];
    if (body.employeeIds !== undefined) {
      const { setServiceEmployees } = await import("../services/employees/employeeService.js");
      const linkResult = await setServiceEmployees(req.auth!.organizationId, service.id, body.employeeIds);
      if (!linkResult.ok) {
        res.status(400).json({ error: linkResult.error });
        return;
      }
      employeeIds = linkResult.employeeIds;
    }
    res.status(201).json({ ...service, employeeIds });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create service" });
  }
});

apiRouter.patch("/services/:id", requireCalendarUpdate, async (req, res) => {
  try {
    const organizationId = req.auth!.organizationId;
    const existing = await prisma.service.findFirst({
      where: { id: routeId(req), organizationId },
    });
    if (!existing) {
      res.status(404).json({ error: "Service not found" });
      return;
    }
    const body = req.body as {
      name?: string;
      durationMinutes?: number;
      price?: number | null;
      color?: string | null;
      isActive?: boolean;
      employeeIds?: string[];
    };
    const data: Prisma.ServiceUpdateInput = {};
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) {
        res.status(400).json({ error: "Service name cannot be empty" });
        return;
      }
      data.name = name;
    }
    if (body.durationMinutes !== undefined) {
      if (!Number.isFinite(body.durationMinutes) || body.durationMinutes <= 0) {
        res.status(400).json({ error: "durationMinutes must be a positive number" });
        return;
      }
      data.durationMinutes = body.durationMinutes;
    }
    if (body.price !== undefined) {
      data.price = body.price === null || !Number.isFinite(body.price) ? null : body.price;
    }
    if (body.color !== undefined) {
      data.color = body.color?.trim() || null;
    }
    if (body.isActive !== undefined) {
      data.isActive = Boolean(body.isActive);
    }
    const service = await prisma.service.update({
      where: { id: existing.id },
      data,
    });
    if (body.employeeIds !== undefined) {
      const { setServiceEmployees } = await import("../services/employees/employeeService.js");
      const linkResult = await setServiceEmployees(req.auth!.organizationId, service.id, body.employeeIds);
      if (!linkResult.ok) {
        res.status(400).json({ error: linkResult.error });
        return;
      }
      res.json({ ...service, employeeIds: linkResult.employeeIds });
      return;
    }
    const links = await prisma.serviceEmployee.findMany({
      where: { serviceId: service.id },
      select: { employeeId: true },
    });
    res.json({ ...service, employeeIds: links.map((link) => link.employeeId) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update service" });
  }
});

apiRouter.delete("/services/:id", requireCalendarCancel, async (req, res) => {
  try {
    const updated = await prisma.service.updateMany({
      where: { id: routeId(req), organizationId: req.auth!.organizationId },
      data: { isActive: false },
    });
    if (updated.count === 0) {
      res.status(404).json({ error: "Service not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to deactivate service" });
  }
});

// ===== Calendar Phase 1 — עובדים ביומן =====

apiRouter.get("/employees", requireCalendarView, async (req, res) => {
  try {
    const { listEmployees } = await import("../services/employees/employeeService.js");
    const employees = await listEmployees(req.auth!.organizationId);
    res.json(
      employees.map((employee) => ({
        ...employee,
        serviceIds: employee.serviceLinks.map((link) => link.serviceId),
        serviceLinks: undefined,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load employees" });
  }
});

apiRouter.post("/employees", requireCalendarCreate, async (req, res) => {
  try {
    const { createEmployee } = await import("../services/employees/employeeService.js");
    const result = await createEmployee(req.auth!.organizationId, req.body ?? {});
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json(result.employee);
  } catch (err) {
    // P2021 = הטבלה לא קיימת ב-DB (מיגרציה שלא רצה) — שגיאה ברורה במקום
    // דמפ Prisma גולמי; הסיבה המלאה נשמרת בלוג השרת.
    const prismaCode = (err as { code?: string })?.code;
    console.error(`[employees] create failed org=${req.auth!.organizationId}`, err);
    if (prismaCode === "P2021" || prismaCode === "P2022") {
      res.status(500).json({
        error: "בסיס הנתונים עדיין לא עודכן לגרסה עם ניהול עובדים — הפריסה הבאה תעדכן אותו אוטומטית. נסה שוב בעוד כמה דקות.",
        code: "db_schema_out_of_date",
      });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create employee" });
  }
});

apiRouter.patch("/employees/:id", requireCalendarUpdate, async (req, res) => {
  try {
    const { updateEmployee } = await import("../services/employees/employeeService.js");
    const result = await updateEmployee(req.auth!.organizationId, routeId(req), req.body ?? {});
    if (!result.ok) {
      res.status("notFound" in result && result.notFound ? 404 : 400).json({ error: result.error });
      return;
    }
    res.json(result.employee);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update employee" });
  }
});

apiRouter.delete("/employees/:id", requireCalendarCancel, async (req, res) => {
  try {
    const { deleteEmployee } = await import("../services/employees/employeeService.js");
    const result = await deleteEmployee(req.auth!.organizationId, routeId(req));
    if (!result.ok) {
      const status = "notFound" in result && result.notFound ? 404 : "conflict" in result && result.conflict ? 409 : 400;
      res.status(status).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete employee" });
  }
});

apiRouter.put("/employees/:id/working-hours", requireCalendarUpdate, async (req, res) => {
  try {
    const { setEmployeeWorkingHours } = await import("../services/employees/employeeService.js");
    const body = req.body as { workingHours?: unknown };
    const result = await setEmployeeWorkingHours(
      req.auth!.organizationId,
      routeId(req),
      body?.workingHours ?? []
    );
    if (!result.ok) {
      res.status("notFound" in result && result.notFound ? 404 : 400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, workingHours: result.entries });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update working hours" });
  }
});

apiRouter.post("/employees/:id/vacations", requireCalendarUpdate, async (req, res) => {
  try {
    const { addEmployeeVacation } = await import("../services/employees/employeeService.js");
    const result = await addEmployeeVacation(req.auth!.organizationId, routeId(req), req.body ?? {});
    if (!result.ok) {
      res.status("notFound" in result && result.notFound ? 404 : 400).json({ error: result.error });
      return;
    }
    res.status(201).json(result.vacation);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to add vacation" });
  }
});

apiRouter.delete("/employees/vacations/:id", requireCalendarUpdate, async (req, res) => {
  try {
    const { removeEmployeeVacation } = await import("../services/employees/employeeService.js");
    const result = await removeEmployeeVacation(req.auth!.organizationId, routeId(req));
    if (!result.ok) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to remove vacation" });
  }
});

apiRouter.get("/scheduling/capabilities", requireCalendarView, async (req, res) => {
  try {
    const capabilities = await getSchedulingCapabilities(req.auth!.organizationId);
    res.json(capabilities);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to load scheduling capabilities",
    });
  }
});

apiRouter.get("/calendar/bootstrap", requireCalendarView, async (req, res) => {
  try {
    const payload = await getCalendarBootstrap(req.auth!.organizationId, {
      collectTiming: process.env.CALENDAR_BOOTSTRAP_TIMING === "1",
    });
    assertCalendarBootstrapPayloadBounds(payload);
    res.json(payload);
  } catch (err) {
    console.error("[calendar/bootstrap] failed", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to load calendar bootstrap" });
  }
});

apiRouter.get("/calendar/clients/search", requireCalendarView, async (req, res) => {
  try {
    const { searchCalendarClients } = await import("../services/calendarClientSearch.js");
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const id = typeof req.query.id === "string" ? req.query.id : undefined;
    if (!q?.trim() && !id?.trim()) {
      res.status(400).json({ error: "q or id is required" });
      return;
    }
    const clients = await searchCalendarClients({
      organizationId: req.auth!.organizationId,
      query: q,
      clientId: id,
    });
    res.json({ clients });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to search calendar clients",
    });
  }
});

apiRouter.get("/scheduling/briefing", requireCalendarView, async (req, res) => {
  try {
    const organizationId = req.auth!.organizationId;
    const fromParam = typeof req.query.from === "string" ? req.query.from : undefined;
    const toParam = typeof req.query.to === "string" ? req.query.to : undefined;
    const now = new Date();
    const from = fromParam ? parseIsoDateTime(fromParam, "from") : now;
    const to = toParam
      ? parseIsoDateTime(toParam, "to")
      : new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    if (from >= to) {
      res.status(400).json({ error: "from must be before to" });
      return;
    }

    const snapshot = await getBriefingSchedulingSnapshot(organizationId, { from, to, now });
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load scheduling briefing" });
  }
});

/** Timed calendar.view guard — same ACL as requireCalendarView; measures org/membership DB only. */
async function requireCalendarViewWithTiming(req: Request, res: Response, next: () => void) {
  if (!req.auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const orgT0 = performance.now();
  res.locals.appointmentsOrgStart = orgT0;
  const sourceRoute = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`;
  const result = await checkPermission({
    userId: req.auth.userId,
    organizationId: req.auth.organizationId,
    permission: "calendar.view",
    sourceModule: "rbac",
    sourceRoute,
    verifiedTenant: req.verifiedTenant ?? null,
  });
  const orgEnd = performance.now();
  res.locals.appointmentsOrgEnd = orgEnd;
  res.locals.appointmentsOrgMs = Math.round(orgEnd - orgT0);
  res.locals.appointmentsOrgRoleSource = result.roleSource ?? "none";
  if (!result.allowed) {
    res.status(403).json(forbiddenResponseBody(result));
    return;
  }
  next();
}

function roundMs(start: number, end: number): number {
  return Math.max(0, Math.round(end - start));
}

apiRouter.get("/appointments", requireCalendarViewWithTiming, async (req, res) => {
  const wallStart = res.locals.appointmentsWallStart ?? performance.now();
  const authStart = res.locals.appointmentsAuthStart ?? wallStart;
  const authEnd = res.locals.appointmentsAuthEnd ?? authStart;
  const tenantStart = res.locals.appointmentsTenantStart ?? authEnd;
  const tenantEnd = res.locals.appointmentsTenantEnd ?? tenantStart;
  const orgStart = res.locals.appointmentsOrgStart ?? tenantEnd;
  const orgEnd = res.locals.appointmentsOrgEnd ?? orgStart;
  const authMs = res.locals.appointmentsAuthMs ?? roundMs(authStart, authEnd);
  const tenantMs = res.locals.appointmentsTenantMs ?? roundMs(tenantStart, tenantEnd);
  const orgMs = res.locals.appointmentsOrgMs ?? roundMs(orgStart, orgEnd);
  const handlerEnter = performance.now();

  // Non-blocking event-loop probe (does not await / does not inflate request).
  let eventLoopMs: number | null = null;
  {
    const t0 = performance.now();
    setImmediate(() => {
      eventLoopMs = Math.round(performance.now() - t0);
    });
  }

  try {
    const organizationId = req.auth!.organizationId;
    const fromParam = typeof req.query.from === "string" ? req.query.from : undefined;
    const toParam = typeof req.query.to === "string" ? req.query.to : undefined;
    const employeeParam = typeof req.query.employeeId === "string" ? req.query.employeeId.trim() : "";

    const finish = (args: {
      payload: unknown;
      dbMs: number;
      dbToMapMs: number;
      mapMs: number;
      orgToDbMs: number;
      prismaCallCount: number;
      eventsDbRoundTrips: number;
      rowCount: number;
    }) => {
      const jsonT0 = performance.now();
      const body = JSON.stringify(args.payload);
      const jsonMs = Math.round(performance.now() - jsonT0);

      const timingBase: Omit<AppointmentsEndpointTiming, "unaccountedMs" | "responseMs" | "totalMs" | "jsonMs"> = {
        preRouteMs: roundMs(wallStart, authStart),
        authMs,
        authToOrgMs: roundMs(authEnd, orgStart),
        tenantMs,
        orgMs,
        orgToDbMs: args.orgToDbMs,
        dbMs: args.dbMs,
        dbToMapMs: args.dbToMapMs,
        mapMs: args.mapMs,
        middlewareMs: roundMs(authEnd, orgStart),
        eventLoopMs,
        rowCount: args.rowCount,
        prismaCallCount: args.prismaCallCount,
        authDbRoundTrips: 0,
        tenantDbRoundTrips: res.locals.appointmentsTenantCacheSource === "hit" ? 0 : 2,
        tenantDbMs: res.locals.appointmentsTenantDbMs ?? (res.locals.appointmentsTenantCacheSource === "hit" ? 0 : tenantMs),
        orgDbRoundTrips: res.locals.appointmentsOrgRoleSource === "verified_tenant" ? 0 : 2,
        eventsDbRoundTrips: args.eventsDbRoundTrips,
      };

      const responseT0 = performance.now();
      // Measure send synchronously up to write; Network/CDN after this is outside Server-Timing.
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const responseMs = Math.round(performance.now() - responseT0);
      const totalMs = Math.round(performance.now() - wallStart);
      const timing: AppointmentsEndpointTiming = {
        ...timingBase,
        jsonMs,
        responseMs,
        totalMs,
        unaccountedMs: 0,
      };
      timing.unaccountedMs = computeUnaccountedMs(timing);
      res.setHeader("Server-Timing", buildAppointmentsServerTiming(timing));
      res.send(body);

      logAppointmentsEndpointTimingSafe(timing, {
        renderRegionConfigured: "oregon",
        neonRegion: safeDatabaseTopology().neonRegion,
        pooledHost: safeDatabaseTopology().pooledHost,
        hostSuffix: safeDatabaseTopology().hostSuffix,
        prismaSingleton: prismaSingletonActive(prisma, (globalThis as { prisma?: unknown }).prisma),
        pathIsRangedNewEndpoint: Boolean(fromParam && toParam),
        handlerEnterSkewMs: roundMs(orgEnd, handlerEnter),
        endpointPath: "GET /api/appointments",
        orgRoleSource: res.locals.appointmentsOrgRoleSource ?? "none",
        tenantCacheSource: res.locals.appointmentsTenantCacheSource ?? "unknown",
        tenantCacheAgeMs: res.locals.appointmentsTenantCacheAgeMs ?? null,
        dbWaves:
          (res.locals.appointmentsTenantCacheSource === "hit" ? 0 : 2) +
          (res.locals.appointmentsOrgRoleSource === "verified_tenant" ? 0 : 1) +
          args.eventsDbRoundTrips,
      });
    };

    // Calendar First Paint path: bounded range + single Prisma round-trip (no N+1 enrichment wave).
    if (fromParam || toParam) {
      if (!fromParam || !toParam) {
        res.status(400).json({ error: "Both from and to query parameters are required" });
        return;
      }
      const from = parseIsoDateTime(fromParam, "from");
      const to = parseIsoDateTime(toParam, "to");
      if (from >= to) {
        res.status(400).json({ error: "from must be before to" });
        return;
      }

      const beforeDb = performance.now();
      const orgToDbMs = roundMs(orgEnd, beforeDb);
      let dbMs = 0;
      let mapMs = 0;
      let dbToMapMs = 0;
      let rowCount = 0;
      const items = await listCalendarAppointmentsRange(organizationId, from, to, {
        employeeId: employeeParam,
        collectTiming: true,
        onTiming: (t) => {
          dbMs = t.dbQueryMs;
          mapMs = t.mapMs;
          // service serialize is diagnostic only; handler jsonMs is the real response JSON.
          rowCount = t.rowCount;
          dbToMapMs = 0;
        },
      });
      finish({
        payload: items,
        dbMs,
        dbToMapMs,
        mapMs,
        orgToDbMs,
        prismaCallCount: 1,
        eventsDbRoundTrips: 1,
        rowCount,
      });
      return;
    }

    // Legacy unbounded-future list (non-calendar callers): keep previous behavior.
    const startTimeFilter: Prisma.DateTimeFilter = { gte: new Date() };
    const employeeFilter: Prisma.AppointmentWhereInput =
      !employeeParam || employeeParam === "all"
        ? {}
        : employeeParam === "owner"
          ? { employeeId: null }
          : { employeeId: employeeParam };

    const beforeDb = performance.now();
    const orgToDbMs = roundMs(orgEnd, beforeDb);
    const dbT0 = performance.now();
    const appointments = await prisma.appointment.findMany({
      where: { organizationId, startTime: startTimeFilter, ...employeeFilter },
      include: APPOINTMENT_INCLUDE,
      orderBy: { startTime: "asc" },
      take: 500,
    });
    const appointmentIds = appointments.map((item) => item.id);
    const [projections, nextJobs] = await Promise.all([
      prisma.appointmentAttendanceProjection.findMany({
        where: { appointmentId: { in: appointmentIds } },
      }),
      prisma.appointmentReminderJob.findMany({
        where: {
          appointmentId: { in: appointmentIds },
          status: { in: ["pending", "failed", "leased"] },
        },
        orderBy: { scheduledForUtc: "asc" },
      }),
    ]);
    const dbMs = Math.round(performance.now() - dbT0);
    const mapT0 = performance.now();
    const dbToMapMs = 0;
    const projectionByAppointment = new Map(projections.map((item) => [item.appointmentId, item]));
    const nextByAppointment = new Map<string, Date>();
    for (const job of nextJobs) {
      if (!nextByAppointment.has(job.appointmentId)) {
        nextByAppointment.set(job.appointmentId, job.scheduledForUtc);
      }
    }
    const payload = appointments.map((item) => ({
      ...item,
      reminderStatus: projectionByAppointment.get(item.id)
        ? {
            attendanceState: projectionByAppointment.get(item.id)!.attendanceState,
            reminderState: projectionByAppointment.get(item.id)!.reminderState,
            confirmationStatus: projectionByAppointment.get(item.id)!.confirmationStatus,
            lastReminderSentAt: projectionByAppointment.get(item.id)!.lastReminderSentAt,
            lastResponseAt: projectionByAppointment.get(item.id)!.lastResponseAt,
            nextReminderAt: nextByAppointment.get(item.id) ?? null,
          }
        : null,
    }));
    const mapMs = Math.round(performance.now() - mapT0);
    finish({
      payload,
      dbMs,
      dbToMapMs,
      mapMs,
      orgToDbMs,
      prismaCallCount: 3,
      eventsDbRoundTrips: 3,
      rowCount: payload.length,
    });
  } catch (err) {
    if (err instanceof Error && (err.message.includes("from") || err.message.includes("to"))) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load appointments" });
  }
});

apiRouter.post("/appointments", requireCalendarCreate, async (req, res) => {
  try {
    const organizationId = req.auth!.organizationId;
    const body = req.body as {
      clientId?: string;
      serviceId?: string | null;
      employeeId?: string | null;
      startTime?: string;
      durationMinutes?: number;
      notes?: string | null;
      status?: string;
    };
    const clientId = body.clientId?.trim();
    if (!clientId) {
      res.status(400).json({ error: "clientId is required" });
      return;
    }
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId, isActive: true },
    });
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    const startTime = parseWallClockAwareDateTime(
      body.startTime,
      "startTime",
      await loadOrganizationTimezone(organizationId)
    );
    if (startTime.getTime() < Date.now()) {
      res.status(400).json({ error: "startTime must be in the present or future" });
      return;
    }

    let durationMinutes = Number.isFinite(body.durationMinutes) ? Number(body.durationMinutes) : undefined;
    let serviceId: string | null = body.serviceId?.trim() || null;

    if (serviceId) {
      const service = await prisma.service.findFirst({
        where: { id: serviceId, organizationId, isActive: true },
      });
      if (!service) {
        res.status(404).json({ error: "Service not found" });
        return;
      }
      if (durationMinutes === undefined) {
        durationMinutes = service.durationMinutes;
      }
    }

    if (durationMinutes === undefined) {
      durationMinutes = 30;
    }
    if (durationMinutes <= 0) {
      res.status(400).json({ error: "durationMinutes must be a positive number" });
      return;
    }

    const status = body.status?.trim() || "pending";
    if (!APPOINTMENT_STATUSES.has(status)) {
      res.status(400).json({ error: "Invalid appointment status" });
      return;
    }

    // Calendar Phase 1: תור עם עובד נבדק מול היומן של אותו עובד בלבד
    // (שעות עבודה, חופשות, כפילות). תור בלי עובד = מסלול בעל העסק הקיים.
    const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() || null : null;

    if (employeeId) {
      const { validateEmployeeBooking } = await import("../services/employees/employeeService.js");
      const employeeCheck = await validateEmployeeBooking({
        organizationId,
        employeeId,
        serviceId,
        startTime,
        durationMinutes,
        timeZone: await loadOrganizationTimezone(organizationId),
      });
      if (!employeeCheck.ok) {
        if (employeeCheck.code === "employee_not_found") {
          res.status(404).json({ error: employeeCheck.message, code: employeeCheck.code });
          return;
        }
        res
          .status(employeeCheck.code === "time_conflict" ? 409 : 400)
          .json({ error: employeeCheck.message, code: employeeCheck.code });
        return;
      }
    } else if (status !== "cancelled") {
      const availability = await checkUnifiedSlotAvailability({
        organizationId,
        userId: req.auth!.userId,
        startTime,
        durationMinutes,
        serviceId,
      });
      if (!availability.available) {
        if (availability.reason === "time_conflict") {
          res.status(409).json({ error: "השעה הזו כבר תפוסה, אפשר לבחור זמן אחר", code: "time_conflict" });
          return;
        }
        if (availability.reason === "outside_working_hours") {
          res.status(400).json({ error: "השעה מחוץ לשעות הפעילות", code: "outside_working_hours" });
          return;
        }
      }
    }

    const response = await handleIdempotentRequest({
      req,
      routeKey: "POST:/appointments",
      organizationId,
      body: body as Record<string, unknown>,
      execute: async () => {
        const appointment = await createAppointmentForOrganization({
          organizationId,
          userId: req.auth!.userId,
          clientId,
          serviceId,
          employeeId,
          startTime,
          durationMinutes,
          status,
          notes: body.notes?.trim() || null,
          source: "manual",
        });
        recordCalendarAudit({
          organizationId,
          entityType: "appointment",
          entityId: appointment.id,
          action: "appointment_created",
          actor: { actorType: "user", actorUserId: req.auth?.userId ?? null },
          sourceModule: "appointments",
          sourceRoute: "POST /appointments",
          metadata: {
            appointmentId: appointment.id,
            serviceId: appointment.serviceId,
            customerName: appointment.client?.name ?? null,
            customerPhone: appointment.client?.whatsappNumber ?? null,
            source: appointment.source,
            routeKey: "POST:/appointments",
            idempotencyKey:
              typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : null,
            googleEventId: appointment.googleEventId,
            googleSyncStatus: (appointment as { googleSyncStatus?: string }).googleSyncStatus ?? null,
            durationMinutes: appointment.durationMinutes,
            newStartTime: appointment.startTime.toISOString(),
          },
        });
        await ensureAppointmentReminderArtifacts(appointment.id);
        await syncAppointmentAttendanceFromStatus({
          organizationId,
          appointmentId: appointment.id,
          appointmentStatus: appointment.status,
        });
        return { statusCode: 201, body: appointment };
      },
    });
    res.status(response.statusCode).json(response.body);
  } catch (err) {
    if (err instanceof AppointmentConflictError) {
      res.status(409).json({
        error: err.message,
        code: "time_conflict",
      });
      return;
    }
    if (err instanceof Error && err.message.includes("startTime")) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof Error && err.message.includes("outside working hours")) {
      res.status(400).json({ error: err.message, code: "outside_working_hours" });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create appointment" });
  }
});

apiRouter.patch("/appointments/:id", requireCalendarReschedule, async (req, res) => {
  try {
    const organizationId = req.auth!.organizationId;
    const body = req.body as {
      startTime?: string;
      durationMinutes?: number;
      status?: string;
      notes?: string | null;
      serviceId?: string | null;
      employeeId?: string | null;
    };

    let startTime: Date | undefined;
    if (body.startTime !== undefined) {
      startTime = parseWallClockAwareDateTime(
        body.startTime,
        "startTime",
        await loadOrganizationTimezone(organizationId)
      );
    }

    let durationMinutes: number | undefined;
    if (body.durationMinutes !== undefined) {
      if (!Number.isFinite(body.durationMinutes) || body.durationMinutes <= 0) {
        res.status(400).json({ error: "durationMinutes must be a positive number" });
        return;
      }
      durationMinutes = body.durationMinutes;
    }

    let status: string | undefined;
    if (body.status !== undefined) {
      if (!APPOINTMENT_STATUSES.has(body.status)) {
        res.status(400).json({ error: "Invalid appointment status" });
        return;
      }
      status = body.status;
    }

    let notes: string | null | undefined;
    if (body.notes !== undefined) {
      notes = body.notes?.trim() || null;
    }

    let serviceId: string | null | undefined;
    if (body.serviceId !== undefined) {
      const parsedServiceId = body.serviceId?.trim() || null;
      if (parsedServiceId) {
        const service = await prisma.service.findFirst({
          where: { id: parsedServiceId, organizationId, isActive: true },
        });
        if (!service) {
          res.status(404).json({ error: "Service not found" });
          return;
        }
        serviceId = parsedServiceId;
      } else {
        serviceId = null;
      }
    }

    // Calendar Phase 1: שינוי עובד/זמן על תור של עובד נבדק מול היומן של
    // העובד היעד; תורים בלי עובד ממשיכים במסלול הקיים ללא שינוי.
    let employeeId: string | null | undefined;
    if (body.employeeId !== undefined) {
      employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() || null : null;
    }

    const existingForEmployeeCheck = await prisma.appointment.findFirst({
      where: { id: routeId(req), organizationId },
      select: { id: true, employeeId: true, startTime: true, durationMinutes: true, serviceId: true, status: true },
    });
    if (!existingForEmployeeCheck) {
      res.status(404).json({ error: "Appointment not found" });
      return;
    }
    const targetEmployeeId = employeeId !== undefined ? employeeId : existingForEmployeeCheck.employeeId;
    const effectiveStatusForCheck = status ?? existingForEmployeeCheck.status;
    const timeOrEmployeeChanged =
      startTime !== undefined || durationMinutes !== undefined || employeeId !== undefined;

    if (targetEmployeeId && effectiveStatusForCheck !== "cancelled" && timeOrEmployeeChanged) {
      const { validateEmployeeBooking } = await import("../services/employees/employeeService.js");
      const employeeCheck = await validateEmployeeBooking({
        organizationId,
        employeeId: targetEmployeeId,
        serviceId: serviceId !== undefined ? serviceId : existingForEmployeeCheck.serviceId,
        startTime: startTime ?? existingForEmployeeCheck.startTime,
        durationMinutes: durationMinutes ?? existingForEmployeeCheck.durationMinutes,
        timeZone: await loadOrganizationTimezone(organizationId),
        excludeAppointmentId: routeId(req),
      });
      if (!employeeCheck.ok) {
        if (employeeCheck.code === "employee_not_found") {
          res.status(404).json({ error: employeeCheck.message, code: employeeCheck.code });
          return;
        }
        res
          .status(employeeCheck.code === "time_conflict" ? 409 : 400)
          .json({ error: employeeCheck.message, code: employeeCheck.code });
        return;
      }
    }

    const shouldCheckAvailability =
      !targetEmployeeId &&
      status !== "cancelled" &&
      (startTime !== undefined || durationMinutes !== undefined);
    if (shouldCheckAvailability) {
      const availability = await checkUnifiedSlotAvailability({
        organizationId,
        userId: req.auth!.userId,
        startTime,
        durationMinutes,
        serviceId,
        excludeAppointmentId: routeId(req),
      });
      if (!availability.available) {
        if (availability.reason === "time_conflict") {
          res.status(409).json({ error: "השעה הזו כבר תפוסה, אפשר לבחור זמן אחר", code: "time_conflict" });
          return;
        }
        if (availability.reason === "outside_working_hours") {
          res.status(400).json({ error: "השעה מחוץ לשעות הפעילות", code: "outside_working_hours" });
          return;
        }
      }
    }

    const response = await handleIdempotentRequest({
      req,
      routeKey: "PATCH:/appointments/:id",
      organizationId,
      body: { appointmentId: routeId(req), startTime: body.startTime, durationMinutes, status, notes, serviceId, employeeId },
      execute: async () => {
        const before = await prisma.appointment.findFirst({
          where: { id: routeId(req), organizationId },
          select: { id: true, startTime: true, status: true },
        });
        const appointment = await updateAppointmentForOrganization({
          organizationId,
          userId: req.auth!.userId,
          appointmentId: routeId(req),
          startTime,
          durationMinutes,
          status,
          notes,
          serviceId,
          employeeId,
        });
        const becameCancelled = before?.status !== "cancelled" && appointment.status === "cancelled";
        const rescheduled = before && before.startTime.getTime() !== appointment.startTime.getTime();
        const action = becameCancelled
          ? "appointment_cancelled"
          : rescheduled
            ? "appointment_rescheduled"
            : "appointment_updated";
        recordCalendarAudit({
          organizationId,
          entityType: "appointment",
          entityId: appointment.id,
          action,
          actor: { actorType: "user", actorUserId: req.auth?.userId ?? null },
          sourceModule: "appointments",
          sourceRoute: "PATCH /appointments/:id",
          metadata: {
            appointmentId: appointment.id,
            serviceId: appointment.serviceId,
            customerName: appointment.client?.name ?? null,
            customerPhone: appointment.client?.whatsappNumber ?? null,
            source: appointment.source,
            routeKey: "PATCH:/appointments/:id",
            idempotencyKey:
              typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : null,
            googleEventId: appointment.googleEventId,
            googleSyncStatus: (appointment as { googleSyncStatus?: string }).googleSyncStatus ?? null,
            previousStartTime: before?.startTime?.toISOString() ?? null,
            newStartTime: appointment.startTime.toISOString(),
            durationMinutes: appointment.durationMinutes,
          },
        });
        await ensureAppointmentReminderArtifacts(appointment.id);
        await syncAppointmentAttendanceFromStatus({
          organizationId,
          appointmentId: appointment.id,
          appointmentStatus: appointment.status,
        });
        return { statusCode: 200, body: appointment };
      },
    });
    res.status(response.statusCode).json(response.body);
  } catch (err) {
    if (err instanceof AppointmentConflictError) {
      res.status(409).json({
        error: err.message,
        code: "time_conflict",
      });
      return;
    }
    if (err instanceof Error && err.message === "Appointment not found") {
      res.status(404).json({ error: "Appointment not found" });
      return;
    }
    if (err instanceof Error && err.message.includes("startTime")) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof Error && err.message.includes("outside working hours")) {
      res.status(400).json({ error: err.message, code: "outside_working_hours" });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update appointment" });
  }
});

apiRouter.delete("/appointments/:id", requireCalendarCancel, async (req, res) => {
  try {
    const organizationId = req.auth!.organizationId;
    const appointmentId = routeId(req);
    recordCalendarAudit({
      organizationId,
      entityType: "appointment",
      entityId: appointmentId,
      action: "appointment_delete_requested",
      actor: { actorType: "user", actorUserId: req.auth?.userId ?? null },
      sourceModule: "appointments",
      sourceRoute: "DELETE /appointments/:id",
      metadata: {
        appointmentId,
        routeKey: "DELETE:/appointments/:id",
        idempotencyKey:
          typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : null,
      },
    });
    const response = await handleIdempotentRequest({
      req,
      routeKey: "DELETE:/appointments/:id",
      organizationId,
      body: { appointmentId },
      execute: async () => {
        const result = await deleteAppointmentForOrganization(organizationId, appointmentId, req.auth!.userId);
        await syncAppointmentAttendanceFromStatus({
          organizationId,
          appointmentId,
          appointmentStatus: "cancelled",
        }).catch(() => undefined);
        recordCalendarAudit({
          organizationId,
          entityType: "appointment",
          entityId: appointmentId,
          action: "appointment_delete_completed",
          actor: { actorType: "user", actorUserId: req.auth?.userId ?? null },
          sourceModule: "appointments",
          sourceRoute: "DELETE /appointments/:id",
          metadata: { appointmentId, routeKey: "DELETE:/appointments/:id" },
        });
        return { statusCode: 200, body: result };
      },
    });
    res.status(response.statusCode).json(response.body);
  } catch (err) {
    if (err instanceof Error && err.message === "Appointment not found") {
      res.status(404).json({ error: "Appointment not found" });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete appointment" });
  }
});

apiRouter.post("/appointments/:id/google-sync/retry", requireCalendarUpdate, async (req, res) => {
  try {
    const organizationId = req.auth!.organizationId;
    const appointmentId = routeId(req);
    const existing = await prisma.appointment.findFirst({
      where: { id: appointmentId, organizationId },
      select: { id: true },
    });
    if (!existing) {
      const crossOrg = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: { organizationId: true },
      });
      if (crossOrg && crossOrg.organizationId !== organizationId) {
        recordCalendarAudit({
          organizationId,
          entityType: "appointment",
          entityId: appointmentId,
          action: "calendar_cross_org_attempt",
          actor: { actorType: "user", actorUserId: req.auth?.userId ?? null },
          sourceModule: "appointments",
          sourceRoute: "POST /appointments/:id/google-sync/retry",
          reason: "cross organization appointment retry attempt",
          metadata: { appointmentId, routeKey: "POST:/appointments/:id/google-sync/retry" },
        });
      }
      res.status(404).json({ error: "Appointment not found" });
      return;
    }

    const result = await runAppointmentGoogleSync(appointmentId, { reason: "manual_retry" });
    const refreshed = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        organizationId: true,
        googleSyncStatus: true,
        googleSyncAttemptCount: true,
        lastGoogleSyncError: true,
        lastGoogleSyncAt: true,
        nextGoogleSyncRetryAt: true,
        googleEventId: true,
      },
    });
    res.json({
      ok: result.ok,
      appointment: refreshed,
      retryScheduled: Boolean(!result.ok && "nextRetryAt" in result && result.nextRetryAt),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to retry appointment Google sync" });
  }
});

apiRouter.post("/appointments/availability/check", requireCalendarView, async (req, res) => {
  try {
    const organizationId = req.auth!.organizationId;
    const body = req.body as {
      startTime?: string;
      dayReference?: string;
      time?: string;
      durationMinutes?: number;
      serviceId?: string | null;
      excludeAppointmentId?: string;
    };

    let startTime: Date | undefined;
    if (body.startTime !== undefined) {
      startTime = parseIsoDateTime(body.startTime, "startTime");
    }

    const result = await checkUnifiedSlotAvailability({
      organizationId,
      userId: req.auth!.userId,
      startTime,
      dayReference: typeof body.dayReference === "string" ? body.dayReference : undefined,
      time: typeof body.time === "string" ? body.time : undefined,
      durationMinutes:
        body.durationMinutes !== undefined && Number.isFinite(body.durationMinutes)
          ? Number(body.durationMinutes)
          : undefined,
      serviceId: typeof body.serviceId === "string" ? body.serviceId : null,
      excludeAppointmentId:
        typeof body.excludeAppointmentId === "string" ? body.excludeAppointmentId.trim() : undefined,
    });

    if (result.reason === "bad_datetime") {
      res.status(400).json({ error: "Invalid or missing start time", code: "bad_datetime" });
      return;
    }

    res.json(result);
  } catch (err) {
    if (err instanceof Error && err.message.includes("startTime")) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to check availability" });
  }
});

apiRouter.post("/appointments/availability/slots", requireCalendarView, async (req, res) => {
  try {
    const organizationId = req.auth!.organizationId;
    const body = req.body as {
      rangeType?: "day" | "week";
      from?: string;
      to?: string;
      dayReference?: string;
      durationMinutes?: number;
      serviceId?: string | null;
      limit?: number;
      slotStepMinutes?: number;
      excludeAppointmentId?: string;
    };

    let from: Date | undefined;
    let to: Date | undefined;
    if (body.from !== undefined || body.to !== undefined) {
      if (!body.from || !body.to) {
        res.status(400).json({ error: "Both from and to are required when specifying a custom range" });
        return;
      }
      from = parseIsoDateTime(body.from, "from");
      to = parseIsoDateTime(body.to, "to");
      if (from >= to) {
        res.status(400).json({ error: "from must be before to" });
        return;
      }
    }

    const rangeType = body.rangeType === "week" ? "week" : body.rangeType === "day" ? "day" : undefined;

    const result = await findUnifiedAvailableSlots({
      organizationId,
      rangeType,
      from,
      to,
      dayReference: typeof body.dayReference === "string" ? body.dayReference : undefined,
      durationMinutes:
        body.durationMinutes !== undefined && Number.isFinite(body.durationMinutes)
          ? Number(body.durationMinutes)
          : undefined,
      serviceId: typeof body.serviceId === "string" ? body.serviceId : null,
      limit: body.limit !== undefined && Number.isFinite(body.limit) ? Number(body.limit) : undefined,
      slotStepMinutes:
        body.slotStepMinutes !== undefined && Number.isFinite(body.slotStepMinutes)
          ? Number(body.slotStepMinutes)
          : undefined,
      excludeAppointmentId:
        typeof body.excludeAppointmentId === "string" ? body.excludeAppointmentId.trim() : undefined,
    });

    res.json(result);
  } catch (err) {
    if (err instanceof Error && (err.message.includes("from") || err.message.includes("to"))) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to find available slots" });
  }
});

apiRouter.get("/document-reviews", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "needs_review";
  const view = typeof req.query.view === "string" ? req.query.view : "full";
  const organizationId = req.auth!.organizationId;

  // Home Background only: count + top 5 slim rows. Full list path below is unchanged.
  if (view === "summary") {
    try {
      const payload = await getDocumentReviewsHomeSummary({ organizationId, status });
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "document-reviews summary failed" });
    }
    return;
  }

  const items = await prisma.financialDocumentReview.findMany({
    where: mergePrismaWhere(
      {
        organizationId,
        ...(status === "all" ? {} : { reviewStatus: status }),
      },
      buildFinancialDocumentReviewReadIsolationWhere(
        organizationId,
        await loadCrossOrgContaminatedGmailIdsForReads(),
      ),
    ),
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  // אובייקט החלטה יחיד מהשרת (decision) — מקור האמת הבלעדי של ה-UI לזמינות
  // אישור, שם ספק לתצוגה, וסיבת חסימה (כולל פרטי הכפיל שנמצא).
  const mapped = await Promise.all(
    items.map(async (item) => {
      const base = mapDocumentReviewForApi(item);
      try {
        const decision = await buildReviewDecision(item);
        return {
          ...base,
          decision,
          // שדות שטוחים לתאימות לאחור בזמן ה-deploy בלבד; ה-UI קורא רק את decision
          canApprove: decision.canApprove,
          blockReason: decision.blockReason,
          recommendedAction: decision.primaryAction === "blocked_duplicate" ? "complete_details" : decision.primaryAction,
          supplierNeedsConfirmation: decision.supplierNeedsConfirmation,
        };
      } catch (err) {
        console.warn(
          `[document-reviews] decision evaluation failed reviewId=${item.id} reason=${err instanceof Error ? err.message : String(err)}`
        );
        // fail-closed: בלי הערכה אין אישור בקליק אחד
        const decision = {
          canApprove: false,
          primaryAction: "complete_details" as const,
          blockReason: "readiness_unavailable",
          displaySupplierName: item.supplierName ?? "",
          confirmedSupplierName: null,
          supplierNeedsConfirmation: false,
          duplicate: null,
        };
        return { ...base, decision, canApprove: false, blockReason: decision.blockReason, recommendedAction: "complete_details" as const };
      }
    })
  );
  res.json(mapped);
});

// endpoint דיבאג: אובייקט ההחלטה המלא + הקלטים שלו לרשומה אחת — לחקירת פרודקשן
apiRouter.get("/document-reviews/:id/decision", requirePerm("review.approve"), async (req, res) => {
  const review = await prisma.financialDocumentReview.findFirst({
    where: { id: routeId(req), organizationId: req.auth!.organizationId },
  });
  if (!review) {
    res.status(404).json({ error: "Document review item not found" });
    return;
  }
  try {
    const decision = await buildReviewDecision(review);
    const payload = {
      reviewId: review.id,
      organizationId: review.organizationId,
      reviewStatus: review.reviewStatus,
      supplierName: review.supplierName,
      totalAmount: review.totalAmount,
      documentType: review.documentType,
      uncertaintyReason: review.uncertaintyReason,
      supplierPaymentId: review.supplierPaymentId,
      decision,
    };
    console.log(`[review-decision] ${JSON.stringify(payload)}`);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "decision evaluation failed" });
  }
});

function mapDocumentReviewForApi<
  T extends {
    totalAmount: number | null;
    amountBeforeVat?: number | null;
    vatAmount?: number | null;
    parsedFieldsJson?: unknown;
    currency?: string;
    organizationId?: string;
    driveFileUrl?: string | null;
    supplierName?: string | null;
    sender?: string | null;
    supplierTaxId?: string | null;
    rawAnalysis?: unknown;
  },
>(item: T) {
  const display = resolveDocumentReviewDisplayAmount({
    totalAmount: item.totalAmount,
    amountBeforeVat: item.amountBeforeVat,
    vatAmount: item.vatAmount,
    parsedFieldsJson: item.parsedFieldsJson,
    currency: item.currency,
  });
  const supplier = resolveReviewSupplierContext({
    supplierName: item.supplierName,
    sender: item.sender,
    supplierTaxId: item.supplierTaxId,
    parsedFieldsJson: item.parsedFieldsJson,
    rawAnalysis: item.rawAnalysis,
  });
  return {
    ...item,
    // נתיב /uploads מקומי יוצא רק כ-URL חתום וקשור-ארגון; קישורי Drive לא משתנים
    driveFileUrl: signLocalUploadUrlIfNeeded(item.driveFileUrl ?? null, item.organizationId ?? null),
    displayAmount: display.amount,
    amountLabel: display.amountLabel,
    amountResolved: display.resolved,
    supplierDisplayName: supplier.displaySupplierName,
    rawSupplierName: supplier.rawSupplierName,
    supplierConfidence: supplier.supplierConfidence,
    supplierNeedsConfirmation: supplier.supplierNeedsConfirmation,
    supplierUncertain: supplier.supplierUncertain,
    confirmedSupplierName: supplier.confirmedSupplierName,
  };
}

apiRouter.post("/document-reviews/:id/approve", requirePerm("review.approve"), async (req, res) => {
  try {
    const confirmedSupplierName =
      typeof req.body?.supplierName === "string" ? req.body.supplierName.trim() : undefined;
    const result = await approveFinancialDocumentReview(req.auth!.organizationId, routeId(req), {
      userId: req.auth!.userId,
      sourceRoute: "POST /document-reviews/:id/approve",
      confirmedSupplierName,
    });
    res.json({
      success: true,
      reviewId: result.review.id,
      supplierPaymentId: result.paymentId,
      status: result.review.reviewStatus,
      ok: true,
      item: mapDocumentReviewForApi(result.review),
      paymentId: result.paymentId,
      targetScreen: result.targetScreen,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Document review approval failed";
    const notFound = message === "Document review item not found";
    res.status(notFound ? 404 : 422).json({ error: message });
  }
});

apiRouter.delete("/document-reviews/:id", requirePerm("review.reject"), async (req, res) => {
  const result = await deleteInvoiceArtifacts(req.auth!.organizationId, { documentReviewId: routeId(req) });
  if (!result.found) {
    res.status(404).json({ error: "Document review item not found" });
    return;
  }
  res.json({ ok: true, deleted: result.deleted, verification: result.verification, unlinked: result.unlinked });
});

apiRouter.delete("/gmail-scan-items/:id", requirePerm("review.reject"), async (req, res) => {
  const result = await deleteInvoiceArtifacts(req.auth!.organizationId, { gmailScanItemId: routeId(req) });
  if (!result.found) {
    res.status(404).json({ error: "Gmail scan item not found" });
    return;
  }
  res.json({ ok: true, deleted: result.deleted, verification: result.verification, unlinked: result.unlinked });
});

apiRouter.post("/gmail-scan-items/:id/approve", requirePerm("review.approve"), async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const item = await prisma.gmailScanItem.findFirst({
    where: { id: routeId(req), organizationId },
  });
  if (!item) {
    res.status(404).json({ error: "Gmail scan item not found" });
    return;
  }
  if (item.reviewStatus === "rejected") {
    res.status(409).json({ error: "Cannot approve a rejected scan item" });
    return;
  }

  const review = await prisma.financialDocumentReview.findFirst({
    where: {
      organizationId,
      OR: [
        { gmailMessageId: item.gmailMessageId },
        { documentFingerprint: item.duplicateKey },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!review) {
    res.status(409).json({
      error: "No financial document review is linked to this scan item. Approve via document review queue.",
      code: "GSI_APPROVE_REQUIRES_REVIEW",
    });
    return;
  }

  try {
    const result = await approveFinancialDocumentReview(organizationId, review.id, {
      userId: req.auth!.userId,
      sourceRoute: "POST /api/gmail-scan-items/:id/approve",
    });
    const updated = await prisma.gmailScanItem.update({
      where: { id: item.id },
      data: { reviewStatus: result.review.reviewStatus === "approved" ? "approved" : item.reviewStatus },
    });
    res.json({
      ok: true,
      item: updated,
      review: result.review,
      paymentId: result.paymentId,
      targetScreen: result.targetScreen,
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to approve linked document review",
    });
  }
});

apiRouter.patch("/payments/:id", requirePerm("payment.update"), async (req, res) => {
  const { paid, invoiceLink, documentLink, receiptLink } = req.body as {
    paid?: boolean;
    invoiceLink?: string;
    documentLink?: string;
    receiptLink?: string;
  };
  const existingPayment = await prisma.supplierPayment.findFirst({
    where: { id: routeId(req), organizationId: req.auth!.organizationId },
  });
  if (!existingPayment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }
  const updatedPayment = await prisma.supplierPayment.update({
    where: { id: existingPayment.id },
    data: {
      ...(paid !== undefined && { paid, ...(paid && { missingInvoice: false }) }),
      ...(invoiceLink !== undefined && { invoiceLink, missingInvoice: false }),
      ...(documentLink !== undefined && { documentLink }),
      ...(receiptLink !== undefined && { documentLink: receiptLink }),
    },
  });
  recordPlatformAudit({
    ...userAuditContext(
      req.auth!.userId,
      "api",
      "PATCH /payments/:id",
      resolveWorkflowCorrelationId({ emailMessageId: existingPayment.emailMessageId }),
    ),
    organizationId: req.auth!.organizationId,
    entityType: "supplier_payment",
    entityId: updatedPayment.id,
    action: "payment_updated",
    beforeState: paymentAuditSnapshot(existingPayment),
    afterState: paymentAuditSnapshot(updatedPayment),
  });
  if ((invoiceLink !== undefined || paid === true) && existingPayment.emailMessageId) {
    await prisma.task.updateMany({
      where: {
        organizationId: req.auth!.organizationId,
        emailMessageId: existingPayment.emailMessageId,
        title: { startsWith: "MissingInvoice:" },
        status: "open",
      },
      data: { status: "completed" },
    });
  }
  try {
    const { appendSupplierPaymentToSheet } = await import("../services/supplierPaymentsSheet.js");
    const email = existingPayment.emailMessageId
      ? await prisma.emailMessage.findFirst({
          where: { id: existingPayment.emailMessageId, organizationId: req.auth!.organizationId },
          select: { gmailId: true },
        })
      : null;
    await appendSupplierPaymentToSheet({
      organizationId: req.auth!.organizationId,
      paymentId: updatedPayment.id,
      supplier: updatedPayment.supplier,
      amount: updatedPayment.amount,
      date: updatedPayment.date,
      dueDate: updatedPayment.dueDate,
      paid: updatedPayment.paid,
      missingInvoice: updatedPayment.missingInvoice,
      documentLink: updatedPayment.documentLink,
      invoiceLink: updatedPayment.invoiceLink,
      gmailLink: email?.gmailId ? `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(email.gmailId)}` : null,
      source: updatedPayment.source,
      duplicateDetected: updatedPayment.duplicateDetected,
      duplicateReason: updatedPayment.duplicateReason,
      paidDate: paid === true ? new Date() : null,
      receiptLink: receiptLink ?? updatedPayment.documentLink ?? updatedPayment.invoiceLink,
      createdAt: updatedPayment.createdAt,
      updatedAt: updatedPayment.updatedAt,
    });
  } catch (err) {
    console.error("[payments] failed to sync payment to sheet", err);
  }
  res.json({ updated: 1, payment: updatedPayment });
});

async function deleteSupplierPaymentHandler(req: Request, res: Response) {
  const paymentId = routeId(req);
  const beforeCount = await prisma.supplierPayment.count({
    where: { id: paymentId, organizationId: req.auth!.organizationId },
  });
  const payment = await prisma.supplierPayment.findFirst({
    where: { id: paymentId, organizationId: req.auth!.organizationId },
    select: {
      id: true,
      supplier: true,
      amount: true,
      currency: true,
      paid: true,
      approvalStatus: true,
      emailMessageId: true,
      documentFingerprint: true,
    },
  });
  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  const [bankMatches, reviews, tasks, deleted] = await prisma.$transaction([
    prisma.bankTransaction.updateMany({
      where: { organizationId: req.auth!.organizationId, matchedSupplierPaymentId: payment.id },
      data: { matchedSupplierPaymentId: null, matchStatus: "unmatched", matchConfidence: null },
    }),
    prisma.financialDocumentReview.deleteMany({
      where: { organizationId: req.auth!.organizationId, supplierPaymentId: payment.id },
    }),
    prisma.task.updateMany({
      where: {
        organizationId: req.auth!.organizationId,
        emailMessageId: payment.emailMessageId ?? "__none__",
        title: { startsWith: "MissingInvoice:" },
      },
      data: { status: "completed" },
    }),
    prisma.supplierPayment.deleteMany({
      where: { id: payment.id, organizationId: req.auth!.organizationId },
    }),
  ]);
  const afterCount = await prisma.supplierPayment.count({
    where: { id: paymentId, organizationId: req.auth!.organizationId },
  });
  console.log(`[payments] delete id=${paymentId} org=${req.auth!.organizationId} before=${beforeCount} deleted=${deleted.count} after=${afterCount}`);

  recordPlatformAudit({
    ...userAuditContext(
      req.auth!.userId,
      "api",
      "DELETE /payments/:id",
      resolveWorkflowCorrelationId({ emailMessageId: payment.emailMessageId }),
    ),
    organizationId: req.auth!.organizationId,
    entityType: "supplier_payment",
    entityId: payment.id,
    action: "payment_deleted",
    beforeState: paymentAuditSnapshot(payment),
    afterState: null,
  });

  res.json({
    ok: true,
    deleted: {
      supplierPayments: deleted.count,
      documentReviews: reviews.count,
    },
    verification: { beforeCount, afterCount },
    unlinked: {
      bankTransactions: bankMatches.count,
      tasks: tasks.count,
    },
  });
}

apiRouter.post("/payments/:id/delete", requirePerm("payment.delete"), deleteSupplierPaymentHandler);
apiRouter.delete("/payments/:id", requirePerm("payment.delete"), deleteSupplierPaymentHandler);

apiRouter.get("/tasks", async (req, res) => {
  try {
    const tasks = await prisma.task.findMany({
      where: { organizationId: req.auth!.organizationId },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    res.json(tasks);
  } catch (err) {
    console.error("[tasks] list failed", err);
    res.status(500).json({ error: "Failed to load tasks" });
  }
});

apiRouter.patch("/tasks/:id", async (req, res) => {
  try {
  const { status } = req.body as { status?: string };
  const updated = await prisma.task.updateMany({
    where: { id: routeId(req), organizationId: req.auth!.organizationId },
    data: { status: status ?? "completed" },
  });
  if (updated.count === 0) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const { safeInvalidateDashboardBootstrap } = await import("../services/dashboardBootstrapCache.js");
  safeInvalidateDashboardBootstrap(req.auth!.userId, req.auth!.organizationId);
  res.json({ ok: true });
  } catch (err) {
    console.error("[tasks] patch failed", err);
    res.status(500).json({ error: "Failed to update task" });
  }
});

apiRouter.put("/tasks/:id", async (req, res) => {
  try {
  const body = req.body as {
    title?: string;
    description?: string | null;
    dueDate?: string | null;
    priority?: string;
    status?: string;
  };
  const title = body.title?.trim();
  if (!title) {
    res.status(400).json({ error: "Task title is required" });
    return;
  }
  const dueDate = body.dueDate ? new Date(body.dueDate) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    res.status(400).json({ error: "Invalid due date" });
    return;
  }
  const updated = await prisma.task.updateMany({
    where: { id: routeId(req), organizationId: req.auth!.organizationId },
    data: {
      title,
      description: body.description?.trim() || null,
      dueDate,
      ...(body.priority && { priority: body.priority }),
      ...(body.status && { status: body.status }),
    },
  });
  if (updated.count === 0) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const { safeInvalidateDashboardBootstrap } = await import("../services/dashboardBootstrapCache.js");
  safeInvalidateDashboardBootstrap(req.auth!.userId, req.auth!.organizationId);
  res.json({ ok: true });
  } catch (err) {
    console.error("[tasks] put failed", err);
    res.status(500).json({ error: "Failed to update task" });
  }
});

apiRouter.delete("/tasks/:id", async (req, res) => {
  try {
  const deleted = await prisma.task.deleteMany({
    where: { id: routeId(req), organizationId: req.auth!.organizationId },
  });
  if (deleted.count === 0) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const { safeInvalidateDashboardBootstrap } = await import("../services/dashboardBootstrapCache.js");
  safeInvalidateDashboardBootstrap(req.auth!.userId, req.auth!.organizationId);
  res.json({ ok: true });
  } catch (err) {
    console.error("[tasks] delete failed", err);
    res.status(500).json({ error: "Failed to delete task" });
  }
});

apiRouter.get("/reports/missing-invoices", async (req, res) => {
  try {
    const { getMissingInvoicesReportFromSheetComparison } = await import("../services/supplierPaymentsSheet.js");
    const report = await getMissingInvoicesReportFromSheetComparison(req.auth!.organizationId);
    res.json(report.map(enrichPaymentSources));
  } catch (err) {
    console.error("[reports/missing-invoices] sheet comparison failed, falling back to database report", err);
    const report = await getMissingInvoicesReport(req.auth!.organizationId);
    res.json(report.map(enrichPaymentSources));
  }
});

apiRouter.get("/alerts", async (req, res) => {
  const alerts = await prisma.alert.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  res.json(alerts);
});

apiRouter.get("/summary/daily", async (req, res) => {
  const text = await buildDailySummary(req.auth!.organizationId);
  res.json({ text });
});

apiRouter.get("/help/progress", async (req, res) => {
  const pageKey = typeof req.query.pageKey === "string" ? req.query.pageKey : null;
  const rows = await prisma.$queryRawUnsafe<Array<{
    pageKey: string;
    itemType: string;
    itemKey: string;
    progress: number;
    completed: boolean;
    metadata: unknown;
    updatedAt: Date;
  }>>(
    `SELECT "pageKey", "itemType", "itemKey", "progress", "completed", "metadata", "updatedAt"
     FROM "HelpProgress"
     WHERE "userId" = $1 AND "organizationId" = $2 ${pageKey ? 'AND "pageKey" = $3' : ""}
     ORDER BY "updatedAt" DESC`,
    ...(pageKey ? [req.auth!.userId, req.auth!.organizationId, pageKey] : [req.auth!.userId, req.auth!.organizationId])
  );
  res.json({
    items: rows.map((row) => ({
      ...row,
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
});

apiRouter.post("/help/progress", async (req, res) => {
  const body = req.body as {
    pageKey?: string;
    itemType?: string;
    itemKey?: string;
    progress?: number;
    completed?: boolean;
    metadata?: Record<string, unknown>;
  };
  const pageKey = body.pageKey?.trim();
  const itemType = body.itemType?.trim();
  const itemKey = body.itemKey?.trim() || "main";
  if (!pageKey || !itemType) {
    res.status(400).json({ error: "pageKey and itemType are required" });
    return;
  }
  const progress = Math.max(0, Math.min(100, Number(body.progress ?? 0)));
  const completed = Boolean(body.completed || progress >= 95);
  const metadata = JSON.stringify(body.metadata ?? {});
  const [row] = await prisma.$queryRawUnsafe<Array<{ id: string; updatedAt: Date }>>(
    `INSERT INTO "HelpProgress"
      ("id","userId","organizationId","pageKey","itemType","itemKey","progress","completed","metadata","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     ON CONFLICT ("userId","pageKey","itemType","itemKey")
     DO UPDATE SET "progress" = EXCLUDED."progress",
       "completed" = EXCLUDED."completed",
       "metadata" = EXCLUDED."metadata",
       "updatedAt" = CURRENT_TIMESTAMP
     RETURNING "id", "updatedAt"`,
    `help_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    req.auth!.userId,
    req.auth!.organizationId,
    pageKey,
    itemType,
    itemKey,
    progress,
    completed,
    metadata
  );
  res.json({ ok: true, id: row?.id, completed, progress, updatedAt: row?.updatedAt.toISOString() });
});

apiRouter.post("/help/voice", async (req, res) => {
  const body = req.body as { text?: string; speed?: "slow" | "normal" | "fast" };
  const input = body.text?.trim();
  if (!input) {
    res.status(400).json({ error: "Voice text is required" });
    return;
  }
  if (config.aiVoice.provider !== "openai" || !config.aiVoice.openAiApiKey) {
    res.status(503).json({
      error: "AI voice is not configured",
      requiredEnv: ["OPENAI_API_KEY"],
      fallback: "browser_speech",
    });
    return;
  }

  const speed = body.speed === "slow" ? 0.82 : body.speed === "fast" ? 1.12 : 0.95;
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.aiVoice.openAiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.aiVoice.openAiModel,
      voice: config.aiVoice.openAiVoice,
      input: input.slice(0, 3500),
      speed,
      instructions: "Speak Hebrew naturally, clearly and warmly, like a professional onboarding assistant. Use a calm pace and clear pronunciation.",
      response_format: "mp3",
    }),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    res.status(502).json({ error: `AI voice generation failed: ${errorText}` });
    return;
  }
  const audio = Buffer.from(await response.arrayBuffer());
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(audio);
});

async function sendWhatsAppStatus(req: Request, res: Response) {
  res.json(await getWhatsAppSettings(req.auth!.organizationId));
}

async function saveWhatsAppNumber(req: Request, res: Response) {
  const body = req.body as { ownerWhatsApp?: string };
  if (!body.ownerWhatsApp?.trim()) {
    res.status(400).json({ error: "WhatsApp number is required" });
    return;
  }

  await saveWhatsAppSettings(req.auth!.organizationId, body.ownerWhatsApp);
  res.json(await getWhatsAppSettings(req.auth!.organizationId));
}

async function sendWhatsAppTest(req: Request, res: Response) {
  const result = await testWhatsAppConnection(req.auth!.organizationId);
  if (!result.sent) {
    res.status(400).json({ error: result.reason, result });
    return;
  }
  res.json(result);
}

apiRouter.get("/integrations/whatsapp/status", sendWhatsAppStatus);
apiRouter.get("/integrations/whatsapp/health", sendWhatsAppStatus);
apiRouter.put("/integrations/whatsapp/settings", saveWhatsAppNumber);
apiRouter.get("/whatsapp/status", sendWhatsAppStatus);
apiRouter.get("/whatsapp/health", sendWhatsAppStatus);
apiRouter.post("/settings/whatsapp", saveWhatsAppNumber);
apiRouter.post("/whatsapp/test", sendWhatsAppTest);
apiRouter.get("/whatsapp/test", sendWhatsAppTest);
apiRouter.post("/integrations/whatsapp/test", sendWhatsAppTest);
apiRouter.get("/integrations/whatsapp/test", sendWhatsAppTest);
apiRouter.post("/integrations/whatsapp/test-send", sendWhatsAppTest);

apiRouter.get("/whatsapp-assistant/settings", async (req, res) => {
  const { getWhatsAppAssistantSettings } = await import("../services/whatsappAssistant.js");
  res.json(await getWhatsAppAssistantSettings(req.auth!.organizationId));
});

apiRouter.put("/whatsapp-assistant/settings", async (req, res) => {
  const { updateWhatsAppAssistantSettings } = await import("../services/whatsappAssistant.js");
  res.json(await updateWhatsAppAssistantSettings(req.auth!.organizationId, req.body as Record<string, unknown>));
});

apiRouter.get("/whatsapp-assistant/stats", async (req, res) => {
  const { getWhatsAppAssistantStats } = await import("../services/whatsappAssistant.js");
  res.json(await getWhatsAppAssistantStats(req.auth!.organizationId));
});

apiRouter.get("/system/health", async (req, res) => {
  try {
    const { getSystemHealth } = await import("../services/systemHealth.js");
    res.json(await getSystemHealth(req.auth!.organizationId));
  } catch (err) {
    console.error("[system/health] failed", err);
    res.status(503).json({ error: "System health check failed" });
  }
});

apiRouter.get("/admin/reliability/health-report", requirePerm("reliability.view"), async (req, res) => {
  try {
    const { buildReliabilityHealthReport, runReliabilitySelfHealing } = await import(
      "../services/reliability/center/index.js"
    );
    await runReliabilitySelfHealing({ organizationId: req.auth!.organizationId }).catch(() => undefined);
    const report = await buildReliabilityHealthReport({ organizationId: req.auth!.organizationId });
    res.json(report);
  } catch (err) {
    console.error("[admin/reliability/health-report] failed", errorDetails(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Reliability health report failed" });
  }
});

apiRouter.post("/system/health/check", async (req, res) => {
  try {
    const { getSystemHealth } = await import("../services/systemHealth.js");
    res.json(await getSystemHealth(req.auth!.organizationId));
  } catch (err) {
    console.error("[system/health/check] failed", err);
    res.status(503).json({ error: "System health check failed" });
  }
});

apiRouter.post("/whatsapp/scan", async (req, res) => {
  if (!config.twilio.messageProcessingEnabled) {
    res.json({
      scanId: null,
      status: "disabled",
      inProgress: false,
      reason: "WhatsApp message scanning and invoice extraction are disabled. Invoices are collected from Gmail only.",
      messagesFound: 0,
      messagesScanned: 0,
      mediaMessagesFound: 0,
      mediaItemsFound: 0,
      mediaItemsProcessed: 0,
      driveFilesCreated: 0,
      supplierPaymentsCreatedOrUpdated: 0,
      paymentMessagesFound: 0,
      supplierPaymentsFound: 0,
      errorsCount: 0,
      errors: [],
    });
    return;
  }

  const organizationId = req.auth!.organizationId;
  const body = req.body as { daysBack?: number | null; fullScan?: boolean };
  const fullScan = Boolean(body.fullScan);
  const hasExplicitDaysBack = body.daysBack !== undefined && body.daysBack !== null;
  const initialWindow = initialConnectScanWindow();
  const requestedDaysBack = hasExplicitDaysBack ? Number(body.daysBack) : initialWindow.daysBack;
  const daysBack = Number.isFinite(requestedDaysBack) ? Math.max(1, requestedDaysBack) : initialWindow.daysBack;
  const since = !fullScan
    ? hasExplicitDaysBack
      ? new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
      : initialWindow.since
    : null;
  const scanMode = fullScan ? "full" : `last_${daysBack}_days`;

  const activeLog = await prisma.syncLog.findFirst({
    where: {
      organizationId,
      type: "whatsapp",
      status: "running",
      startedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
    },
    orderBy: { startedAt: "desc" },
  });
  if (activeLog) {
    res.status(202).json({
      scanId: activeLog.id,
      status: "running",
      inProgress: true,
      mode: activeLog.scanMode ?? scanMode,
      progressUrl: `/api/whatsapp/scan/${activeLog.id}`,
      message: "WhatsApp scan is already running in the background",
      ...(await buildWhatsAppScanProgress(organizationId, activeLog.id)),
    });
    return;
  }

  const log = await prisma.syncLog.create({
    data: {
      organizationId,
      type: "whatsapp",
      status: "running",
      scanMode,
      startedAt: new Date(),
    },
  });

  void runWhatsAppScanJob({
    organizationId,
    scanId: log.id,
    scanMode,
    since,
    fullScan,
  }).catch((err) => {
    console.error("[whatsapp-scan] background job crashed", errorDetails(err));
  });

  res.status(202).json({
    scanId: log.id,
    status: "started",
    inProgress: true,
    mode: scanMode,
    progressUrl: `/api/whatsapp/scan/${log.id}`,
    message: "WhatsApp scan started in background",
    messagesFound: 0,
    messagesScanned: 0,
    mediaMessagesFound: 0,
    mediaItemsFound: 0,
    mediaItemsProcessed: 0,
    driveFilesCreated: 0,
    supplierPaymentsCreatedOrUpdated: 0,
    invoiceRecordsCreatedOrUpdated: 0,
    paymentMessagesFound: 0,
    supplierPaymentsFound: 0,
    errorsCount: 0,
    errors: [],
  });
});

apiRouter.get("/whatsapp/scan/:scanId", async (req, res) => {
  const progress = await buildWhatsAppScanProgress(req.auth!.organizationId, req.params.scanId);
  if (!progress) {
    res.status(404).json({ error: "WhatsApp scan not found" });
    return;
  }
  res.json(progress);
});

async function runWhatsAppScanJob(input: {
  organizationId: string;
  scanId: string;
  scanMode: string;
  since: Date | null;
  fullScan: boolean;
}) {
  const { organizationId, scanId, scanMode, since, fullScan } = input;
  const startedAt = Date.now();
  console.log(`[whatsapp-scan] background start org=${organizationId} scanId=${scanId} mode=${scanMode}`);
  try {
    const where = {
      organizationId,
      direction: "inbound",
      ...(since ? { createdAt: { gte: since } } : {}),
    };
    const messages = await prisma.whatsAppLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: fullScan ? 1000 : 500,
      select: {
        id: true,
        clientId: true,
        body: true,
        fromNumber: true,
        mediaCount: true,
        mediaJson: true,
        createdAt: true,
      },
    });

    const { analyzeAndSaveMessage } = await import("../services/messageScanner.js");
    const { ingestWhatsAppInvoiceMedia } = await import("../services/whatsappInvoiceIngestion.js");
    console.log(`[whatsapp-scan] messages loaded org=${organizationId} scanId=${scanId} count=${messages.length}`);
    let scanned = 0;
    let mediaMessagesFound = 0;
    let mediaItemsFound = 0;
    let mediaItemsProcessed = 0;
    let driveFilesCreated = 0;
    let supplierPaymentsCreatedOrUpdated = 0;
    let invoiceRecordsCreatedOrUpdated = 0;
    let errorsCount = 0;
    const errors: string[] = [];

    for (const message of messages) {
      try {
        await analyzeAndSaveMessage({
          organizationId,
          channel: "whatsapp",
          externalId: message.id,
          whatsappLogId: message.id,
          senderPhone: message.fromNumber ?? undefined,
          bodyText: message.body,
          occurredAt: message.createdAt,
          createLead: false,
        });
        scanned += 1;
        const media = normalizeStoredWhatsAppMedia(message.mediaJson);
        if (config.twilio.mediaIngestionEnabled && (message.mediaCount > 0 || media.length > 0)) {
          mediaMessagesFound += 1;
          mediaItemsFound += media.length;
          console.log(`[whatsapp-scan] media processing start scanId=${scanId} logId=${message.id} media=${media.length}`);
          const mediaResult = await ingestWhatsAppInvoiceMedia({
            organizationId,
            clientId: message.clientId,
            whatsappLogId: message.id,
            fromNumber: message.fromNumber ?? "",
            body: message.body,
            media,
          });
          mediaItemsProcessed += mediaResult.processed.length;
          driveFilesCreated += mediaResult.processed.filter((item) => item.driveLink).length;
          supplierPaymentsCreatedOrUpdated += mediaResult.processed.filter((item) => item.paymentId).length;
          invoiceRecordsCreatedOrUpdated += mediaResult.processed.filter((item) => item.invoiceId).length;
          console.log(`[whatsapp-scan] media processing done scanId=${scanId} logId=${message.id} processed=${mediaResult.processed.length} payments=${mediaResult.processed.filter((item) => item.paymentId).length} invoices=${mediaResult.processed.filter((item) => item.invoiceId).length}`);
        }
        if (scanned === 1 || scanned % 5 === 0 || scanned === messages.length) {
          await prisma.syncLog.update({
            where: { id: scanId },
            data: {
              emailsProcessed: messages.length,
              emailsSaved: scanned,
              invoicesFound: mediaItemsProcessed,
              paymentsCreated: supplierPaymentsCreatedOrUpdated,
              driveUploaded: driveFilesCreated,
              errorsCount,
              errorMessage: errors.length ? errors.join(" | ") : null,
            },
          });
        }
      } catch (err) {
        errorsCount += 1;
        const details = errorDetails(err);
        console.error("[whatsapp-scan] message processing failed", {
          scanId,
          logId: message.id,
          error: details,
        });
        if (errors.length < 5) errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    const [invoiceMessages, paymentsFromWhatsApp] = await Promise.all([
      prisma.messageScan.count({
        where: {
          organizationId,
          channel: "whatsapp",
          intent: "payment",
          ...(since ? { occurredAt: { gte: since } } : {}),
        },
      }),
      prisma.supplierPayment.count({
        where: {
          organizationId,
          OR: [
            { source: "whatsapp" },
            { source: "both" },
            { firstSource: "whatsapp" },
            { lastSource: "whatsapp" },
          ],
          ...(since ? { createdAt: { gte: since } } : {}),
        },
      }),
    ]);

    await prisma.syncLog.update({
      where: { id: scanId },
      data: {
        status: errorsCount ? "error" : "success",
        emailsProcessed: messages.length,
        emailsSaved: scanned,
        invoicesFound: invoiceMessages,
        paymentsCreated: paymentsFromWhatsApp,
        driveUploaded: driveFilesCreated,
        errorsCount,
        errorMessage: errors.length ? errors.join(" | ") : null,
        finishedAt: new Date(),
      },
    });
    console.log(`[whatsapp-scan] background done org=${organizationId} scanId=${scanId} status=${errorsCount ? "error" : "success"} elapsedMs=${Date.now() - startedAt} messages=${messages.length} scanned=${scanned} paymentsUpdated=${supplierPaymentsCreatedOrUpdated} driveFiles=${driveFilesCreated} errors=${errorsCount}`);
  } catch (err) {
    console.error("[whatsapp-scan] background failed", {
      scanId,
      organizationId,
      error: errorDetails(err),
    });
    await prisma.syncLog.update({
      where: { id: scanId },
      data: {
        status: "error",
        errorsCount: 1,
        errorMessage: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      },
    });
  }
}

async function buildWhatsAppScanProgress(organizationId: string, scanId: string) {
  const log = await prisma.syncLog.findFirst({
    where: { id: scanId, organizationId, type: "whatsapp" },
  });
  if (!log) return null;
  const status = log.finishedAt ? (log.status === "success" ? "completed" : "error") : "running";
  const messagesFound = log.emailsProcessed;
  const messagesScanned = log.emailsSaved;
  const progressPercent = status === "completed"
    ? 100
    : status === "error"
      ? 100
      : messagesFound > 0
        ? Math.min(95, Math.max(5, Math.round((messagesScanned / Math.max(messagesFound, 1)) * 100)))
        : 5;
  const errors = log.errorMessage ? log.errorMessage.split(" | ").filter(Boolean).slice(0, 5) : [];
  return {
    scanId: log.id,
    status,
    inProgress: status === "running",
    mode: log.scanMode ?? "unknown",
    progressPercent,
    startedAt: log.startedAt,
    finishedAt: log.finishedAt,
    error: status === "error" ? log.errorMessage : null,
    messagesFound,
    messagesScanned,
    mediaMessagesFound: 0,
    mediaItemsFound: 0,
    mediaItemsProcessed: log.invoicesFound,
    driveFilesCreated: log.driveUploaded,
    supplierPaymentsCreatedOrUpdated: log.paymentsCreated,
    invoiceRecordsCreatedOrUpdated: 0,
    paymentMessagesFound: log.invoicesFound,
    supplierPaymentsFound: log.paymentsCreated,
    errorsCount: log.errorsCount,
    errors,
  };
}

function normalizeStoredWhatsAppMedia(value: unknown): Array<{ url: string; contentType: string; filename?: string | null }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const media = item as { url?: unknown; contentType?: unknown; filename?: unknown };
    if (typeof media.url !== "string" || !media.url) return [];
    return [{
      url: media.url,
      contentType: typeof media.contentType === "string" ? media.contentType : "",
      filename: typeof media.filename === "string" ? media.filename : null,
    }];
  });
}

apiRouter.post("/whatsapp-assistant/test/:type", async (req, res) => {
  const type = req.params.type === "number" ? "number" : "morning";
  const { sendAssistantTest } = await import("../services/whatsappAssistant.js");
  const result = await sendAssistantTest(req.auth!.organizationId, type);
  if (!result.sent) {
    res.status(400).json({ error: result.reason });
    return;
  }
  res.json(result);
});

async function scanGmail(req: Request, res: Response) {
  try {
    const { syncGmailForOrganization } = await import("../services/gmail-sync.js");
    const organizationId = req.auth!.organizationId;
    const gmailIntegration = await prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: "gmail" } },
      select: { refreshToken: true, accessToken: true, organizationId: true },
    });
    if (!gmailIntegration?.refreshToken && !gmailIntegration?.accessToken) {
      console.warn(`[gmail-scan] Gmail not connected org=${organizationId}`);
      res.status(409).json({ error: "יש לחבר חשבון ג׳ימייל לפני הסריקה", code: "GMAIL_NOT_CONNECTED" });
      return;
    }

    const rescanInvoices = req.body?.rescanInvoices === true || req.query.rescanInvoices === "true";
    const historical =
      req.body?.historical === true ||
      req.query.historical === "true" ||
      req.body?.historical === "1" ||
      req.query.historical === "1";
    const rawDaysBackValue = req.body?.daysBack ?? req.query.daysBack;
    const rawDaysBack = Number(rawDaysBackValue);
    const hasExplicitDaysBack = Number.isFinite(rawDaysBack) && rawDaysBack > 0;
    const useHistoricalScan = isHistoricalGmailScanRequest({
      historical,
      rescanInvoices,
      hasExplicitDaysBack,
      rawDaysBack,
    });

    let daysBack: number;
    let since: Date | undefined;
    let scanMode: "manual" | "manual_incremental";
    let incrementalCursorSource: string | undefined;

    if (useHistoricalScan) {
      const historicalWindow = resolveHistoricalGmailScanWindow({
        hasExplicitDaysBack,
        rawDaysBack,
        rescanInvoices,
      });
      daysBack = historicalWindow.daysBack;
      since = historicalWindow.since;
      scanMode = "manual";
    } else {
      const incrementalWindow = await resolveIncrementalGmailScanWindow(organizationId);
      daysBack = incrementalWindow.daysBack;
      since = incrementalWindow.since;
      scanMode = "manual_incremental";
      incrementalCursorSource = incrementalWindow.cursorSource;
    }

    const maxMessages = rescanInvoices ? 1000 : undefined;
    console.log(
      `[gmail-scan] POST /api/gmail/scan org=${organizationId} scanMode=${scanMode} historical=${useHistoricalScan} rawDaysBack=${String(req.body?.daysBack ?? req.query.daysBack ?? "missing")} daysBack=${daysBack} since=${since?.toISOString() ?? "none"} cursorSource=${incrementalCursorSource ?? "n/a"}`
    );
    console.log("[gmail-scan] Step 1: checking Gmail authentication");

    const cleanup = rescanInvoices ? await cleanupGmailInvoiceArtifacts(organizationId) : null;
    if (cleanup) {
      console.log(`[gmail-scan] invoice rescan cleanup org=${organizationId} invoicesDeleted=${cleanup.invoicesDeleted} paymentsDeleted=${cleanup.paymentsDeleted} scanItemsDeleted=${cleanup.scanItemsDeleted} emailsReset=${cleanup.emailsReset}`);
    }

    await closeStaleGmailScansForOrg(organizationId);
    const activeLog = await findActiveGmailScanLog(organizationId);
    if (activeLog) {
      const progress = await buildGmailScanProgress(organizationId, activeLog.id);
      console.log(`[gmail-scan] Existing scan in progress org=${organizationId} scanId=${activeLog.id}`);
      res.json({
        success: true,
        scanId: activeLog.id,
        status: "running",
        inProgress: true,
        daysBack,
        progressUrl: `/api/gmail/scan/${activeLog.id}`,
        summary: progress,
      });
      return;
    }

    const { scanLog, created } = await createQueuedGmailScanLog(organizationId, scanMode);
    if (!created) {
      const progress = await buildGmailScanProgress(organizationId, scanLog.id);
      res.json({
        success: true,
        scanId: scanLog.id,
        status: "running",
        inProgress: true,
        daysBack,
        progressUrl: `/api/gmail/scan/${scanLog.id}`,
        summary: progress,
      });
      return;
    }
    logScanLifecycle(scanLog.id, "created");
    console.log(`[gmail-scan] Step 2: background scan started org=${organizationId} scanId=${scanLog.id} daysBack=${daysBack}`);
    void syncGmailForOrganization(organizationId, {
      daysBack,
      since,
      forceReprocess: daysBack >= 90 || rescanInvoices,
      scanAllMail: rescanInvoices,
      maxMessages,
      scanLogId: scanLog.id,
      scanMode,
    })
      .then((backgroundResult) => {
        if ("inProgress" in backgroundResult && backgroundResult.inProgress) {
          logScanLifecycle(scanLog.id, "running", "background returned inProgress");
          return;
        }
        const result = backgroundResult as {
          emailsProcessed?: number;
          emailsSavedToGmailScanItem?: number;
          paymentsCreated?: number;
          invoicesCreated?: number;
          driveUploadsSucceeded?: number;
          parserRejectedCount?: number;
          ignoredCount?: number;
        };
        console.log(`[gmail-scan] Background processing finished org=${organizationId} scanId=${scanLog.id} emails=${result.emailsProcessed ?? 0} saved=${result.emailsSavedToGmailScanItem ?? 0} payments=${result.paymentsCreated ?? 0} invoices=${result.invoicesCreated ?? 0} driveUploaded=${result.driveUploadsSucceeded ?? 0} rejected=${result.parserRejectedCount ?? result.ignoredCount ?? 0}`);
      })
      .catch(async (backgroundError) => {
        const message = backgroundError instanceof Error ? backgroundError.message : String(backgroundError);
        console.error(`[gmail-scan] Background processing failed org=${organizationId} scanId=${scanLog.id}`, backgroundError);
        await finalizeGmailScanFailed(scanLog.id, message);
        logScanLifecycle(scanLog.id, "failed", `reason=${message}`);
      });

    res.json({
      success: true,
      scanId: scanLog.id,
      status: "started",
      inProgress: true,
      daysBack,
      progressUrl: `/api/gmail/scan/${scanLog.id}`,
      message: "Gmail scan started in background",
      cleanup,
      summary: {
        totalEmailsChecked: 0,
        emailsScanned: 0,
        emailsFetched: 0,
        emailsSaved: 0,
        invoicesFound: 0,
        supplierPaymentsFound: 0,
        clientsFound: 0,
        uploadedToDrive: 0,
        rejectedCount: 0,
        rejectedReasons: {},
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    const code = classifyGmailScanError(message);
    if (code === "GMAIL_NOT_CONNECTED") {
      console.log("[gmail-scan] Gmail not connected");
      res.status(409).json({ error: "יש לחבר חשבון ג׳ימייל לפני הסריקה", code: "GMAIL_NOT_CONNECTED" });
      return;
    }
    console.error("[gmail-scan] Scan failed", err);
    const status = code === "GMAIL_PERMISSION_DENIED" ? 403 : code === "GMAIL_TOKEN_EXPIRED" ? 401 : 500;
    res.status(status).json({ error: `סריקת Gmail נכשלה: ${humanGmailScanError(message, code)}`, code });
  }
}

apiRouter.post("/gmail/rescan-invoices", async (req, res) => {
  req.body = {
    ...(req.body ?? {}),
    rescanInvoices: true,
    daysBack: req.body?.daysBack ?? 90,
  };
  await scanGmail(req, res);
});

async function cleanupGmailInvoiceArtifacts(organizationId: string) {
  const [invoices, payments, scanItems, emails] = await prisma.$transaction([
    prisma.invoice.deleteMany({
      where: {
        organizationId,
        gmailMessageId: { not: null },
      },
    }),
    prisma.supplierPayment.deleteMany({
      where: {
        organizationId,
        source: "gmail",
        emailMessageId: { not: null },
      },
    }),
    prisma.gmailScanItem.deleteMany({ where: { organizationId } }),
    prisma.emailMessage.updateMany({
      where: { organizationId, source: "gmail" },
      data: { processedAt: null, clientId: null },
    }),
  ]);

  return {
    invoicesDeleted: invoices.count,
    paymentsDeleted: payments.count,
    scanItemsDeleted: scanItems.count,
    emailsReset: emails.count,
  };
}

apiRouter.get("/gmail/scan/:scanId", async (req, res) => {
  try {
    const progress = await buildGmailScanProgress(req.auth!.organizationId, req.params.scanId);
    if (!progress) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }
    res.json(progress);
  } catch (err) {
    console.error("[gmail-scan] progress failed", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load scan progress" });
  }
});

apiRouter.post("/sync/gmail", scanGmail);
apiRouter.post("/gmail-scan", scanGmail);
apiRouter.post("/gmail/scan", scanGmail);

async function createRunningGmailScanLog(organizationId: string, scanMode: string) {
  return createQueuedGmailScanLog(organizationId, scanMode);
}

async function buildGmailScanProgress(organizationId: string, scanId: string) {
  const log = await refreshGmailScanProgressOnRead(organizationId, scanId);
  if (!log) return null;

  const start = log.startedAt;
  const end = log.finishedAt ?? new Date();
  const window = { gte: start, lte: end };
  const failedItems = await prisma.gmailScanItem.findMany({
    where: {
      organizationId,
      createdAt: window,
      OR: [
        { reviewStatus: "needs_review" },
        { documentType: "unknown_needs_review" },
        { decisionReason: { contains: "failed", mode: "insensitive" } },
        { decisionReason: { contains: "rejected", mode: "insensitive" } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 25,
    select: {
      id: true,
      gmailMessageId: true,
      gmailMessageLink: true,
      sender: true,
      subject: true,
      documentType: true,
      decisionReason: true,
      reviewStatus: true,
      occurredAt: true,
    },
  });
  const lastSuccessfulScan = await findLastGmailScanSuccessCursor(organizationId);
  const [classifiedCount, rejectedCount, uniqueSupplierRows] = await Promise.all([
    prisma.gmailScanItem.count({
      where: {
        organizationId,
        createdAt: window,
        documentType: { in: ["invoice", "receipt", "payment_request"] },
        reviewStatus: "auto_saved",
      },
    }),
    prisma.gmailScanItem.count({
      where: {
        organizationId,
        createdAt: window,
        OR: [
          { reviewStatus: "needs_review" },
          { documentType: "unknown_needs_review" },
        ],
      },
    }),
    prisma.gmailScanItem.findMany({
      where: {
        organizationId,
        createdAt: window,
        documentType: { in: ["invoice", "receipt", "payment_request"] },
        reviewStatus: "auto_saved",
      },
      distinct: ["supplierName"],
      select: { supplierName: true },
    }),
  ]);

  const rejectedReasons = failedItems.reduce<Record<string, number>>((acc, item) => {
    const rejected =
      item.reviewStatus === "needs_review" ||
      item.documentType === "unknown_needs_review" ||
      /failed|rejected|no strong signal|empty|skipped/i.test(item.decisionReason);
    if (!rejected) return acc;
    const reason = item.decisionReason || "needs_review";
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});

  const status = toApiGmailScanStatus(log.status, {
    errorsCount: log.errorsCount,
    errorMessage: log.errorMessage,
  });
  const authoritativeStatus =
    status === "queued" || status === "running"
      ? status
      : status === "timed_out" || status === "stale" || status === "paused"
        ? "timed_out"
        : status === "cancelled"
          ? "cancelled"
          : status === "completed" || status === "partial"
            ? "completed"
            : status === "error" || status === "failed"
              ? "failed"
              : "idle";
  const elapsedMs = Math.max(0, end.getTime() - start.getTime());
  const emailsFetched = log.emailsProcessed;
  const emailsSaved = log.emailsSaved;
  const documentsFound = resolveDocumentsFound({
    classifiedCount,
    rejectedCount,
    persistedInvoicesFound: log.invoicesFound,
  });
  const invoicesFound = documentsFound;
  const supplierPaymentsFound = log.paymentsCreated;
  const uploadedToDrive = log.driveUploaded;
  const processed = emailsFetched;
  const progressNumerator = emailsSaved;
  const lastProgressAt = (log as { updatedAt?: Date }).updatedAt ?? log.startedAt;
  const scanPhase =
    status === "running" || status === "queued"
      ? progressNumerator > 0 && progressNumerator < emailsFetched
        ? "processing"
        : progressNumerator === 0
          ? "fetching"
          : "processing"
      : "completed";
  const progressPercent =
    status === "completed" || status === "partial"
      ? 100
      : status === "paused"
        ? log.totalMatched && log.totalMatched > 0
          ? Math.min(100, Math.round((emailsFetched / log.totalMatched) * 100))
          : processed > 0
            ? 50
            : 0
        : status === "error" ||
            status === "failed" ||
            status === "stale" ||
            status === "timed_out" ||
            status === "cancelled"
          ? Math.min(100, processed > 0 ? 100 : 0)
          : processed > 0
            ? progressNumerator > 0
              ? Math.min(95, Math.max(1, Math.round((progressNumerator / Math.max(processed, 1)) * 100)))
              : 5
            : 0;
  const emailsPerMs = processed > 0 && elapsedMs > 0 ? processed / elapsedMs : 0;
  const estimatedRemainingSeconds =
    status === "running" && emailsPerMs > 0 && progressPercent > 0
      ? Math.max(0, Math.round(((100 - progressPercent) / progressPercent) * (elapsedMs / 1000)))
      : null;

  const canStartNewScan = !(status === "running" || status === "queued");
  const userMessageHe =
    status === "running" || status === "queued"
      ? `נטלי סורקת את המייל שלך… עברתי על ${emailsFetched} מיילים ומצאתי ${documentsFound} מסמכים`
      : status === "timed_out" || status === "stale"
        ? "הסריקה נתקעה ונעצרה אוטומטית. אפשר לנסות שוב."
        : status === "paused"
          ? "הסריקה הופסקה באמצע. אפשר להריץ סריקה נוספת מתי שנוח לך."
          : status === "cancelled"
            ? "הסריקה בוטלה. אפשר להריץ סריקה חדשה."
            : status === "error" || status === "failed"
              ? "הסריקה נכשלה. אפשר לנסות שוב בעוד רגע."
              : status === "partial"
                ? "הסריקה הסתיימה עם בעיות שדורשות בדיקה."
                : "הסריקה הסתיימה והנתונים עודכנו";

  return {
    scanId: log.id,
    status,
    authoritativeStatus,
    scanPhase,
    currentStage: scanPhase,
    inProgress: !log.finishedAt && (status === "running" || status === "queued"),
    startedAt: log.startedAt,
    lastProgressAt,
    finishedAt: log.finishedAt,
    failureReason: log.errorMessage,
    canStartNewScan,
    userMessageHe,
    error:
      status === "error" ||
      status === "failed" ||
      status === "stale" ||
      status === "timed_out" ||
      status === "cancelled"
        ? userMessageHe
        : null,
    progressPercent,
    estimatedRemainingSeconds,
    lastSuccessfulScanAt: lastSuccessfulScan?.finishedAt ?? null,
    emailsFetched,
    emailsSaved,
    documentsFound,
    invoicesFound,
    supplierPaymentsFound,
    clientsFound: 0,
    uploadedToDrive,
    windowTruncated: log.windowTruncated,
    totalMatched: log.totalMatched,
    sheetsUpdated: log.sheetsUpdated,
    failedItems,
    rejectedReasons,
    finalSummary: log.finishedAt
      ? {
          emailsFetched,
          emailsSaved,
          documentsFound,
          invoicesFound,
          rejectedCount,
          classifiedCount,
          uniqueSuppliers: uniqueSupplierRows.length,
          supplierPaymentsFound,
          paymentsFound: supplierPaymentsFound,
          uploadedToDrive,
          sheetsUpdated: log.sheetsUpdated,
          failedItems: failedItems.length,
          errorsCount: log.errorsCount,
          windowTruncated: log.windowTruncated,
          totalMatched: log.totalMatched,
          completedAt: log.finishedAt,
        }
      : null,
    summary: {
      totalEmailsChecked: emailsFetched,
      emailsScanned: emailsFetched,
      emailsFetched,
      emailsSaved,
      scanPhase,
      recordsSaved: emailsSaved,
      documentsFound,
      invoicesFound,
      rejectedCount,
      classifiedCount,
      uniqueSuppliers: uniqueSupplierRows.length,
      supplierPaymentsFound,
      clientsFound: 0,
      uploadedToDrive,
      rejectedReasons,
      paymentsSaved: supplierPaymentsFound,
      errorsCount: log.errorsCount || (log.status === "error" ? 1 : 0),
      windowTruncated: log.windowTruncated,
      totalMatched: log.totalMatched,
      progressPercent,
      estimatedRemainingSeconds,
    },
  };
}

function buildGmailScanSummary(result: {
  emailsProcessed: number;
  totalEmailsChecked?: number;
  relevantEmailsFound?: number;
  paymentsCreated?: number;
  invoicesCreated?: number;
  receiptsFound?: number;
  paymentRequestsFound?: number;
  tasksCreated?: number;
  clientsCreated?: number;
  duplicatesSkipped?: number;
  invoiceEmails?: number;
  recordsSaved?: number;
  needsReviewCount?: number;
  errorsCount?: number;
  emailsSavedToGmailScanItem?: number;
  emailsSaved?: number;
  emailRecordsSaved?: number;
  ignoredCount?: number;
  ignoredReasons?: Record<string, number>;
  emailsParsed?: number;
  parserRejectedCount?: number;
  dbEmailMessageUpserts?: number;
  dbGmailScanItemUpserts?: number;
  driveUploadsAttempted?: number;
  driveUploadsSucceeded?: number;
  driveUploadsSkipped?: number;
  driveUploadsFailed?: number;
  invoiceDetectionPositive?: number;
  invoiceDetectionNegative?: number;
  windowTruncated?: boolean;
  totalMatched?: number | null;
}) {
  const businessRecordsSaved = result.recordsSaved ?? ((result.paymentsCreated ?? 0) + (result.invoicesCreated ?? 0) + (result.tasksCreated ?? 0) + (result.clientsCreated ?? 0));
  const emailRecordsSaved = result.emailsSavedToGmailScanItem ?? result.emailRecordsSaved ?? result.emailsSaved ?? 0;
  const recordsSaved = Math.max(businessRecordsSaved, emailRecordsSaved);
  return {
    totalEmailsChecked: result.totalEmailsChecked ?? result.emailsProcessed,
    emailsScanned: result.emailsProcessed,
    relevantEmailsFound: result.relevantEmailsFound ?? result.invoiceEmails ?? 0,
    invoiceOrPaymentEmailsFound: result.relevantEmailsFound ?? result.invoiceEmails ?? 0,
    invoicesFound: result.invoicesCreated ?? 0,
    receiptsFound: result.receiptsFound ?? 0,
    paymentRequestsFound: result.paymentRequestsFound ?? 0,
    recordsSaved,
    businessRecordsSaved,
    emailRecordsSaved,
    emailsSaved: emailRecordsSaved,
    paymentsSaved: result.paymentsCreated ?? 0,
    invoicesSaved: result.invoicesCreated ?? 0,
    duplicatesSkipped: result.duplicatesSkipped ?? 0,
    needsReviewCount: result.needsReviewCount ?? 0,
    errorsCount: result.errorsCount ?? 0,
    emailsSavedToGmailScanItem: result.emailsSavedToGmailScanItem ?? 0,
    emailsParsed: result.emailsParsed ?? 0,
    parserRejectedCount: result.parserRejectedCount ?? 0,
    dbEmailMessageUpserts: result.dbEmailMessageUpserts ?? 0,
    dbGmailScanItemUpserts: result.dbGmailScanItemUpserts ?? 0,
    driveUploadsAttempted: result.driveUploadsAttempted ?? 0,
    driveUploadsSucceeded: result.driveUploadsSucceeded ?? 0,
    driveUploadsSkipped: result.driveUploadsSkipped ?? 0,
    driveUploadsFailed: result.driveUploadsFailed ?? 0,
    invoiceDetectionPositive: result.invoiceDetectionPositive ?? 0,
    invoiceDetectionNegative: result.invoiceDetectionNegative ?? 0,
    windowTruncated: result.windowTruncated ?? false,
    totalMatched: result.totalMatched ?? null,
    ignoredCount: result.ignoredCount ?? 0,
    ignoredReasons: result.ignoredReasons ?? {},
  };
}

function classifyGmailScanError(message: string) {
  const lower = message.toLowerCase();
  if (message === "Gmail not connected" || lower.includes("not connected")) return "GMAIL_NOT_CONNECTED";
  if (lower.includes("invalid_grant") || lower.includes("token") && lower.includes("expired")) return "GMAIL_TOKEN_EXPIRED";
  if (lower.includes("insufficient") || lower.includes("permission") || lower.includes("scope") || lower.includes("forbidden")) return "GMAIL_PERMISSION_DENIED";
  if (lower.includes("database") || lower.includes("prisma") || lower.includes("table") || lower.includes("relation")) return "DATABASE_FAILURE";
  return "GMAIL_SCAN_FAILED";
}

function humanGmailScanError(message: string, code: string) {
  if (code === "GMAIL_TOKEN_EXPIRED") return "החיבור ל-Gmail פג תוקף. חבר Gmail מחדש בהגדרות.";
  if (code === "GMAIL_PERMISSION_DENIED") return "חסרות הרשאות Gmail. חבר Gmail מחדש ואשר הרשאות קריאה ושליחה.";
  if (code === "DATABASE_FAILURE") return "שמירה למסד הנתונים נכשלה. בדוק שהטבלאות קיימות והמיגרציות הורצו.";
  return message;
}

async function safeLeadCount(organizationId: string) {
  try {
    return await prisma.lead.count({ where: { organizationId } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("public.Lead") || message.includes("Lead") && message.includes("does not exist")) {
      console.warn(`[gmail-scan] Lead table is missing; continuing with lead count 0 org=${organizationId}`);
      return 0;
    }
    throw err;
  }
}

async function latestScannedEmails(organizationId: string) {
  const emails = await prisma.emailMessage.findMany({
    where: { organizationId },
    orderBy: { receivedAt: "desc" },
    take: 50,
    select: {
      id: true,
      gmailId: true,
      fromAddress: true,
      subject: true,
      bodyText: true,
      receivedAt: true,
      source: true,
    },
  });

  return emails.map((email) => ({
    id: email.id,
    messageId: email.gmailId,
    from: email.fromAddress,
    subject: email.subject,
    body: email.bodyText,
    date: email.receivedAt,
    source: email.source,
  }));
}

// requirePerm: ה-preview כבר לא stateless — הוא יוצר רשומת draft, ולכן דורש
// את אותה הרשאה כמו השמירה עצמה.
apiRouter.post("/camera/invoices/preview", requirePerm("document.upload"), async (req, res) => {
  try {
    const body = req.body as {
      filename?: string;
      mimeType?: string;
      fileBase64?: string;
    };

    if (!body.fileBase64 || !body.mimeType) {
      res.status(400).json({ error: "Invoice file is required" });
      return;
    }

    if (!["image/jpeg", "image/png", "application/pdf"].includes(body.mimeType)) {
      res.status(400).json({ error: "Only jpg, png and pdf invoices are supported" });
      return;
    }

    // Persist-first: רשומת draft נוצרת לפני ה-OCR, כך שכשל חילוץ (או נטישת
    // המסך אחרי ה-preview) לעולם לא מעלים את המסמך — הוא נשאר בהשלמת
    // חשבוניות עם סיבה ברורה.
    const { ingestCameraDocument } = await import("../services/camera/cameraIngestion.js");
    const result = await ingestCameraDocument({
      organizationId: req.auth!.organizationId,
      filename: body.filename ?? `camera-invoice-${Date.now()}.jpg`,
      mimeType: body.mimeType,
      fileBase64: body.fileBase64,
    });

    res.json({
      reviewId: result.reviewId,
      supplier: result.preview?.supplier ?? null,
      amount: result.preview?.amount ?? null,
      date: result.preview?.date ?? null,
      invoiceNumber: result.preview?.invoiceNumber ?? null,
      currency: result.preview?.currency ?? "ILS",
      extractionError: result.extractionError,
      uncertaintyReason: result.uncertaintyReason,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invoice preview failed";
    res.status(500).json({ error: message });
  }
});

apiRouter.post("/camera/invoices", requirePerm("document.upload"), async (req, res) => {
  try {
    const body = req.body as {
      supplier?: string;
      amount?: number;
      currency?: string;
      invoiceDate?: string;
      invoiceNumber?: string;
      dueDate?: string;
      filename?: string;
      mimeType?: string;
      fileBase64?: string;
      reviewId?: string;
    };

    // Persist-first: ספק/סכום חסרים כבר לא מעלימים את המסמך. רשומת ה-draft
    // (שנוצרה ב-preview) מתעדכנת במה שיש ונשארת בהשלמת חשבוניות עם סיבה.
    if (!body.supplier || typeof body.amount !== "number") {
      if (body.reviewId) {
        const draft = await prisma.financialDocumentReview.findFirst({
          where: { id: body.reviewId, organizationId: req.auth!.organizationId, source: "camera" },
        });
        if (draft) {
          const missing = [
            !body.supplier && !draft.supplierName ? "ספק" : null,
            typeof body.amount !== "number" && draft.totalAmount == null ? "סכום" : null,
          ].filter(Boolean);
          await prisma.financialDocumentReview.update({
            where: { id: draft.id },
            data: {
              ...(body.supplier?.trim() ? { supplierName: body.supplier.trim() } : {}),
              ...(typeof body.amount === "number" && Number.isFinite(body.amount) && body.amount > 0
                ? { totalAmount: body.amount }
                : {}),
              ...(body.invoiceNumber ? { invoiceNumber: body.invoiceNumber } : {}),
              ...(body.currency ? { currency: body.currency } : {}),
              uncertaintyReason: missing.length
                ? `לא זוהה ${missing.join(" ו")} — השלם במסך השלמת חשבוניות`
                : "ממתין לאישור במסך השלמת חשבוניות",
            },
          });
          res.json({
            status: "needs_review",
            reviewId: draft.id,
            message: "המסמך נשמר ויופיע במסך השלמת חשבוניות להשלמת הפרטים",
          });
          return;
        }
      }
      res.status(400).json({ error: "Supplier and amount are required" });
      return;
    }
    // F2: אפס/שלילי אינו סכום חשבונית תקין בקלט ידני — דחייה מפורשת במקום שמירת אפס שקטה.
    if (!Number.isFinite(body.amount) || body.amount <= 0 || body.amount >= MAX_REASONABLE_FINANCIAL_AMOUNT) {
      res.status(400).json({ error: "סכום החשבונית חייב להיות גדול מאפס וקטן ממיליון" });
      return;
    }
    const invoiceDate = body.invoiceDate ? new Date(body.invoiceDate) : new Date();
    const dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (Number.isNaN(invoiceDate.getTime()) || (dueDate && Number.isNaN(dueDate.getTime()))) {
      res.status(400).json({ error: "Invalid invoice date" });
      return;
    }
    // F4 רך: תאריך מחוץ ל-±2 שנים כבר לא מחזיר 400 שמעלים את המסמך.
    // עם reviewId — המסמך נשאר שמור ב-needs_review עם אזהרה, והמשתמש יכול
    // לתקן את התאריך או לאשר אותו במפורש (dateConfirmed).
    const { resolveCameraDateGate } = await import("../services/camera/cameraIngestion.js");
    const dateGate = resolveCameraDateGate({
      invoiceDate,
      dueDate,
      dateConfirmed: (body as { dateConfirmed?: boolean }).dateConfirmed === true,
    });
    if (dateGate.action === "confirm_required") {
      if (body.reviewId) {
        const draft = await prisma.financialDocumentReview.findFirst({
          where: { id: body.reviewId, organizationId: req.auth!.organizationId, source: "camera" },
        });
        if (draft) {
          await prisma.financialDocumentReview.update({
            where: { id: draft.id },
            data: {
              documentDate: invoiceDate,
              ...(body.supplier?.trim() ? { supplierName: body.supplier.trim() } : {}),
              ...(Number.isFinite(body.amount) && (body.amount as number) > 0 ? { totalAmount: body.amount } : {}),
              ...(body.invoiceNumber ? { invoiceNumber: body.invoiceNumber } : {}),
              uncertaintyReason: dateGate.warning,
            },
          });
          res.json({
            status: "needs_review",
            reason: "date_out_of_range",
            reviewId: draft.id,
            message: dateGate.warning,
          });
          return;
        }
      }
      // מסלול ישן ללא draft — נשמרת ההתנהגות הקודמת
      res.status(400).json({ error: "תאריך החשבונית מחוץ לטווח סביר (עד שנתיים אחורה או קדימה)" });
      return;
    }

    // נתיב מהיר: אישור draft קיים — בלי base64, בלי OCR מחדש, בלי העלאה
    // חוזרת. האישור הישן שלח שוב את הקובץ המלא והעלה ל-Drive סינכרונית,
    // מה שגרם ל-timeout בלחיצת "אשר ושמור".
    if (body.reviewId) {
      const { confirmCameraDocument } = await import("../services/camera/cameraIngestion.js");
      const confirm = await confirmCameraDocument({
        organizationId: req.auth!.organizationId,
        reviewId: body.reviewId,
        supplier: body.supplier,
        amount: body.amount,
        currency: body.currency ?? null,
        invoiceNumber: body.invoiceNumber ?? null,
        documentDate: invoiceDate,
        dueDate,
        userId: req.auth!.userId,
      });
      if (confirm.status === "approved") {
        res.json({
          status: "approved",
          reviewId: confirm.reviewId,
          supplierPaymentId: confirm.supplierPaymentId,
          message: "החשבונית אושרה ונוספה לתשלומי ספקים",
        });
        return;
      }
      if (confirm.status === "needs_review") {
        res.json({
          status: "needs_review",
          reviewId: confirm.reviewId,
          message: "המסמך נשמר וממתין במסך השלמת חשבוניות",
        });
        return;
      }
      if (confirm.status === "forbidden") {
        // הרשומה שייכת לארגון אחר — בלי לחשוף פרטים
        res.status(403).json({ error: "אין לך הרשאה לאשר את המסמך הזה" });
        return;
      }
      // reviewId סופק במפורש אבל הרשומה לא נמצאה — לא נופלים למסלול הישן
      // בלי base64 (שגורם ל-503 שקט תחת containment). מחזירים 404 ברור.
      res.status(404).json({ error: "רשומת הטיוטה לא נמצאה — העלה מחדש את המסמך" });
      return;
    }

    // F5: חישוב SHA256 לקובץ המצלמה — אותה טביעת אצבע קובץ כמו Gmail/WhatsApp,
    // כך שאותו מסמך שמגיע גם במייל/וואטסאפ ייתפס ככפילות בין-מסלולית (טיר file).
    const cameraFileBuffer = body.fileBase64 ? Buffer.from(body.fileBase64, "base64") : null;
    const cameraFileSha256 = cameraFileBuffer
      ? createHash("sha256").update(cameraFileBuffer).digest("hex")
      : null;

    let documentLink: string | undefined;
    if (cameraFileBuffer && body.filename) {
      const { saveLocalIngestedDocument } = await import("../services/documents/documentReviewPreview.js");
      documentLink = await saveLocalIngestedDocument({
        channel: "camera",
        filename: body.filename,
        buffer: cameraFileBuffer,
      });
    }

    // שלב 5: מסלול המצלמה לא העלה ל-Drive בכלל (100% חסר ב-baseline). מעלים
    // כמו במסלול Gmail; כשל Drive לעולם לא מפיל את קליטת החשבונית — הקובץ
    // המקומי נשמר והרשומה מסומנת pending_retry להשלמה מאוחרת.
    let cameraDriveFileUrl: string | null = null;
    let cameraDriveUploadStatus: "uploaded" | "pending_retry" | null = null;
    if (cameraFileBuffer) {
      try {
        const { getGoogleClients } = await import("../services/google.js");
        const { ensureInvoiceFolderTree, uploadInvoiceAttachmentToDrive } = await import("../services/driveService.js");
        const { drive } = await getGoogleClients(req.auth!.organizationId);
        const rootFolderId = await ensureInvoiceFolderTree(drive);
        const upload = await uploadInvoiceAttachmentToDrive({
          organizationId: req.auth!.organizationId,
          drive,
          rootFolderId,
          supplier: body.supplier,
          documentType: "tax_invoice",
          reviewStatus: "needs_review",
          filename: body.filename ?? `camera-invoice-${Date.now()}.jpg`,
          mimeType: body.mimeType ?? null,
          receivedAt: new Date(),
          documentDate: invoiceDate,
          invoiceNumber: body.invoiceNumber ?? null,
          amount: body.amount,
          totalAmount: body.amount,
          buffer: cameraFileBuffer,
          fileSha256: cameraFileSha256,
        });
        cameraDriveFileUrl = upload.webViewLink ?? null;
        cameraDriveUploadStatus = cameraDriveFileUrl ? "uploaded" : "pending_retry";
      } catch (err) {
        cameraDriveUploadStatus = "pending_retry";
        console.warn(
          `DRIVE UPLOAD FAILED org=${req.auth!.organizationId} doc=cameraInvoice filename="${body.filename ?? "-"}" reason=${err instanceof Error ? err.message : String(err)} (ingestion continues, local file kept)`
        );
      }
    }

    // H: המצלמה עוברת דרך אותה שרשרת שערי אמון של Gmail/WhatsApp — לא עוד
    // confidence 0.7 קשיח ו-gates ריקים שניתבו כל מסמך ל-review עם
    // trust.gates_missing בלי קשר לאיכות הנתונים.
    const documentDecision = await recordManualEntryFinancialDocument({
      organizationId: req.auth!.organizationId,
      source: "camera",
      subject: body.invoiceNumber
        ? `Camera invoice scan #${body.invoiceNumber}`
        : "Camera invoice scan",
      fileName: body.filename ?? null,
      fileSize: cameraFileBuffer?.length ?? null,
      fileSha256: cameraFileSha256,
      supplierName: body.supplier,
      invoiceNumber: body.invoiceNumber ?? null,
      documentDate: invoiceDate,
      dueDate,
      totalAmount: body.amount,
      currency: body.currency ?? null,
      documentType: "tax_invoice",
      driveFileUrl: cameraDriveFileUrl ?? documentLink ?? null,
      driveUploadStatus: cameraDriveUploadStatus,
      userId: req.auth!.userId,
      sourceRoute: "POST /camera/invoices",
    });

    // סימון סטטוס ההעלאה על רשומת הביקורת — רשומת "ממתין ל-Drive" ניתנת
    // לאיתור (find-pending-drive.ts) ולעולם לא נעלמת בשקט.
    const cameraReviewId = "review" in documentDecision ? documentDecision.review?.id ?? null : null;
    if (cameraReviewId && cameraDriveUploadStatus) {
      const { attachPreviewToFinancialDocumentReview } = await import("../services/documents/documentReviewPreview.js");
      await attachPreviewToFinancialDocumentReview(cameraReviewId, req.auth!.organizationId, {
        previewUrl: cameraDriveFileUrl ?? documentLink ?? null,
        driveUploadStatus: cameraDriveUploadStatus,
      });
      if (cameraDriveUploadStatus === "pending_retry") {
        console.warn(
          `DRIVE_PENDING org=${req.auth!.organizationId} doc=financialDocumentReview:${cameraReviewId} source=camera localFile=${documentLink ?? "-"}`
        );
      }
    }

    const cameraAccepted = documentDecision.action === "accepted";
    const cameraReview = "review" in documentDecision ? documentDecision.review ?? null : null;
    res.status(cameraAccepted ? 201 : 202).json({
      reviewOnly: !cameraAccepted,
      action: documentDecision.action,
      // הסיבה האמיתית מהשרשרת (למשל "invoice number missing"), לא קבוע גורף
      uncertaintyReason: cameraReview?.uncertaintyReason ?? null,
      reviewId: cameraReview?.id ?? null,
      paymentId: "payment" in documentDecision ? documentDecision.payment?.id ?? null : null,
      message: cameraAccepted
        ? "החשבונית נקלטה ואושרה — מופיעה ברשימת התשלומים"
        : documentDecision.action === "duplicate"
          ? "זוהתה כפילות — הרשומה הקיימת עודכנה"
          : "המסמך נשמר לבדיקה — דורש בדיקה לפני יצירת תשלום",
    });
  } catch (err) {
    // הודעת ה-containment הטכנית באנגלית לעולם לא מוצגת למשתמש
    if (err && typeof err === "object" && (err as { code?: string }).code === "FINANCIAL_INGESTION_CONTAINMENT") {
      res.status(503).json({ error: "קליטת מסמכים חסומה זמנית במערכת — נסה שוב בעוד מספר דקות" });
      return;
    }
    const message = err instanceof Error ? err.message : "Camera scan failed";
    res.status(500).json({ error: message });
  }
});

async function sendBusinessHealth(req: Request, res: Response) {
  const stats = await getDashboardStats(req.auth!.organizationId);
  const score = stats.businessHealthScore;
  const recommendations: string[] = [];

  if (stats.missingInvoicesCount > 0) {
    recommendations.push("לטפל בחשבוניות חסרות מול ספקים.");
  }
  if (stats.overdueCustomerInvoices > 0) {
    recommendations.push("לשלוח תזכורות גבייה ללקוחות באיחור.");
  }
  if (stats.upcomingPaymentsCount > 0) {
    recommendations.push("לבדוק תשלומי ספקים קרובים לשבוע הקרוב.");
  }
  if (recommendations.length === 0) {
    recommendations.push("המצב נראה תקין. המשך לעקוב אחרי תשלומים פתוחים.");
  }

  res.json({
    score,
    status: score >= 80 ? "good" : score >= 60 ? "warning" : "risk",
    recommendations,
    metrics: {
      moneyToPay: stats.moneyToPay,
      moneyToReceive: stats.moneyToReceive,
      missingInvoices: stats.missingInvoicesCount,
      overdueCustomerInvoices: stats.overdueCustomerInvoices,
      overdueSupplierPayments: stats.overdueSupplierPayments,
      hoursSavedThisWeek: stats.hoursSavedThisWeek,
    },
  });
}

function enrichPaymentSources<
  T extends {
    source: string;
    subject: string | null;
    duplicateDetected?: boolean;
    duplicateReason?: string | null;
    organizationId?: string;
    documentLink?: string | null;
    invoiceLink?: string | null;
    driveFileUrl?: string | null;
  },
>(payment: T) {
  const source = payment.source || "gmail";
  const sources = source === "both"
    ? ["Gmail", "WhatsApp"]
    : source === "whatsapp"
      ? ["WhatsApp"]
      : source === "gmail"
        ? ["Gmail"]
        : [source];
  const duplicateReason = payment.duplicateReason ?? payment.subject?.match(/\[duplicate:([^\]]+)\]/)?.[1] ?? null;
  const organizationId = payment.organizationId ?? null;
  return {
    ...payment,
    // קבצים מקומיים (/uploads) יוצאים רק כ-URL חתום; קישורי Drive לא משתנים
    documentLink: signLocalUploadUrlIfNeeded(payment.documentLink ?? null, organizationId),
    invoiceLink: signLocalUploadUrlIfNeeded(payment.invoiceLink ?? null, organizationId),
    driveFileUrl: signLocalUploadUrlIfNeeded(payment.driveFileUrl ?? null, organizationId),
    sources,
    duplicateDetected: Boolean(payment.duplicateDetected || duplicateReason),
    duplicateReason,
  };
}

apiRouter.get("/business-health", async (req, res) => {
  await sendBusinessHealth(req, res);
});

apiRouter.get("/health-score", async (req, res) => {
  await sendBusinessHealth(req, res);
});

apiRouter.get("/customer-invoices", async (req, res) => {
  const invoices = await prisma.customerInvoice.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { dueDate: "asc" },
  });
  res.json(invoices);
});

apiRouter.post("/customer-invoices", requirePerm("payment.create"), async (req, res) => {
  const body = req.body as {
    customer?: string;
    amount?: number;
    dueDate?: string;
    notes?: string;
  };

  if (!body.customer || typeof body.amount !== "number") {
    res.status(400).json({ error: "Customer and amount are required" });
    return;
  }

  const invoice = await prisma.customerInvoice.create({
    data: {
      organizationId: req.auth!.organizationId,
      customer: body.customer,
      amount: body.amount,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      notes: body.notes,
    },
  });

  res.json(invoice);
});

apiRouter.patch("/customer-invoices/:id", requirePerm("invoice.update"), async (req, res) => {
  const body = req.body as { paid?: boolean; reminderSent?: boolean };
  const invoice = await prisma.customerInvoice.updateMany({
    where: { id: routeId(req), organizationId: req.auth!.organizationId },
    data: {
      ...(body.paid !== undefined && { paid: body.paid }),
      ...(body.reminderSent && { reminderSentAt: new Date() }),
    },
  });
  res.json({ updated: invoice.count });
});

apiRouter.post("/customer-invoices/:id/reminder", async (req, res) => {
  const invoice = await prisma.customerInvoice.findFirst({
    where: { id: routeId(req), organizationId: req.auth!.organizationId },
  });
  if (!invoice) {
    res.status(404).json({ error: "Customer invoice not found" });
    return;
  }

  await prisma.customerInvoice.update({
    where: { id: invoice.id },
    data: { reminderSentAt: new Date() },
  });

  res.json({
    message: `שלום ${invoice.customer}, מזכירים שקיימת חשבונית פתוחה על סך ₪${invoice.amount}. נשמח להסדרת התשלום בהקדם. תודה.`,
  });
});

apiRouter.get("/social-drafts", async (req, res) => {
  const drafts = await prisma.socialDraft.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(drafts);
});

apiRouter.post("/social-drafts", async (req, res) => {
  const body = req.body as {
    platform?: string;
    topic?: string;
    tone?: string;
  };

  const platform = body.platform || "facebook";
  const topic = body.topic || "טיפ עסקי";
  const tone = body.tone || "מקצועי וידידותי";
  const content = buildSocialDraft(platform, topic, tone);

  const draft = await prisma.socialDraft.create({
    data: {
      organizationId: req.auth!.organizationId,
      platform,
      topic,
      content,
    },
  });

  res.json(draft);
});

apiRouter.patch("/social-drafts/:id", async (req, res) => {
  const body = req.body as { status?: string; content?: string };
  const draft = await prisma.socialDraft.updateMany({
    where: { id: routeId(req), organizationId: req.auth!.organizationId },
    data: {
      ...(body.status && { status: body.status }),
      ...(body.content && { content: body.content }),
    },
  });
  res.json({ updated: draft.count });
});

function buildSocialDraft(platform: string, topic: string, tone: string) {
  const hashtags =
    platform === "instagram"
      ? "\n\n#עסקים #ניהולעסק #טיפיםלעסקים #ישראל"
      : "\n\nמה דעתכם? כתבו לנו בתגובות.";

  return `פוסט ${platform === "instagram" ? "לאינסטגרם" : "לפייסבוק"} בנושא: ${topic}

בטון ${tone}:

ניהול עסק קטן דורש סדר, מעקב ותגובה מהירה. ${topic} הוא אחד הדברים שיכולים לעזור לבעל העסק לחסוך זמן, לצמצם טעויות ולקבל החלטות טובות יותר.

טיפ קצר: התחילו ממעקב פשוט וקבוע, ואז שפרו אותו בהדרגה עם אוטומציה.${hashtags}`;
}

function countBy<T extends Record<string, string>>(items: T[], key: keyof T) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const value = item[key] || "unknown";
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}
