const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { authenticateOrQueryToken } = require('../middleware/clientAuth');
const { processClientEmails } = require('../services/clientEmailProcessor');
const { parseSheetIdFromUrl, parseFolderIdFromUrl } = require('../services/sheetsService');
const { getClientGmailRedirectUri } = require('../utils/googleOAuth');
const { logger } = require('../utils/logger');

const router = express.Router();
const prisma = new PrismaClient();

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
];

const CLIENT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

const frontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:3000';

const createClientOAuthState = (clientId, userId) => jwt.sign(
  { purpose: 'client_gmail', clientId, userId, nonce: crypto.randomBytes(16).toString('hex') },
  process.env.JWT_SECRET,
  { expiresIn: '15m' },
);

const verifyClientOAuthState = (state) => {
  try {
    const decoded = jwt.verify(state, process.env.JWT_SECRET);
    if (decoded.purpose !== 'client_gmail') return null;
    return decoded;
  } catch {
    return null;
  }
};

const getClientStats = async (clientId) => {
  const [invoices, tasks, toPay, missing] = await Promise.all([
    prisma.document.count({ where: { clientId } }),
    prisma.task.count({ where: { clientId, completed: false } }),
    prisma.supplierPayment.aggregate({
      where: { clientId, paid: false },
      _sum: { amount: true },
    }),
    prisma.document.count({ where: { clientId, status: 'MISSING_INVOICE' } }),
  ]);

  return {
    invoices,
    openTasks: tasks,
    toPay: toPay._sum.amount || 0,
    missingInvoices: missing,
  };
};

const sanitizeClient = (client, stats) => ({
  id: client.id,
  name: client.name,
  email: client.email,
  color: client.color,
  gmailConnected: client.gmailConnected,
  invoiceSheetUrl: client.invoiceSheetUrl,
  taskSheetUrl: client.taskSheetUrl,
  driveFolderUrl: client.driveFolderUrl,
  isActive: client.isActive,
  createdAt: client.createdAt,
  stats,
});

