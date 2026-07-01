import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildDriveLinkBlockedScanItemDecisionReason,
  primaryStrictDriveLinkUrl,
  shouldMirrorDriveLinkBlockedScanItem,
  type GmailDriveLinkInvoiceEvidence,
} from "./gmailDriveLinkEvidence.js";

export type DriveLinkBlockedScanItemMirrorInput = {
  organizationId: string;
  duplicateKey: string;
  email: {
    gmailId: string;
    emailRecordId: string;
    from: string;
    senderEmail?: string | null;
    subject: string;
    receivedAt: Date;
  };
  driveLinkEvidence: GmailDriveLinkInvoiceEvidence;
  outcomeStopsPersistence: boolean;
  outcomeUncertaintyReason: string;
  documentType: string;
  confidenceScore: string;
  classificationDecisionReason?: string | null;
  attachmentFilename: string | null;
  supplierName: string;
  amount: number | null;
  parsedFieldsJson: Record<string, unknown>;
  rawAnalysis: Record<string, unknown>;
};

function gmailMessageLink(gmailMessageId: string) {
  return `https://mail.google.com/mail/u/0/#inbox/${gmailMessageId}`;
}

export async function upsertDriveLinkBlockedScanItemMirror(
  db: Pick<PrismaClient, "gmailScanItem">,
  input: DriveLinkBlockedScanItemMirrorInput,
): Promise<{ id: string } | null> {
  if (
    !shouldMirrorDriveLinkBlockedScanItem(
      input.driveLinkEvidence,
      input.outcomeStopsPersistence,
    )
  ) {
    return null;
  }

  const driveFileLink = primaryStrictDriveLinkUrl(input.driveLinkEvidence);
  if (!driveFileLink) return null;

  const attachmentFilename =
    input.attachmentFilename ?? input.driveLinkEvidence.virtualAttachmentFilenames[0] ?? null;
  const decisionReason = buildDriveLinkBlockedScanItemDecisionReason(
    input.outcomeUncertaintyReason,
    input.classificationDecisionReason,
  );

  const saved = await db.gmailScanItem.upsert({
    where: { organizationId_duplicateKey: { organizationId: input.organizationId, duplicateKey: input.duplicateKey } },
    create: {
      organizationId: input.organizationId,
      emailMessageId: input.email.emailRecordId,
      gmailMessageId: input.email.gmailId,
      gmailMessageLink: gmailMessageLink(input.email.gmailId),
      sender: input.email.from || "unknown",
      senderEmail: input.email.senderEmail || null,
      subject: input.email.subject,
      occurredAt: input.email.receivedAt,
      amount: input.amount,
      supplierName: input.supplierName,
      documentType: input.documentType,
      attachmentFilename,
      driveFileLink,
      driveUploadStatus: "not_required",
      confidenceScore: input.confidenceScore,
      reviewStatus: "needs_review",
      duplicateKey: input.duplicateKey,
      decisionReason,
      parsedFieldsJson: input.parsedFieldsJson as Prisma.InputJsonValue,
      rawAnalysis: {
        ...input.rawAnalysis,
        driveLinkMirror: true,
        reviewOnly: true,
      } as Prisma.InputJsonValue,
    },
    update: {
      emailMessageId: input.email.emailRecordId,
      gmailMessageLink: gmailMessageLink(input.email.gmailId),
      sender: input.email.from || "unknown",
      senderEmail: input.email.senderEmail || null,
      subject: input.email.subject,
      occurredAt: input.email.receivedAt,
      amount: input.amount,
      supplierName: input.supplierName,
      documentType: input.documentType,
      attachmentFilename,
      driveFileLink,
      driveUploadStatus: "not_required",
      confidenceScore: input.confidenceScore,
      reviewStatus: "needs_review",
      decisionReason,
      parsedFieldsJson: input.parsedFieldsJson as Prisma.InputJsonValue,
      rawAnalysis: {
        ...input.rawAnalysis,
        driveLinkMirror: true,
        reviewOnly: true,
      } as Prisma.InputJsonValue,
    },
  });

  return { id: saved.id };
}
