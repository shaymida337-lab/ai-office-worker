import type { drive_v3 } from "googleapis";
import { ensureInvoiceFolderTree, uploadInvoiceAttachmentToDrive } from "./driveService.js";
import type { InvoiceData } from "./invoiceExtractor.js";

export async function saveInvoiceToDrive(
  drive: drive_v3.Drive,
  invoice: InvoiceData,
  pdfBuffer: Buffer,
  organizationId: string
) {
  const invoiceDate = new Date(invoice.date);
  const safeDate = Number.isNaN(invoiceDate.getTime()) ? new Date() : invoiceDate;
  const rootFolderId = await ensureInvoiceFolderTree(drive);
  const upload = await uploadInvoiceAttachmentToDrive({
    organizationId,
    drive,
    rootFolderId,
    clientName: invoice.clientName,
    supplier: invoice.supplierName ?? "לא מזוהה",
    documentType: "invoice",
    filename: "invoice.pdf",
    mimeType: "application/pdf",
    receivedAt: safeDate,
    documentDate: safeDate,
    invoiceNumber: invoice.invoiceNumber,
    amount: invoice.amount,
    totalAmount: invoice.amount,
    buffer: pdfBuffer,
  });

  return {
    fileId: upload.fileId,
    webViewLink: upload.webViewLink,
    folderId: upload.folderId,
    folderPath: upload.folderPath,
  };
}
