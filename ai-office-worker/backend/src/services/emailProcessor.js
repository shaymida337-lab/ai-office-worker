const { PrismaClient } = require('@prisma/client');
const pdfParse = require('pdf-parse');
const { scanNewEmails, downloadAttachment } = require('./gmail');
const { extractFromText, extractFromImage, analyzeEmailForTask, priorityToInt } = require('./aiExtractor');
const { ensureUserDriveRoot, uploadInvoiceAttachmentToDrive, folderForDocumentType } = require('./driveService');
const { writeInvoiceToSheet, writeTaskToSheet, getDriveFolderUrl } = require('./sheetsService');
const { createPaymentFromDocument } = require('./supplierPayments');
const { logger } = require('../utils/logger');

const prisma = new PrismaClient();

const formatDateHe = (date) =>
  date ? new Date(date).toLocaleDateString('he-IL') : '';

const formatDateIso = (date) => {
  if (!date) return '';
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

/**
 * Main processing pipeline for a single user.
 */
const processUserEmails = async (user) => {
  const stats = {
    scanned: 0,
    saved: 0,
    tasksCreated: 0,
    skipped: 0,
    errors: 0,
    invoicesWritten: 0,
    tasksWritten: 0,
  };

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

    const lastDoc = await prisma.document.findFirst({
      where: { userId: user.id },
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true },
    });

    const sinceDate = lastDoc?.receivedAt
      ? new Date(lastDoc.receivedAt.getTime() - 60 * 60 * 1000)
      : null;

    const emails = await scanNewEmails(user, sinceDate);
    stats.scanned = emails.length;

    const folderId = await ensureUserDriveRoot(user);

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
            metadata: JSON.stringify({ gmailMessageId: email.gmailMessageId }),
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
        message: `Scan complete: ${stats.saved} invoices, ${stats.tasksCreated} tasks, ${stats.skipped} skipped`,
        metadata: JSON.stringify(stats),
      },
    });
  } catch (err) {
    logger.error('processUserEmails failed', { userId: user.id, error: err.message });
    stats.errors++;
  }

  return stats;
};

