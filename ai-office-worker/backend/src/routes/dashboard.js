const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/dashboard/stats
router.get('/stats', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const today = new Date(now); today.setHours(0,0,0,0);
    const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);

    const [
      newDocs,
      needsReview,
      upcomingPayments,
      overduePayments,
      totalDue,
      recentDocs,
    ] = await Promise.all([
      prisma.document.count({ where: { userId, status: 'NEW' } }),
      prisma.document.count({ where: { userId, status: 'NEEDS_REVIEW' } }),
      prisma.document.count({
        where: {
          userId,
          paymentDueDate: { gte: today, lte: weekEnd },
          status: { notIn: ['PAID'] },
        },
      }),
      prisma.document.count({ where: { userId, status: 'OVERDUE' } }),
      prisma.document.aggregate({
        where: {
          userId,
          status: { notIn: ['PAID'] },
          totalAmount: { not: null },
        },
        _sum: { totalAmount: true },
      }),
      prisma.document.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          vendorName: true,
          totalAmount: true,
          currency: true,
          status: true,
          requiresAction: true,
          docType: true,
          createdAt: true,
        },
      }),
    ]);

    // Additional V2 metrics
    const [moneyToPayAgg, moneyToReceiveAgg, openTasksCount, alerts, lastScanLog] = await Promise.all([
      prisma.supplierPayment.aggregate({ where: { userId, paid: false }, _sum: { amount: true } }),
      prisma.document.aggregate({ where: { userId, docType: 'RECEIPT', status: { notIn: ['PAID'] }, totalAmount: { not: null } }, _sum: { totalAmount: true } }),
      prisma.task.count({ where: { userId, completed: false } }),
      prisma.alert.findMany({ where: { userId, seen: false }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.log.findFirst({
        where: { userId, action: 'SCAN_COMPLETE' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    let lastScan = null;
    if (lastScanLog?.metadata) {
      try {
        lastScan = JSON.parse(lastScanLog.metadata);
        lastScan.at = lastScanLog.createdAt;
      } catch {
        lastScan = null;
      }
    }

    const moneyToPay = moneyToPayAgg._sum.amount || 0;
    const moneyToReceive = moneyToReceiveAgg._sum.totalAmount || 0;

    res.json({
      stats: {
        newDocs,
        needsReview,
        upcomingPayments,
        overduePayments,
        totalDue: totalDue._sum.totalAmount || 0,
        moneyToPay,
        moneyToReceive,
        openTasks: openTasksCount,
        unansweredMessages: 0,
        hotLeads: 0,
      },
      recentDocs,
      alerts,
      lastScan,
      sheets: {
        invoiceSheetId: req.user.invoiceSheetId || req.user.sheetsId || null,
        invoiceSheetUrl: req.user.invoiceSheetUrl || (req.user.sheetsId ? `https://docs.google.com/spreadsheets/d/${req.user.sheetsId}/edit` : null),
        taskSheetId: req.user.taskSheetId || null,
        taskSheetUrl: req.user.taskSheetUrl || null,
        driveFolderUrl: req.user.driveFolderUrl || (req.user.driveFolder ? `https://drive.google.com/drive/folders/${req.user.driveFolder}` : null),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
