const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const {
  testSheetConnection,
  saveUserSheetSettings,
  parseSheetIdFromUrl,
} = require('../services/sheetsService');
const { logger } = require('../utils/logger');

const router = express.Router();
const prisma = new PrismaClient();

const sanitizeUser = (user) => {
  const { accessToken, refreshToken, passwordHash, ...safe } = user;
  return {
    ...safe,
    googleConnected: !!(user.accessToken && user.refreshToken),
  };
};

// GET /api/settings
router.get('/', authenticate, async (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

// PUT /api/settings/sheets
router.put('/sheets', authenticate, async (req, res) => {
  try {
    const { invoiceSheetUrl, taskSheetUrl, driveFolderUrl } = req.body;
    const user = await saveUserSheetSettings(req.user.id, {
      invoiceSheetUrl,
      taskSheetUrl,
      driveFolderUrl,
    });
    res.json({ user: sanitizeUser(user) });
  } catch (err) {
    logger.error('Save sheet settings failed', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// POST /api/settings/sheets/test
router.post('/sheets/test', authenticate, async (req, res) => {
  try {
    const { sheetUrl, type } = req.body;
    if (!sheetUrl) {
      return res.status(400).json({ error: 'נדרשת כתובת Google Sheet' });
    }

    await testSheetConnection(req.user.id, sheetUrl);
    const sheetId = parseSheetIdFromUrl(sheetUrl);

    if (type === 'invoice') {
      await saveUserSheetSettings(req.user.id, { invoiceSheetUrl: sheetUrl });
    } else if (type === 'task') {
      await saveUserSheetSettings(req.user.id, { taskSheetUrl: sheetUrl });
    }

    res.json({
      ok: true,
      message: 'החיבור לטבלה הצליח',
      sheetId,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
    });
  } catch (err) {
    logger.error('Sheet connection test failed', { error: err.message });
    res.status(400).json({ error: err.message || 'בדיקת החיבור נכשלה' });
  }
});

// POST /api/settings/drive/test
router.post('/drive/test', authenticate, async (req, res) => {
  try {
    const { driveFolderUrl } = req.body;
    if (!driveFolderUrl) {
      return res.status(400).json({ error: 'נדרשת כתובת תיקיית Drive' });
    }
    const user = await saveUserSheetSettings(req.user.id, { driveFolderUrl });
    res.json({ ok: true, message: 'תיקיית Drive נשמרה', user: sanitizeUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