const processEmail = async (user, email, folderId, stats) => {
  const existingDoc = await prisma.document.findUnique({
    where: { gmailMessageId: email.gmailMessageId },
  });
  const existingTask = await prisma.task.findUnique({
    where: { gmailMessageId: email.gmailMessageId },
  });

  if (existingDoc || existingTask) {
    stats.skipped++;
    return;
  }

  let extraction = null;
  let driveFileId = null;
  let driveFileUrl = null;
  let documentType = 'other';

  for (const att of email.attachments) {
    try {
      const attData = await downloadAttachment(user, email.gmailMessageId, att.attachmentId);
      const base64 = attData.replace(/-/g, '+').replace(/_/g, '/');
      const buffer = Buffer.from(base64, 'base64');

      if (att.mimeType.startsWith('image/')) {
        const imgExtraction = await extractFromImage(base64, att.mimeType, email.subject);
        if (imgExtraction.isFinancial && imgExtraction.confidence > 0.4) {
          extraction = imgExtraction;
          documentType = (imgExtraction.docType || 'OTHER').toLowerCase();
        }
      }

      if (att.mimeType === 'application/pdf') {
        try {
          const pdfData = await pdfParse(buffer);
          if (pdfData.text?.trim()) {
            const pdfExtraction = await extractFromText(pdfData.text, email.subject);
            if (pdfExtraction.isFinancial && pdfExtraction.confidence > 0.4) {
              extraction = pdfExtraction;
              documentType = (pdfExtraction.docType || 'OTHER').toLowerCase();
            }
          }
        } catch {
          const imgExtraction = await extractFromImage(base64, att.mimeType, email.subject);
          if (imgExtraction.isFinancial && imgExtraction.confidence > 0.4) {
            extraction = imgExtraction;
            documentType = (imgExtraction.docType || 'OTHER').toLowerCase();
          }
        }
      }

      if (extraction?.isFinancial) {
        const uploadResult = await uploadInvoiceAttachmentToDrive(user, {
          rootFolderId: folderId,
          supplier: extraction.vendorName || email.senderName || email.senderEmail || 'Unknown Supplier',
          documentType,
          filename: att.filename,
          mimeType: att.mimeType,
          receivedAt: email.receivedAt,
          buffer,
        });
        driveFileId = uploadResult.fileId;
        driveFileUrl = uploadResult.webViewLink;
        break;
      }
    } catch (err) {
      logger.warn('Attachment processing failed', { filename: att.filename, error: err.message });
    }
  }

  if (!extraction || extraction.confidence < 0.4) {
    const bodyText = `${email.subject}\n\n${email.bodyText || email.snippet}`;
    const textExtraction = await extractFromText(bodyText, email.subject);
    if (textExtraction.isFinancial) {
      extraction = textExtraction;
      documentType = (textExtraction.docType || 'OTHER').toLowerCase();
    }
  }

  if (extraction?.isFinancial && extraction.confidence >= 0.4) {
    await saveInvoiceEmail(user, email, extraction, driveFileId, driveFileUrl, folderId, stats);
    return;
  }

  const taskAnalysis = await analyzeEmailForTask(email);
  if (!taskAnalysis.isActionable) {
    stats.skipped++;
    return;
  }

  const taskTitle = taskAnalysis.requiredAction || taskAnalysis.summary || email.subject || 'משימה חדשה';
  const dueDate = taskAnalysis.suggestedDueDate
    ? new Date(taskAnalysis.suggestedDueDate)
    : null;

  const task = await prisma.task.create({
    data: {
      userId: user.id,
      gmailMessageId: email.gmailMessageId,
      title: taskTitle.slice(0, 200),
      details: taskAnalysis.summary || null,
      emailSender: email.senderName || email.senderEmail,
      emailSubject: email.subject,
      priority: priorityToInt(taskAnalysis.priority),
      dueDate: dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null,
    },
  });

  try {
    const sheetsRow = await writeTaskToSheet(user.id, {
      date: formatDateHe(email.receivedAt),
      from: email.senderName || email.senderEmail || '',
      subject: email.subject || '',
      summary: taskAnalysis.summary || '',
      action: taskAnalysis.requiredAction || '',
      priority: taskAnalysis.priority || 'בינוני',
      dueDate: formatDateIso(taskAnalysis.suggestedDueDate),
      status: 'פתוח',
    });
    if (sheetsRow) {
      await prisma.task.update({ where: { id: task.id }, data: { sheetsRow } });
      stats.tasksWritten++;
    }
  } catch (err) {
    logger.warn('Task sheet write failed', { taskId: task.id, error: err.message });
  }

  stats.tasksCreated++;
};

const saveInvoiceEmail = async (user, email, extraction, driveFileId, driveFileUrl, folderId, stats) => {
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

  try {
    await createPaymentFromDocument(doc);
  } catch (err) {
    logger.warn('Failed to create supplier payment', { docId: doc.id, error: err.message });
  }

  const driveFolderUrl = getDriveFolderUrl(user);
  const invoiceStatus = extraction.suggestedStatus === 'PAID'
    ? 'שולם'
    : extraction.suggestedStatus === 'OVERDUE'
      ? 'באיחור'
      : 'ממתין';

  try {
    const sheetsRow = await writeInvoiceToSheet(user.id, {
      date: formatDateHe(email.receivedAt),
      supplier: extraction.vendorName || email.senderName || email.senderEmail || '',
      amount: extraction.totalAmount ?? '',
      currency: extraction.currency || 'ILS',
      driveFileUrl: driveFileUrl || '',
      driveFolderUrl,
      emailSubject: email.subject || '',
      status: invoiceStatus,
      notes: extraction.notes || '',
    });
    if (sheetsRow) {
      await prisma.document.update({ where: { id: doc.id }, data: { sheetsRow } });
      stats.invoicesWritten++;
    }
  } catch (err) {
    logger.warn('Invoice sheet write failed', { docId: doc.id, error: err.message });
  }

  stats.saved++;
  logger.info('Document saved', {
    userId: user.id,
    docId: doc.id,
    vendor: extraction.vendorName,
    total: extraction.totalAmount,
    folderType: folderForDocumentType((extraction.docType || 'OTHER').toLowerCase()),
  });
};

module.exports = { processUserEmails, processEmail };