// GET /api/clients
router.get('/', authenticate, async (req, res) => {
  try {
    const clients = await prisma.client.findMany({
      where: { userId: req.user.id, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    const withStats = await Promise.all(
      clients.map(async (client) => sanitizeClient(client, await getClientStats(client.id)))
    );

    const totals = withStats.reduce(
      (acc, c) => ({
        toPay: acc.toPay + (c.stats?.toPay || 0),
        openTasks: acc.openTasks + (c.stats?.openTasks || 0),
        invoices: acc.invoices + (c.stats?.invoices || 0),
        missingInvoices: acc.missingInvoices + (c.stats?.missingInvoices || 0),
      }),
      { toPay: 0, openTasks: 0, invoices: 0, missingInvoices: 0 }
    );

    res.json({ clients: withStats, totals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, email, color, invoiceSheetUrl, taskSheetUrl, driveFolderUrl } = req.body;
    if (!name?.trim() || !email?.trim()) {
      return res.status(400).json({ error: 'שם ואימייל נדרשים' });
    }

    const count = await prisma.client.count({ where: { userId: req.user.id } });
    const client = await prisma.client.create({
      data: {
        userId: req.user.id,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        color: color || CLIENT_COLORS[count % CLIENT_COLORS.length],
        invoiceSheetUrl: invoiceSheetUrl?.trim() || null,
        invoiceSheetId: invoiceSheetUrl ? parseSheetIdFromUrl(invoiceSheetUrl) : null,
        taskSheetUrl: taskSheetUrl?.trim() || null,
        taskSheetId: taskSheetUrl ? parseSheetIdFromUrl(taskSheetUrl) : null,
        driveFolderUrl: driveFolderUrl?.trim() || null,
        driveFolderId: driveFolderUrl ? parseFolderIdFromUrl(driveFolderUrl) : null,
      },
    });

    res.status(201).json({ client: sanitizeClient(client, await getClientStats(client.id)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/gmail/callback (must be before /:clientId)
router.get('/gmail/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) {
      return res.redirect(`${frontendUrl()}/dashboard/clients?error=oauth_denied`);
    }

    const decoded = verifyClientOAuthState(state);
    if (!decoded) {
      return res.redirect(`${frontendUrl()}/dashboard/clients?error=invalid_state`);
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      getClientGmailRedirectUri()
    );

    const { tokens } = await oauth2Client.getToken(code);
    await prisma.client.update({
      where: { id: decoded.clientId },
      data: {
        googleAccessToken: tokens.access_token,
        googleRefreshToken: tokens.refresh_token || undefined,
        gmailConnected: true,
      },
    });

    res.redirect(`${frontendUrl()}/dashboard/clients/${decoded.clientId}?connected=1`);
  } catch (err) {
    logger.error('Client Gmail callback failed', { error: err.message });
    res.redirect(`${frontendUrl()}/dashboard/clients?error=oauth_failed`);
  }
});

// POST /api/clients/scan-all
router.post('/scan-all', authenticate, async (req, res) => {
  try {
    const clients = await prisma.client.findMany({
      where: { userId: req.user.id, isActive: true, gmailConnected: true },
    });

    res.json({ success: true, message: 'סריקה הופעלה לכל הלקוחות', count: clients.length });

    for (const client of clients) {
      processClientEmails(client).then((stats) => {
        logger.info('Client scan complete', stats);
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/:clientId
router.get('/:clientId', authenticate, async (req, res) => {
  try {
    const client = await prisma.client.findFirst({
      where: { id: req.params.clientId, userId: req.user.id, isActive: true },
    });
    if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

    const [documents, tasks, stats] = await Promise.all([
      prisma.document.findMany({
        where: { clientId: client.id },
        orderBy: { receivedAt: 'desc' },
        take: 20,
      }),
      prisma.task.findMany({
        where: { clientId: client.id, completed: false },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      getClientStats(client.id),
    ]);

    res.json({ client: sanitizeClient(client, stats), documents, tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/clients/:clientId
router.put('/:clientId', authenticate, async (req, res) => {
  try {
    const client = await prisma.client.findFirst({
      where: { id: req.params.clientId, userId: req.user.id, isActive: true },
    });
    if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

    const { name, email, color, invoiceSheetUrl, taskSheetUrl, driveFolderUrl } = req.body;
    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (email !== undefined) data.email = email.trim().toLowerCase();
    if (color !== undefined) data.color = color;
    if (invoiceSheetUrl !== undefined) {
      data.invoiceSheetUrl = invoiceSheetUrl.trim() || null;
      data.invoiceSheetId = invoiceSheetUrl ? parseSheetIdFromUrl(invoiceSheetUrl) : null;
    }
    if (taskSheetUrl !== undefined) {
      data.taskSheetUrl = taskSheetUrl.trim() || null;
      data.taskSheetId = taskSheetUrl ? parseSheetIdFromUrl(taskSheetUrl) : null;
    }
    if (driveFolderUrl !== undefined) {
      data.driveFolderUrl = driveFolderUrl.trim() || null;
      data.driveFolderId = driveFolderUrl ? parseFolderIdFromUrl(driveFolderUrl) : null;
    }

    const updated = await prisma.client.update({ where: { id: client.id }, data });
    res.json({ client: sanitizeClient(updated, await getClientStats(updated.id)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/:clientId/connect-gmail
router.get('/:clientId/connect-gmail', authenticateOrQueryToken, async (req, res) => {
  try {
    const client = await prisma.client.findFirst({
      where: { id: req.params.clientId, userId: req.user.id, isActive: true },
    });
    if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      getClientGmailRedirectUri()
    );

    const state = createClientOAuthState(client.id, req.user.id);
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      state,
      login_hint: client.email,
    });

    res.redirect(url);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:clientId/scan
router.post('/:clientId/scan', authenticate, async (req, res) => {
  try {
    const client = await prisma.client.findFirst({
      where: { id: req.params.clientId, userId: req.user.id, isActive: true },
    });
    if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });
    if (!client.gmailConnected) {
      return res.status(400).json({ error: 'Gmail של הלקוח לא מחובר' });
    }

    res.json({ success: true, message: 'סריקה הופעלה' });

    processClientEmails(client).then((stats) => {
      logger.info('Client scan complete', stats);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
