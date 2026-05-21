const { PrismaClient } = require('@prisma/client');
const { scanNewEmails, downloadAttachment } = require('./gmail');
const { extractFromText, extractFromImage } = require('./aiExtractor');
const { ensureDriveFolder, uploadFileToDrive } = require('./googleDrive');
const { ensureSheet, appendDocumentRow } = require('./googleSheets');
const { logger } = require('../utils/logger');
const { sendWhatsApp } = require('./twilioService');
const crypto = require('crypto');

const prisma = new PrismaClient();

/**
 * Main processing pipeline for a single user.
 * 1. Scan Gmail for new financial emails
 * 2. For each email: extract data → save to Drive → log to Sheets → save to DB
 * Returns summary statistics.
 */
const processUserEmails = async (user) => {
  const stats = { scanned: 0, saved: 0, skipped: 0, errors: 0 };

  try {
    if (!user.accessToken || !user.refreshToken) {
      const message = 'Google credentials unavailable for this user; skipping email scan.';
      logger.warn(message, { userId: user.id });
      await prisma.log.create({
        data: {
          userId: user.id,
          level: 'WARN',
          action: 'SCAN_SKIPPED',
          message,
          metadata: JSON.stringify({ userId: user.id }),
        },
      });
      return stats;
    }

    // Get most recent processed email date
    const lastDoc = await prisma.document.findFirst({
      where: { userId: user.id },
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true },
    });

    const sinceDate = lastDoc?.receivedAt
      ? new Date(lastDoc.receivedAt.getTime() - 60 * 60 * 1000) // 1hr overlap
      : null;

    // 1. Scan Gmail
    const emails = await scanNewEmails(user, sinceDate);
    stats.scanned = emails.length;

    // 2. Ensure Drive folder and Sheet exist
    const [folderId] = await Promise.all([
      ensureDriveFolder(user),
      ensureSheet(user),
    ]);

    // 3. Process each email
    for (const email of emails) {
      try {
        await processEmail(user, email, folderId, stats);
      } catch (err) {
        stats.errors++;
        logger.error('Email processing failed', {
          userId: user.id,
          msgId: email.gmailMessageId,
          error: err.message,
        });
        await prisma.log.create({
          data: {
            userId: user.id,
            level: 'ERROR',
            action: 'PROCESS_EMAIL',
            message: `Failed to process email: ${err.message}`,
            metadata: { gmailMessageId: email.gmailMessageId },
          },
        });
      }
    }

    logger.info('User processing complete', { userId: user.id, stats });

    await prisma.log.create({
      data: {
        userId: user.id,
        level: 'INFO',
        action: 'SCAN_COMPLETE',
        message: `Scan complete: ${stats.saved} saved, ${stats.skipped} skipped, ${stats.errors} errors`,
        metadata: stats,
      },
    });

  } catch (err) {
    logger.error('processUserEmails failed', { userId: user.id, error: err.message });
    stats.errors++;
  }

  return stats;
};

