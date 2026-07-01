import type { PrismaClient } from "@prisma/client";
import { GMAIL_SCAN_ACTIVE_STATUSES, GMAIL_SCAN_STALE_MS } from "../gmailScanLifecycle.js";
import type { ScannerIsolationCheckData } from "../scanner/scannerIsolationChecks.js";

export type IntegrityEmailMessageRow = {
  id: string;
  gmailId: string;
  receivedAt: Date;
  subject: string;
  fromAddress: string;
  processedAt: Date | null;
};

export type IntegrityEmailAttachmentRow = {
  emailMessageId: string;
  filename: string;
  mimeType: string | null;
};

export type IntegritySiblingArtifactSummary = {
  hasArtifact: boolean;
  siblingOrganizationCount: number;
  gsiCount: number;
  fdrCount: number;
  artifactSummary: string;
  organizationIds: string[];
};

/** Read-only Prisma surface — no write operations permitted. */
export type IntegrityReadOnlyDb = Pick<
  PrismaClient,
  | "organization"
  | "supplierPayment"
  | "financialDocumentReview"
  | "gmailScanItem"
  | "invoice"
  | "emailMessage"
  | "emailAttachment"
  | "integration"
  | "syncLog"
>;

export type IntegrityPaymentRow = {
  id: string;
  supplier: string;
  supplierName: string | null;
  amount: number;
  totalAmount: number | null;
  currency: string;
  documentFingerprint: string | null;
  emailMessageId: string | null;
  documentLink: string | null;
  driveFileId: string | null;
  duplicateDetected: boolean;
  duplicateHash: string | null;
  clientId: string | null;
  parsedFieldsJson: unknown;
  source: string;
  createdAt: Date;
};

export type IntegrityInvoiceRow = {
  id: string;
  gmailMessageId: string | null;
  emailId: string | null;
  amount: number;
  currency: string;
  organizationId: string;
  createdAt: Date;
};

export type IntegrityIntegrationRow = {
  id: string;
  provider: string;
  expiresAt: Date | null;
  metadata: string | null;
  connectedAt: Date;
};

export type IntegritySyncLogRow = {
  id: string;
  status: string;
  type: string;
  startedAt: Date;
  errorMessage: string | null;
};

export type IntegrityOrgData = ScannerIsolationCheckData & {
  emailMessages: IntegrityEmailMessageRow[];
  emailAttachmentsByEmailId: Map<string, IntegrityEmailAttachmentRow[]>;
  siblingArtifactsByGmailId: Map<string, IntegritySiblingArtifactSummary>;
  payments: IntegrityPaymentRow[];
  invoiceDetails: IntegrityInvoiceRow[];
  integrations: IntegrityIntegrationRow[];
  emailIds: Set<string>;
  gmailMessageIds: Set<string>;
  gsiGmailIds: Set<string>;
  fdrGmailIds: Set<string>;
};

export type LoadIntegrityOrgDataInput = {
  organizationId: string;
  now?: Date;
};

