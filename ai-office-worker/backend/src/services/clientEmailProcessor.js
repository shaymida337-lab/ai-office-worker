const { PrismaClient } = require('@prisma/client');
const pdfParse = require('pdf-parse');
const { scanNewEmailsForClient, downloadAttachmentForClient } = require('./gmail');
const { extractFromText, extractFromImage, analyzeEmailForTask, priorityToInt } = require('./aiExtractor');
const { ensureClientDriveRoot, uploadInvoiceAttachmentForClient } = require('./driveService');
const { writeInvoiceToSheetForClient, writeTaskToSheetForClient, getDriveFolderUrlForClient } = require('./sheetsService');
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

const priorityLabel = (priorityInt) => {
  if (priorityInt === 1) return 'גבוה';
  if (priorityInt === 3) return 'נמוך';
  return 'בינוני';
};

const processClientEmails = async (client) => {
  const stats = {
    clientId: client.id,
    clientName: client.name,
    scanned: 0,
    saved: 0,
    tasksCreated: 0,
    skipped: 0,
    errors: 0,
    invoicesWritten: 0,
    tasksWritten: 0,
  };

  if (!client.gmailConnected || !client.googleAccessToken || !client.googleRefreshToken) {
    stats.errors++;
    return stats;
  }

  try {
    const lastDoc = await prisma.document.findFirst({
      where: { clientId: client.id },
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true },
    });

    const sinceDate = lastDoc?.receivedAt
      ? new Date(lastDoc.receivedAt.getTime() - 60 * 60 * 1000)
      : null;

    const emails = await scanNewEmailsForClient(client, sinceDate, true);
    stats.scanned = emails.length;

    const folderId = await ensureClientDriveRoot(client);

    for (const email of emails) {
      try {
        await processClientEmail(client, email, folderId, stats);
      } catch (err) {
        stats.errors++;
        logger.error('Client email processing failed', {
          clientId: client.id,
          msgId: email.gmailMessageId,
          error: err.message,
        });
      }
    }

    await prisma.log.create({
      data: {
        userId: client.userId,
        level: 'INFO',
        action: 'CLIENT_SCAN_COMPLETE',
        message: `${client.name}: ${stats.saved} invoices, ${stats.tasksCreated} tasks`,
        metadata: JSON.stringify(stats),
      },
    });
  } catch (err) {
    logger.error('processClientEmails failed', { clientId: client.id, error: err.message });
    stats.errors++;
  }

  return stats;
};

const processClientEmail = async (client, email, folderId, stats) => {
  const existingDoc = await prisma.document.findFirst({
    where: { clientId: client.id, gmailMessageId: email.gmailMessageId },
  });
  const existingTask = await prisma.task.findFirst({
    where: { clientId: client.id, gmailMessageId: email.gmailMessageId },
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
      const attData = await downloadAttachmentForClient(client, email.gmailMessageId, att.attachmentId);
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
        const uploadResult = await uploadInvoiceAttachmentForClient(client, {
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
      logger.warn('Client attachment failed', { clientId: client.id, error: err.message });
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
    await saveClientInvoice(client, email, extraction, driveFileId, driveFileUrl, stats);
    return;
  }

  const taskAnalysis = await analyzeEmailForTask(email);
  if (!taskAnalysis.isActionable) {
    stats.skipped++;
    return;
  }

  const taskTitle = taskAnalysis.requiredAction || taskAnalysis.summary || email.subject || 'משימה חדשה';
  const dueDate = taskAnalysis.suggestedDueDate ? new Date(taskAnalysis.suggestedDueDate) : null;
  const priority = priorityToInt(taskAnalysis.priority);

  const task = await prisma.task.create({
    data: {
      userId: client.userId,
      clientId: client.id,
      gmailMessageId: email.gmailMessageId,
      title: taskTitle.slice(0, 200),
      action: taskAnalysis.requiredAction || null,
      details: taskAnalysis.summary || null,
      emailSender: email.senderName || email.senderEmail,
      emailSubject: email.subject,
      priority,
      status: 'פתוח',
      dueDate: dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null,
    },
  });

  try {
    const sheetsRow = await writeTaskToSheetForClient(client.id, {
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
    logger.warn('Client task sheet write failed', { taskId: task.id, error: err.message });
  }

  stats.tasksCreated++;
};

const saveClientInvoice = async (client, email, extraction, driveFileId, driveFileUrl, stats) => {
  const doc = await prisma.document.create({
    data: {
      userId: client.userId,
      clientId: client.id,
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
    logger.warn('Client payment create failed', { docId: doc.id, error: err.message });
  }

  const invoiceStatus = extraction.suggestedStatus === 'PAID'
    ? 'שולם'
    : extraction.suggestedStatus === 'OVERDUE'
      ? 'באיחור'
      : 'ממתין';

  try {
    const sheetsRow = await writeInvoiceToSheetForClient(client.id, {
      date: formatDateHe(email.receivedAt),
      supplier: extraction.vendorName || email.senderName || email.senderEmail || '',
      amount: extraction.totalAmount ?? '',
      currency: extraction.currency || 'ILS',
      driveFileUrl: driveFileUrl || '',
      driveFolderUrl: getDriveFolderUrlForClient(client),
      emailSubject: email.subject || '',
      status: invoiceStatus,
      notes: extraction.notes || '',
    });
    if (sheetsRow) {
      await prisma.document.update({ where: { id: doc.id }, data: { sheetsRow } });
      stats.invoicesWritten++;
    }
  } catch (err) {
    logger.warn('Client invoice sheet write failed', { docId: doc.id, error: err.message });
  }

  stats.saved++;
};

module.exports = { processClientEmails, processClientEmail };