const processEmail = async (user, email, folderId, stats) => {
  // Deduplication check
  const existing = await prisma.document.findUnique({
    where: { gmailMessageId: email.gmailMessageId },
  });

  if (existing) {
    stats.skipped++;
    return;
  }

  // Try to extract from attachments first, then body text
  let extraction = null;
  let driveFileId = null;
  let driveFileUrl = null;

  // Process image/PDF attachments
  for (const att of email.attachments) {
    try {
      const attData = await downloadAttachment(user, email.gmailMessageId, att.attachmentId);
      const base64 = attData.replace(/-/g, '+').replace(/_/g, '/'); // base64url → base64

      // Upload to Drive
      const uploadResult = await uploadFileToDrive(
        user,
        att.filename,
        att.mimeType,
        base64,
        folderId
      );
      driveFileId = uploadResult.fileId;
      driveFileUrl = uploadResult.fileUrl;

      // Extract data from image attachments
      if (att.mimeType.startsWith('image/') || att.mimeType === 'application/pdf') {
        const imgExtraction = await extractFromImage(base64, att.mimeType, email.subject);
        if (imgExtraction.isFinancial && imgExtraction.confidence > 0.4) {
          extraction = imgExtraction;
          break;
        }
      }
    } catch (err) {
      logger.warn('Attachment processing failed', {
        filename: att.filename,
        error: err.message,
      });
    }
  }

  // If no extraction from attachments, try email body
  if (!extraction || extraction.confidence < 0.4) {
    const bodyText = `${email.subject}\n\n${email.bodyText || email.snippet}`;
    const textExtraction = await extractFromText(bodyText, email.subject);

    if (textExtraction.isFinancial) {
      extraction = extraction && extraction.confidence > textExtraction.confidence
        ? extraction
        : textExtraction;
    }
  }

  // Skip non-financial emails
  if (!extraction || !extraction.isFinancial) {
    stats.skipped++;
    return;
  }

  // Save to database
  const doc = await prisma.document.create({
    data: {
      userId: user.id,
      gmailMessageId: email.gmailMessageId,
      emailSubject: email.subject,
      emailSender: email.senderName,
      emailSenderAddr: email.senderEmail,
      receivedAt: email.receivedAt,
      vendorName: extraction.vendorName,
      docType: extraction.docType || 'OTHER',
      invoiceNumber: extraction.invoiceNumber,
      docDate: extraction.docDate ? new Date(extraction.docDate) : null,
      paymentDueDate: extraction.paymentDueDate ? new Date(extraction.paymentDueDate) : null,
      amountPreTax: extraction.amountPreTax,
      taxAmount: extraction.taxAmount,
      totalAmount: extraction.totalAmount,
      currency: extraction.currency || 'ILS',
      status: extraction.suggestedStatus || 'NEW',
      requiresAction: extraction.requiresAction || false,
      aiConfidence: extraction.confidence,
      aiNotes: extraction.notes,
      driveFileId,
      driveFileUrl,
    },
  });

  // If this looks like an invoice/payment request, create a SupplierPayment entry
  try {
    if (doc.docType === 'INVOICE' || doc.docType === 'PAYMENT_REQUEST') {
      // create a deterministic hash to prevent duplicates: vendor|invoiceNumber|totalAmount
      const hashInput = `${doc.vendorName || ''}|${doc.invoiceNumber || ''}|${doc.totalAmount || ''}`;
      const invoiceHash = crypto.createHash('sha256').update(hashInput).digest('hex');

      // Check existing supplier payment by hash
      const existingPayment = await prisma.supplierPayment.findUnique({ where: { invoiceHash } }).catch(() => null);
      if (!existingPayment) {
        const payment = await prisma.supplierPayment.create({
          data: {
            userId: doc.userId,
            supplierName: doc.vendorName,
            amount: doc.totalAmount,
            currency: doc.currency || 'ILS',
            date: doc.docDate,
            dueDate: doc.paymentDueDate,
            paid: doc.status === 'PAID',
            documentId: doc.id,
            driveFileId: doc.driveFileId,
            driveFileUrl: doc.driveFileUrl,
            invoiceLink: doc.driveFileUrl,
            invoiceHash,
          },
        });

        // Create an alert for the user and send WhatsApp if configured
        try {
          const alertMsg = `נמצא חשבונית חדשה מ-${doc.vendorName || 'ספק'} סכום ₪${Math.round(doc.totalAmount || 0)} מספר: ${doc.invoiceNumber || '-'} תאריך: ${doc.docDate ? new Date(doc.docDate).toLocaleDateString('he-IL') : '-'} `;
          await prisma.alert.create({ data: { userId: doc.userId, type: 'NEW_INVOICE', message: alertMsg, metadata: JSON.stringify({ documentId: doc.id, paymentId: payment.id }) } });

          const userRecord = await prisma.user.findUnique({ where: { id: doc.userId } });
          if (userRecord && userRecord.whatsappNumber) {
            await sendWhatsApp(userRecord.whatsappNumber, alertMsg);
          }
        } catch (err) {
          logger.warn('Failed to create alert or send WhatsApp', { docId: doc.id, error: err.message });
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to create supplier payment', { docId: doc.id, error: err.message });
  }

  // Append to Google Sheets
  try {
    const sheetsRow = await appendDocumentRow(user, doc);
    await prisma.document.update({
      where: { id: doc.id },
      data: { sheetsRow },
    });
  } catch (err) {
    logger.warn('Sheets append failed', { docId: doc.id, error: err.message });
  }

  stats.saved++;
  logger.info('Document saved', {
    userId: user.id,
    docId: doc.id,
    vendor: extraction.vendorName,
    total: extraction.totalAmount,
  });
};

module.exports = { processUserEmails, processEmail };
