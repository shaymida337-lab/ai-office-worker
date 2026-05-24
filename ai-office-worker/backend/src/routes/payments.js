const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const {
  syncPaymentStatusToDocument,
  getSuppliersSummary,
} = require('../services/supplierPayments');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/payments - list payments with optional status filter
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { paid } = req.query;
    const where = { userId };
    if (paid === 'true') where.paid = true;
    if (paid === 'false') where.paid = false;

    const payments = await prisma.supplierPayment.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      take: 200,
    });

    res.json({ payments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payments/suppliers - aggregated supplier summary
router.get('/suppliers', authenticate, async (req, res) => {
  try {
    const suppliers = await getSuppliersSummary(req.user.id);
    res.json({ suppliers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/payments/:id/paid - mark as paid/unpaid
router.patch('/:id/paid', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { paid } = req.body;

    const payment = await prisma.supplierPayment.findFirst({
      where: { id, userId },
    });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    await prisma.supplierPayment.update({
      where: { id },
      data: { paid: !!paid },
    });

    if (payment.documentId) {
      await syncPaymentStatusToDocument(payment.documentId, !!paid);
    }

    res.json({ updated: 1, paid: !!paid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payments/missing-invoices - list documents flagged as missing invoices
router.get('/missing-invoices', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const docs = await prisma.document.findMany({ where: { userId, status: 'MISSING_INVOICE' } });
    res.json({ docs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
