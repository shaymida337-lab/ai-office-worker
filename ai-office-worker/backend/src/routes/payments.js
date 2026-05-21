const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

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

// PATCH /api/payments/:id/paid - mark as paid/unpaid
router.patch('/:id/paid', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { paid } = req.body;

    const payment = await prisma.supplierPayment.updateMany({
      where: { id, userId },
      data: { paid: !!paid },
    });

    res.json({ updated: payment.count });
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
