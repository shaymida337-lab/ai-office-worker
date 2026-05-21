const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { processUserEmails, processEmail } = require('../services/emailProcessor');
const { runEmailScan } = require('../jobs/scheduler');
const { logger } = require('../utils/logger');

const router = express.Router();
const prisma = new PrismaClient();

// POST /api/scan/now - trigger manual scan for current user
router.post('/now', authenticate, async (req, res) => {
  try {
    logger.info('Manual scan triggered', { userId: req.user.id });

    if (!req.user.accessToken || !req.user.refreshToken) {
      return res.status(400).json({
        error: 'Google scanning is unavailable for local-only users. Use the demo scan or configure Google credentials.',
      });
    }

    // Run in background, respond immediately
    res.json({ success: true, message: 'Scan started. Check back in a minute.' });

    // Run async
    processUserEmails(req.user).then(stats => {
      logger.info('Manual scan complete', { userId: req.user.id, stats });
    }).catch(err => {
      logger.error('Manual scan failed', { userId: req.user.id, error: err.message });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/scan/logs - recent activity logs for current user
router.get('/logs', authenticate, async (req, res) => {
  try {
    const logs = await prisma.log.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DEMO: process a sample invoice email for first active user
router.post('/demo', async (req, res) => {
  try {
    const user = await prisma.user.findFirst({ where: { isActive: true } });
    if (!user) return res.status(400).json({ error: 'No active user found' });

    const stats = { scanned: 1, saved: 0, skipped: 0, errors: 0 };

    const sampleEmail = {
      gmailMessageId: `demo-${Date.now()}`,
      subject: 'חשבונית מס/קבלה - חשבונית 12345',
      senderName: 'ספק דמה',
      senderEmail: 'supplier@example.com',
      receivedAt: new Date(),
      bodyText: 'סכום לתשלום: 3,450.00 ILS\nתאריך חשבונית: 2026-05-01\nתאריך לתשלום: 2026-05-30\nמספר חשבונית: INV-12345',
      snippet: 'חשבונית INV-12345 סכום ₪3,450',
      attachments: [],
    };

    await processEmail(user, sampleEmail, null, stats);

    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
