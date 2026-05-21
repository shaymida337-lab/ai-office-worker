const express = require('express');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
const prisma = new PrismaClient();

router.get('/live', async (req, res) => {
  try {
    const user = await prisma.user.findFirst({ where: { isActive: true } });
    if (!user) return res.status(404).json({ error: 'No active user found' });

    const [payments, docs, alerts, tasks] = await Promise.all([
      prisma.supplierPayment.findMany({ where: { userId: user.id }, orderBy: { dueDate: 'asc' } }),
      prisma.document.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.alert.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.task.findMany({ where: { userId: user.id }, orderBy: { priority: 'asc' }, take: 10 }),
    ]);

    const moneyToPay = payments.filter(p => !p.paid).reduce((sum, p) => sum + (p.amount || 0), 0);
    const moneyToReceive = docs.filter(d => d.docType === 'RECEIPT' && d.totalAmount).reduce((sum, d) => sum + (d.totalAmount || 0), 0);
    const openTasks = tasks.filter(t => !t.completed).length;
    const missingInvoices = docs.filter(d => d.status === 'MISSING_INVOICE').length;
    const upcoming = payments.filter(p => !p.paid && p.dueDate && new Date(p.dueDate) >= new Date()).length;

    res.json({
      stats: { moneyToPay, moneyToReceive, openTasks, missingInvoices, upcoming },
      payments,
      documents: docs,
      alerts,
      tasks,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
