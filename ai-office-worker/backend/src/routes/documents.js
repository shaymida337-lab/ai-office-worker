const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { updateRowStatus } = require('../services/googleSheets');
const { logger } = require('../utils/logger');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/documents - list with filters
router.get('/', authenticate, async (req, res) => {
  try {
    const {
      status, docType, requiresAction, page = '1', limit = '20', search
    } = req.query;

    const where = { userId: req.user.id };
    if (status) where.status = status;
    if (docType) where.docType = docType;
    if (requiresAction !== undefined) where.requiresAction = requiresAction === 'true';
    if (search) {
      where.OR = [
        { vendorName: { contains: search, mode: 'insensitive' } },
        { emailSubject: { contains: search, mode: 'insensitive' } },
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [docs, total] = await Promise.all([
      prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.document.count({ where }),
    ]);

    res.json({ documents: docs, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    logger.error('GET /documents failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/:id
router.get('/:id', authenticate, async (req, res) => {
  const doc = await prisma.document.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.json(doc);
});

// PATCH /api/documents/:id/status
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['NEW', 'PAID', 'OVERDUE', 'NEEDS_REVIEW', 'MISSING_INVOICE'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const updated = await prisma.document.update({
      where: { id: req.params.id },
      data: { status },
    });

    // Update Sheet row too
    if (doc.sheetsRow) {
      await updateRowStatus(req.user, doc.sheetsRow, status).catch(err => {
        logger.warn('Sheet update failed', { error: err.message });
      });
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/documents/:id
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const allowed = [
      'vendorName', 'invoiceNumber', 'docDate', 'paymentDueDate',
      'amountPreTax', 'taxAmount', 'totalAmount', 'currency',
      'requiresAction', 'aiNotes',
    ];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }

    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const updated = await prisma.document.update({
      where: { id: req.params.id },
      data,
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