export async function loadIntegrityOrgData(
  db: IntegrityReadOnlyDb,
  input: LoadIntegrityOrgDataInput,
): Promise<IntegrityOrgData> {
  const now = input.now ?? new Date();
  const organizationId = input.organizationId;
  const staleCutoff = new Date(now.getTime() - GMAIL_SCAN_STALE_MS);

  const emailMessages = await db.emailMessage.findMany({
    where: { organizationId },
    select: {
      id: true,
      gmailId: true,
      receivedAt: true,
      subject: true,
      fromAddress: true,
      processedAt: true,
    },
    orderBy: { receivedAt: "desc" },
    take: 5000,
  });

  const emailIds = emailMessages.map((e) => e.id);
  const gmailIds = [...new Set(emailMessages.map((e) => e.gmailId))];
  const crossOrgEmailMessages =
    gmailIds.length > 0
      ? await db.emailMessage.findMany({
          where: { gmailId: { in: gmailIds }, organizationId: { not: organizationId } },
          select: { id: true, organizationId: true, gmailId: true },
        })
      : [];

  const [emailAttachments, crossOrgGmailScanItems, crossOrgFinancialDocumentReviews] = await Promise.all([
    emailIds.length
      ? db.emailAttachment.findMany({
          where: { emailMessageId: { in: emailIds } },
          select: { emailMessageId: true, filename: true, mimeType: true },
        })
      : [],
    gmailIds.length
      ? db.gmailScanItem.findMany({
          where: { gmailMessageId: { in: gmailIds }, organizationId: { not: organizationId } },
          select: {
            gmailMessageId: true,
            organizationId: true,
            reviewStatus: true,
            documentType: true,
          },
        })
      : [],
    gmailIds.length
      ? db.financialDocumentReview.findMany({
          where: { gmailMessageId: { in: gmailIds }, organizationId: { not: organizationId } },
          select: {
            gmailMessageId: true,
            organizationId: true,
            reviewStatus: true,
          },
        })
      : [],
  ]);

  const emailAttachmentsByEmailId = groupAttachmentsByEmailId(emailAttachments);
  const siblingArtifactsByGmailId = buildSiblingArtifactsByGmailId(
    gmailIds,
    crossOrgGmailScanItems,
    crossOrgFinancialDocumentReviews,
  );

  const [
    stuckActiveScans,
    supplierPayments,
    invoiceRows,
    gmailScanItems,
    financialDocumentReviews,
    gmailIntegration,
    organization,
    payments,
    integrations,
  ] = await Promise.all([
    db.syncLog.findMany({
      where: {
        organizationId,
        type: "gmail_scan",
        status: { in: [...GMAIL_SCAN_ACTIVE_STATUSES] },
        startedAt: { lte: staleCutoff },
      },
      select: { id: true, status: true, startedAt: true, scanMode: true },
    }),
    db.supplierPayment.findMany({
      where: { organizationId },
      select: { id: true, documentFingerprint: true, emailMessageId: true, createdAt: true },
    }),
    db.invoice.findMany({
      where: { organizationId },
      select: {
        id: true,
        gmailMessageId: true,
        emailId: true,
        amount: true,
        currency: true,
        organizationId: true,
        createdAt: true,
      },
    }),
    db.gmailScanItem.findMany({
      where: { organizationId },
      select: {
        id: true,
        gmailMessageId: true,
        reviewStatus: true,
        documentType: true,
        attachmentFilename: true,
        driveFileLink: true,
        amount: true,
        decisionReason: true,
        parsedFieldsJson: true,
        rawAnalysis: true,
        createdAt: true,
      },
    }),
    db.financialDocumentReview.findMany({
      where: { organizationId },
      select: {
        id: true,
        source: true,
        gmailMessageId: true,
        reviewStatus: true,
        uncertaintyReason: true,
        documentFingerprint: true,
        supplierPaymentId: true,
        parsedFieldsJson: true,
        createdAt: true,
      },
    }),
    db.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: "gmail" } },
      select: { id: true, metadata: true },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { user: { select: { email: true } } },
    }),
    db.supplierPayment.findMany({
      where: { organizationId },
      select: {
        id: true,
        supplier: true,
        supplierName: true,
        amount: true,
        totalAmount: true,
        currency: true,
        documentFingerprint: true,
        emailMessageId: true,
        documentLink: true,
        driveFileId: true,
        duplicateDetected: true,
        duplicateHash: true,
        clientId: true,
        parsedFieldsJson: true,
        source: true,
        createdAt: true,
      },
    }),
    db.integration.findMany({
      where: { organizationId },
      select: { id: true, provider: true, expiresAt: true, metadata: true, connectedAt: true },
    }),
  ]);

  const gsiGmailIds = new Set(gmailScanItems.map((g) => g.gmailMessageId));
  const fdrGmailIds = new Set(
    financialDocumentReviews
      .map((f) => f.gmailMessageId)
      .filter((id): id is string => Boolean(id)),
  );

  return {
    organizationId,
    now,
    stuckActiveScans,
    supplierPayments,
    invoices: invoiceRows.map(({ id, gmailMessageId, emailId, createdAt }) => ({
      id,
      gmailMessageId,
      emailId,
      createdAt,
    })),
    gmailScanItems,
    financialDocumentReviews,
    emailMessages,
    emailAttachmentsByEmailId,
    siblingArtifactsByGmailId,
    crossOrgEmailMessages,
    gmailIntegration,
    organizationUserEmail: organization?.user?.email ?? null,
    payments,
    invoiceDetails: invoiceRows,
    integrations,
    emailIds: new Set(emailMessages.map((e) => e.id)),
    gmailMessageIds: new Set(emailMessages.map((e) => e.gmailId)),
    gsiGmailIds,
    fdrGmailIds,
  };
}

export async function listOrganizationIds(db: IntegrityReadOnlyDb): Promise<string[]> {
  const orgs = await db.organization.findMany({ select: { id: true } });
  return orgs.map((o) => o.id);
}

function groupAttachmentsByEmailId(
  attachments: IntegrityEmailAttachmentRow[],
): Map<string, IntegrityEmailAttachmentRow[]> {
  const map = new Map<string, IntegrityEmailAttachmentRow[]>();
  for (const attachment of attachments) {
    const list = map.get(attachment.emailMessageId) ?? [];
    list.push(attachment);
    map.set(attachment.emailMessageId, list);
  }
  return map;
}

function buildSiblingArtifactsByGmailId(
  gmailIds: string[],
  crossOrgGmailScanItems: Array<{
    gmailMessageId: string;
    organizationId: string;
    reviewStatus: string;
    documentType: string;
  }>,
  crossOrgFinancialDocumentReviews: Array<{
    gmailMessageId: string | null;
    organizationId: string;
    reviewStatus: string;
  }>,
): Map<string, IntegritySiblingArtifactSummary> {
  const map = new Map<string, IntegritySiblingArtifactSummary>();

  for (const gmailId of gmailIds) {
    const gsiRows = crossOrgGmailScanItems.filter((row) => row.gmailMessageId === gmailId);
    const fdrRows = crossOrgFinancialDocumentReviews.filter((row) => row.gmailMessageId === gmailId);
    const organizationIds = [
      ...new Set([
        ...gsiRows.map((row) => row.organizationId),
        ...fdrRows.map((row) => row.organizationId),
      ]),
    ];
    const gsiCount = gsiRows.length;
    const fdrCount = fdrRows.length;
    const hasArtifact = gsiCount > 0 || fdrCount > 0;
    const primaryGsi = gsiRows[0];
    const primaryFdr = fdrRows[0];
    const artifactSummary = hasArtifact
      ? [
          gsiCount > 0
            ? `GSI ${primaryGsi?.reviewStatus ?? "unknown"}/${primaryGsi?.documentType ?? "unknown"}`
            : null,
          fdrCount > 0 ? `FDR ${primaryFdr?.reviewStatus ?? "unknown"}` : null,
        ]
          .filter(Boolean)
          .join("; ")
      : "none";

    map.set(gmailId, {
      hasArtifact,
      siblingOrganizationCount: organizationIds.length,
      gsiCount,
      fdrCount,
      artifactSummary,
      organizationIds,
    });
  }

  return map;
}
