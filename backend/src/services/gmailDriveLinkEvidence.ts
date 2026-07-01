/** Strict detection of invoice documents shared via Google Drive links in email bodies. */

const DRIVE_FILE_URL_PATTERN =
  /https?:\/\/drive\.google\.com\/(?:open\?id=|file\/d\/|uc\?(?:export=download&)?id=)([a-zA-Z0-9_-]{10,})/gi;

const STRICT_INVOICE_TEXT_PATTERN =
  /(?:חשבונית(?:\s*מס)?|tax\s+invoice|green\s*invoice|invoice|receipt|קבלה|חשבונית\s*מס\s*קבלה|דרישת\s*תשלום|payment\s+request)/i;

const DOCUMENT_FILENAME_PATTERN = /([^\s<>\r\n"'\\|]{1,240}\.(?:pdf|png|jpe?g|webp|heic|heif))/i;

export type DriveLinkDocumentKind = "pdf" | "image" | "unknown";

export type GmailDriveLinkCandidate = {
  url: string;
  fileId: string | null;
  inferredFilename: string | null;
  documentKind: DriveLinkDocumentKind;
};

export type GmailDriveLinkInvoiceEvidence = {
  links: GmailDriveLinkCandidate[];
  virtualAttachmentFilenames: string[];
  hasStrictDriveInvoiceEvidence: boolean;
};

function documentKindFromFilename(filename: string | null): DriveLinkDocumentKind {
  if (!filename) return "unknown";
  if (/\.pdf$/i.test(filename)) return "pdf";
  if (/\.(png|jpe?g|webp|heic|heif)$/i.test(filename)) return "image";
  return "unknown";
}

function inferFilenameNearLink(text: string, linkStart: number): string | null {
  const before = text
    .slice(Math.max(0, linkStart - 300), linkStart)
    .replace(/<+\s*$/g, "");
  const beforeMatches = [...before.matchAll(/([^\s<>\r\n"'\\|]{1,240}\.(?:pdf|png|jpe?g|webp|heic|heif))\s*$/gi)];
  if (beforeMatches.length > 0) {
    return beforeMatches[beforeMatches.length - 1][1] ?? null;
  }

  const after = text.slice(linkStart, Math.min(text.length, linkStart + 160));
  const afterMatch = after.match(
    /^[^(\r\n]*\)?\s*(?:<[^>]+>\s*)?([^\s<>\r\n"'\\|]{1,240}\.(?:pdf|png|jpe?g|webp|heic|heif))/i,
  );
  return afterMatch?.[1] ?? null;
}

export function hasStrictInvoiceTextEvidence(subject: string, bodyText: string): boolean {
  return STRICT_INVOICE_TEXT_PATTERN.test(`${subject}\n${bodyText}`);
}

export function extractGoogleDriveFileLinks(text: string): GmailDriveLinkCandidate[] {
  const links: GmailDriveLinkCandidate[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(DRIVE_FILE_URL_PATTERN)) {
    const url = match[0];
    const fileId = match[1] ?? null;
    const dedupeKey = fileId ?? url;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const linkStart = match.index ?? 0;
    const inferredFilename = inferFilenameNearLink(text, linkStart);
    links.push({
      url,
      fileId,
      inferredFilename,
      documentKind: documentKindFromFilename(inferredFilename),
    });
  }

  return links;
}

export function evaluateGmailDriveLinkInvoiceEvidence(input: {
  subject: string;
  bodyText: string;
}): GmailDriveLinkInvoiceEvidence {
  const links = extractGoogleDriveFileLinks(input.bodyText);
  const invoiceTextEvidence = hasStrictInvoiceTextEvidence(input.subject, input.bodyText);
  const documentLinks = links.filter((link) => link.documentKind !== "unknown");
  const virtualAttachmentFilenames = documentLinks
    .map((link) => link.inferredFilename)
    .filter((filename): filename is string => Boolean(filename));

  return {
    links,
    virtualAttachmentFilenames,
    hasStrictDriveInvoiceEvidence: invoiceTextEvidence && documentLinks.length > 0,
  };
}

export function shouldRejectPersonalEmailWithoutDocumentEvidence(input: {
  isPersonalSender: boolean;
  hasPdfOrImageAttachment: boolean;
  strictPaymentEvidence: boolean;
  driveEvidence: GmailDriveLinkInvoiceEvidence;
}): boolean {
  if (!input.isPersonalSender) return false;
  if (input.hasPdfOrImageAttachment) return false;
  if (input.strictPaymentEvidence) return false;
  if (input.driveEvidence.hasStrictDriveInvoiceEvidence) return false;
  return true;
}

export function bodyMentionsDocumentFilename(bodyText: string): boolean {
  return DOCUMENT_FILENAME_PATTERN.test(bodyText);
}
