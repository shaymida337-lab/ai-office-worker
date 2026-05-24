const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');
const { sendWhatsApp } = require('./twilioService');

const prisma = new PrismaClient();

const PAYMENT_DOC_TYPES = new Set(['INVOICE', 'PAYMENT_REQUEST']);

const buildInvoiceHash = (userId, vendorName, invoiceNumber, totalAmount) => {
  const hashInput = `${userId}|${vendorName || ''}|${invoiceNumber || ''}|${totalAmount || ''}`;
  return crypto.createHash('sha256').update(hashInput).digest('hex');
};

const createPaymentFromDocument = async (doc) => {
  if (!PAYMENT_DOC_TYPES.has(doc.docType)) return null;

  const invoiceHash = buildInvoiceHash(doc.userId, doc.vendorName, doc.invoiceNumber, doc.totalAmount);

  const existing = await prisma.supplierPayment.findFirst({
    where: { userId: doc.userId, invoiceHash },
  });

  if (existing) {
    if (!existing.documentId) {
      return prisma.supplierPayment.update({
        where: { id: existing.id },
        data: {
          documentId: doc.id,
          driveFileId: doc.driveFileId,
          driveFileUrl: doc.driveFileUrl,
          invoiceLink: doc.driveFileUrl,
        },
      });
    }
    return existing;
  }

  const payment = await prisma.supplierPayment.create({
    data: {
      userId: doc.userId,
      clientId: doc.clientId || null,
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

  try {
    const alertMsg = `נמצאה חשבונית חדשה מ-${doc.vendorName || 'ספק'} — סכום ₪${Math.round(doc.totalAmount || 0)}, מספר: ${doc.invoiceNumber || '-'}, תאריך: ${doc.docDate ? new Date(doc.docDate).toLocaleDateString('he-IL') : '-'}`;
    await prisma.alert.create({
      data: {
        userId: doc.userId,
        type: 'NEW_INVOICE',
        message: alertMsg,
        metadata: JSON.stringify({ documentId: doc.id, paymentId: payment.id }),
      },
    });

    const userRecord = await prisma.user.findUnique({ where: { id: doc.userId } });
    if (userRecord?.whatsappNumber) {
      await sendWhatsApp(userRecord.whatsappNumber, alertMsg);
    }
  } catch (err) {
    logger.warn('Failed to create alert or send WhatsApp', { docId: doc.id, error: err.message });
  }

  return payment;
};

const syncDocumentStatusToPayments = async (documentId, status) => {
  const paid = status === 'PAID';
  await prisma.supplierPayment.updateMany({
    where: { documentId },
    data: { paid },
  });
};

const syncPaymentStatusToDocument = async (documentId, paid) => {
  if (!documentId) return;
  await prisma.document.update({
    where: { id: documentId },
    data: { status: paid ? 'PAID' : 'NEW' },
  });
};

const getSuppliersSummary = async (userId) => {
  const payments = await prisma.supplierPayment.findMany({
    where: { userId },
    select: {
      supplierName: true,
      amount: true,
      paid: true,
      dueDate: true,
    },
  });

  const suppliers = {};
  for (const payment of payments) {
    const name = payment.supplierName || 'לא ידוע';
    if (!suppliers[name]) {
      suppliers[name] = { name, total: 0, unpaid: 0, paid: 0, count: 0 };
    }
    suppliers[name].count += 1;
    suppliers[name].total += payment.amount || 0;
    if (payment.paid) {
      suppliers[name].paid += payment.amount || 0;
    } else {
      suppliers[name].unpaid += payment.amount || 0;
    }
  }

  return Object.values(suppliers).sort((a, b) => b.unpaid - a.unpaid);
};

module.exports = {
  PAYMENT_DOC_TYPES,
  buildInvoiceHash,
  createPaymentFromDocument,
  syncDocumentStatusToPayments,
  syncPaymentStatusToDocument,
  getSuppliersSummary,
};
