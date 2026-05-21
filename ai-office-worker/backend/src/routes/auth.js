const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');
const { authenticate } = require('../middleware/auth');
const { processUserEmails } = require('../services/emailProcessor');

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

const createOAuthClient = () => new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
};

const verifyPassword = (password, storedHash) => {
  if (!storedHash) return false;
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derived, 'hex'));
};

// POST /api/auth/login
// Local email/password auth only
router.post('/login', async (req, res) => {
  const { email, password, displayName } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@') || !password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Email and password are required. Password must be at least 6 characters.' });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (user) {
      if (!user.passwordHash) {
        return res.status(400).json({ error: 'This account requires a password setup. Use a different email.' });
      }
      if (!verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          displayName: displayName || user.displayName || normalizedEmail.split('@')[0],
          isActive: true,
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          passwordHash: hashPassword(password),
          displayName: displayName || normalizedEmail.split('@')[0],
          googleId: null,
          isActive: true,
        },
      });
    }

    const jwtToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token: jwtToken, user: { id: user.id, email: user.email, displayName: user.displayName } });
  } catch (err) {
    logger.error('Local login failed', { error: err.message });
    res.status(500).json({ error: 'Unable to complete login' });
  }
});

router.get('/google', (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
      return res.status(500).json({ error: 'Google OAuth is not configured' });
    }

    const oauth2Client = createOAuthClient();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    });

    res.redirect(authUrl);
  } catch (err) {
    logger.error('Google auth start failed', { error: err.message });
    res.status(500).json({ error: 'Unable to start Google authentication' });
  }
});

router.get('/google/callback', async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/?error=oauth_failed`);
    }

    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ auth: oauth2Client, version: 'v2' });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email?.toLowerCase().trim();
    const googleId = userInfo.data.id;
    const displayName = userInfo.data.name || email?.split('@')[0] || 'User';

    if (!email) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/?error=oauth_no_email`);
    }

    let user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          displayName,
          googleId,
          accessToken: tokens.access_token,
          ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
          isActive: true,
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email,
          googleId,
          displayName,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          isActive: true,
        },
      });
    }

    processUserEmails(user).then((stats) => {
      logger.info('Google login scan finished', { userId: user.id, stats });
    }).catch((scanErr) => {
      logger.warn('Google login scan failed', { userId: user.id, error: scanErr.message });
    });

    const jwtToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/callback?token=${encodeURIComponent(jwtToken)}`;
    res.redirect(redirectUrl);
  } catch (err) {
    logger.error('Google callback failed', { error: err.message });
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/?error=oauth_failed`);
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const { accessToken, refreshToken, passwordHash, ...safeUser } = req.user;
  res.json({ user: safeUser });
});

// POST /api/auth/logout
router.post('/logout', authenticate, (req, res) => {
  logger.info('User logged out', { userId: req.user.id });
  res.json({ success: true });
});

module.exports = router;
