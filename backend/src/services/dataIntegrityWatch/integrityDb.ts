import type { PrismaClient } from "@prisma/client";
import { GMAIL_SCAN_ACTIVE_STATUSES, GMAIL_SCAN_STALE_MS } from "../gmailScanLifecycle.js";
import type { ScannerIsolationCheckData } from "../scanner/scannerIsolationChecks.js";

/** Read-only Prisma surface — no write operations permitted. */
export type IntegrityReadOnlyDb = Pick<
  PrismaClient,
  | "organization"
  | "supplierPayment"
  | "financialDocumentReview"
  | "gmailScanItem"
  | "invoice"
  | "emailMessage"
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
    select: { id: true, gmailId: true, receivedAt: true },
    take: 5000,
  });

  const gmailIds = [...new Set(emailMessages.map((e) => e.gmailId))];
  const crossOrgEmailMessages =
    gmailIds.length > 0
      ? await db.emailMessage.findMany({
          where: { gmailId: { in: gmailIds }, organizationId: { not: organizationId } },
          select: { id: true, organizationId: true, gmailId: true },
        })
      : [];

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
