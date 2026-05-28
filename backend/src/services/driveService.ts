import { Readable } from "node:stream";
import type { drive_v3 } from "googleapis";
import { config } from "../lib/config.js";

export type UploadedDriveFile = {
  fileId: string | null;
  webViewLink: string;
};

export const INVOICE_DRIVE_FOLDER_NAME = `${config.driveRootFolder} - חשבוניות`;

export async function ensureDriveFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId?: string
): Promise<string> {
  const escapedName = escapeDriveQueryValue(name);
  const q = parentId
    ? `name='${escapedName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    : `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const existing = await drive.files.list({
    q,
    fields: "files(id)",
    pageSize: 1,
  });
  const existingId = existing.data.files?.[0]?.id;
  if (existingId) return existingId;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    },
    fields: "id",
  });

  if (!created.data.id) {
    throw new Error(`Failed to create Google Drive folder: ${name}`);
  }

  return created.data.id;
}

export async function ensureInvoiceFolderTree(
  drive: drive_v3.Drive
): Promise<string> {
  const rootId = await ensureDriveFolder(drive, INVOICE_DRIVE_FOLDER_NAME);
  for (const folderName of ["Invoices", "Receipts", "Payment Requests", "Missing Invoices", "Other"]) {
    await ensureDriveFolder(drive, folderName, rootId);
  }
  return rootId;
}

export async function uploadInvoiceAttachmentToDrive(input: {
  drive: drive_v3.Drive;
  rootFolderId: string;
  supplier: string;
  documentType: string;
  filename: string;
  mimeType?: string | null;
  receivedAt: Date;
  buffer: Buffer;
}): Promise<UploadedDriveFile> {
  const folderType = folderForDocumentType(input.documentType);
  const typeFolderId = await ensureDriveFolder(input.drive, folderType, input.rootFolderId);
  const supplierFolderId = await ensureDriveFolder(
    input.drive,
    safeFolderName(input.supplier),
    typeFolderId
  );

  const upload = await input.drive.files.create({
    requestBody: {
      name: `${input.receivedAt.toISOString().slice(0, 10)}_${input.filename}`,
      parents: [supplierFolderId],
    },
    media: {
      mimeType: input.mimeType ?? "application/octet-stream",
      body: Readable.from(input.buffer),
    },
    fields: "id, webViewLink",
  });

  const fileId = upload.data.id ?? null;
  return {
    fileId,
    webViewLink:
      upload.data.webViewLink ??
      (fileId ? `https://drive.google.com/file/d/${fileId}/view` : ""),
  };
}

export function folderForDocumentType(documentType: string): string {
  switch (documentType) {
    case "invoice":
      return "Invoices";
    case "receipt":
      return "Receipts";
    case "payment_request":
      return "Payment Requests";
    default:
      return "Other";
  }
}

export function safeFolderName(name: string): string {
  return (name || "Unknown Supplier").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
