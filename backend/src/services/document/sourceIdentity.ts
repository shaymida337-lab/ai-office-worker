import { createHash } from "crypto";
import { prisma } from "../../lib/prisma.js";

export type SourceChannel =
  | "gmail_attachment"
  | "gmail_body"
  | "whatsapp_media"
  | "camera_upload"
  | "drive_file"
  | "client_gmail"
  | "other";

export type SourceIdentityInput = {
  organizationId: string;
  channel: SourceChannel;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  gmailAttachmentId?: string | null;
  whatsappLogId?: string | null;
  driveFileId?: string | null;
  uploadId?: string | null;
  originalFilename?: string | null;
  contentBytes?: Buffer | null;
  contentSha256?: string | null;
};

/**
 * Computes lowercase canonical SHA256 hex digest for binary/text content.
 */
export function computeContentSha256(content: Buffer | string | null | undefined): string | null {
  if (!content) return null;
  const buffer = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  if (buffer.length === 0) return null;
  return createHash("sha256").update(buffer).digest("hex").toLowerCase();
}

/**
 * Builds an immutable, deterministic source key per channel.
 * MUST NOT depend on supplier, amount, date, invoice number, currency, or OCR/AI outputs.
 */
export function buildSourceKey(input: SourceIdentityInput): string {
  const org = input.organizationId.trim();
  switch (input.channel) {
    case "gmail_attachment": {
      const msgId = (input.gmailMessageId ?? "unknown_msg").trim();
      const attId = (input.gmailAttachmentId ?? input.originalFilename ?? "att").trim();
      return `src:gmail_attachment:${org}:${msgId}:${attId}`;
    }
    case "gmail_body": {
      const msgId = (input.gmailMessageId ?? "unknown_msg").trim();
      return `src:gmail_body:${org}:${msgId}`;
    }
    case "whatsapp_media": {
      const logId = (input.whatsappLogId ?? "unknown_log").trim();
      return `src:whatsapp_media:${org}:${logId}`;
    }
    case "camera_upload": {
      const upId = (input.uploadId ?? "unknown_upload").trim();
      return `src:camera_upload:${org}:${upId}`;
    }
    case "drive_file": {
      const fileId = (input.driveFileId ?? "unknown_drive").trim();
      return `src:drive_file:${org}:${fileId}`;
    }
    case "client_gmail": {
      const msgId = (input.gmailMessageId ?? "unknown_msg").trim();
      const attId = (input.gmailAttachmentId ?? "body").trim();
      return `src:client_gmail:${org}:${msgId}:${attId}`;
    }
    default: {
      const keyStr = `${input.gmailMessageId ?? ""}:${input.whatsappLogId ?? ""}:${input.uploadId ?? ""}:${input.driveFileId ?? ""}`;
      return `src:other:${org}:${keyStr || "generic"}`;
    }
  }
}

/**
 * Shadow-only persistence helper for financial source documents.
 * FAIL-OPEN: If database upsert fails, logs a structured error and returns null
 * without corrupting or failing ongoing financial ingestion.
 */
export async function upsertSourceDocumentShadow(input: SourceIdentityInput) {
  const sourceKey = buildSourceKey(input);
  const contentSha256 =
    input.contentSha256?.trim().toLowerCase() ?? computeContentSha256(input.contentBytes);

  try {
    const existing = await prisma.sourceDocument.findUnique({
      where: {
        organizationId_sourceKey: {
          organizationId: input.organizationId,
          sourceKey,
        },
      },
    });

    if (existing) {
      // Safely update hash if it was previously null and is now available
      if (!existing.contentSha256 && contentSha256) {
        const updated = await prisma.sourceDocument.update({
          where: { id: existing.id },
          data: { contentSha256 },
        });
        console.log(`[source-identity] SOURCE_IDENTITY_UPDATED_HASH orgId=${input.organizationId} channel=${input.channel} sourceDocumentId=${updated.id} hash=${Boolean(contentSha256)}`);
        return updated;
      }
      console.log(`[source-identity] SOURCE_IDENTITY_REUSED orgId=${input.organizationId} channel=${input.channel} sourceDocumentId=${existing.id} hash=${Boolean(existing.contentSha256)}`);
      return existing;
    }

    const created = await prisma.sourceDocument.create({
      data: {
        organizationId: input.organizationId,
        channel: input.channel,
        sourceKey,
        contentSha256,
        gmailMessageId: input.gmailMessageId ?? null,
        gmailThreadId: input.gmailThreadId ?? null,
        gmailAttachmentId: input.gmailAttachmentId ?? null,
        whatsappLogId: input.whatsappLogId ?? null,
        driveFileId: input.driveFileId ?? null,
        uploadId: input.uploadId ?? null,
        originalFilename: input.originalFilename ?? null,
      },
    });

    console.log(`[source-identity] SOURCE_IDENTITY_CREATED orgId=${input.organizationId} channel=${input.channel} sourceDocumentId=${created.id} hash=${Boolean(created.contentSha256)}`);
    return created;
  } catch (err) {
    console.error(
      `[source-identity] SOURCE_IDENTITY_SHADOW_ERROR orgId=${input.organizationId} channel=${input.channel} sourceKey=${sourceKey}`,
      err instanceof Error ? err.message : String(err)
    );
    // FAIL-OPEN: return null to ensure current financial ingestion proceeds uninterrupted
    return null;
  }
}
