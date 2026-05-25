import { Readable } from "node:stream";
import type { drive_v3 } from "googleapis";
import { config } from "../lib/config.js";
import { ensureDriveFolder, safeFolderName } from "./driveService.js";
import type { InvoiceData } from "./invoiceExtractor.js";

export async function saveInvoiceToDrive(
  drive: drive_v3.Drive,
  invoice: InvoiceData,
  pdfBuffer: Buffer,
  organizationId: string
) {
  const invoiceDate = new Date(invoice.date);
  const safeDate = Number.isNaN(invoiceDate.getTime()) ? new Date() : invoiceDate;
  const folderParts = [
    config.driveRootFolder,
    safeFolderName(invoice.clientName || organizationId),
    String(safeDate.getFullYear()),
    String(safeDate.getMonth() + 1).padStart(2, "0"),
  ];

  let parentId: string | undefined;
  for (const folder of folderParts) {
    parentId = await ensureDriveFolder(drive, folder, parentId);
  }

  const invoiceNumber = safeFolderName(invoice.invoiceNumber || "unknown");
  const fileName = `חשבונית_${invoiceNumber}_${safeDate.toISOString().slice(0, 10)}.pdf`;
  const upload = await drive.files.create({
    requestBody: { name: fileName, parents: parentId ? [parentId] : undefined },
    media: { mimeType: "application/pdf", body: Readable.from(pdfBuffer) },
    fields: "id, webViewLink",
  });

  const fileId = upload.data.id ?? null;
  return {
    fileId,
    webViewLink: upload.data.webViewLink ?? (fileId ? `https://drive.google.com/file/d/${fileId}/view` : ""),
    folderId: parentId ?? null,
  };
}
