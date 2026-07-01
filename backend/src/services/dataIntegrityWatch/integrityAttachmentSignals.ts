import type { IntegrityEmailAttachmentRow } from "./integrityDb.js";
import type { IntegritySignalConfig } from "./integritySignalConfig.js";

export type OrphanAttachmentAnalysis = {
  hasAttachment: boolean;
  hasFinancialAttachment: boolean;
  unsupportedOnly: boolean;
  attachmentCount: number;
};

export function analyzeOrphanAttachments(
  attachments: IntegrityEmailAttachmentRow[],
  config: IntegritySignalConfig,
): OrphanAttachmentAnalysis {
  if (attachments.length === 0) {
    return {
      hasAttachment: false,
      hasFinancialAttachment: false,
      unsupportedOnly: false,
      attachmentCount: 0,
    };
  }

  const hasFinancialAttachment = attachments.some((attachment) =>
    isFinancialAttachment(attachment, config),
  );
  const unsupportedOnly =
    attachments.length > 0 &&
    attachments.every((attachment) => isUnsupportedAttachment(attachment, config));

  return {
    hasAttachment: true,
    hasFinancialAttachment,
    unsupportedOnly,
    attachmentCount: attachments.length,
  };
}

function isFinancialAttachment(
  attachment: IntegrityEmailAttachmentRow,
  config: IntegritySignalConfig,
): boolean {
  const filename = attachment.filename ?? "";
  const mimeType = attachment.mimeType ?? "";
  if (config.financialAttachmentFilenamePatterns.some((pattern) => pattern.test(filename))) {
    return true;
  }
  return config.financialAttachmentMimePatterns.some((pattern) => pattern.test(mimeType));
}

function isUnsupportedAttachment(
  attachment: IntegrityEmailAttachmentRow,
  config: IntegritySignalConfig,
): boolean {
  const filename = attachment.filename ?? "";
  const mimeType = attachment.mimeType ?? "";
  return (
    config.unsupportedAttachmentFilenamePatterns.some((pattern) => pattern.test(filename)) ||
    config.unsupportedAttachmentMimePatterns.some((pattern) => pattern.test(mimeType))
  );
}
