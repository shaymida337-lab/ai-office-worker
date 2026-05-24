const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');
const { getGoogleRedirectUri } = require('../utils/googleOAuth');
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

const PLACEHOLDER_GOOGLE_SECRETS = new Set([
  '',
  'your-client-secret',
  'your-google-client-secret',
]);

const isGoogleOAuthConfigured = () => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  const redirectUri = getGoogleRedirectUri();
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !redirectUri) return false;
  if (GOOGLE_CLIENT_ID.includes('your-google-client-id')) return false;
  if (PLACEHOLDER_GOOGLE_SECRETS.has(GOOGLE_CLIENT_SECRET)) return false;
  return true;
};

const createOAuthClient = () => new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  getGoogleRedirectUri(),
);

const frontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:3000';

const oauthErrorRedirect = (errorCode, reason) => {
  const params = new URLSearchParams({ error: errorCode });
  if (reason) params.set('reason', reason);
  return `${frontendUrl()}/?${params.toString()}`;
};

const createOAuthState = () => jwt.sign(
  { purpose: 'google_oauth', nonce: crypto.randomBytes(16).toString('hex') },
  process.env.JWT_SECRET,
  { expiresIn: '10m' },
);

const verifyOAuthState = (state) => {
  if (!state) return false;
  try {
    const decoded = jwt.verify(state, process.env.JWT_SECRET);
    return decoded.purpose === 'google_oauth';
  } catch {
    return false;
  }
};

if (process.env.NODE_ENV !== 'production' && !isGoogleOAuthConfigured()) {
  logger.warn(
    'Google OAuth is not configured: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in backend/.env. ' +
    'Redirect URI must be http://localhost:4000/api/auth/google/callback (also add it in Google Cloud Console).'
  );
}

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
router.post('/login', async (req, res) => {
  const { email, password, displayName, whatsappNumber } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@') || !password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Email and password are required. Password must be at least 6 characters.' });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (user) {
      if (!user.passwordHash) {
        return res.status(400).json({ error: 'This account uses Google sign-in. Click "התחבר עם Google".' });
      }
      if (!verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          displayName: displayName || user.displayName || normalizedEmail.split('@')[0],
          ...(whatsappNumber ? { whatsappNumber } : {}),
          isActive: true,
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          passwordHash: hashPassword(password),
          displayName: displayName || normalizedEmail.split('@')[0],
          whatsappNumber: whatsappNumber || null,
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

// GET /api/auth/google/status
router.get('/google/status', (req, res) => {
  res.json({
    configured: isGoogleOAuthConfigured(),
    redirectUri: getGoogleRedirectUri(),
    clientIdSet: !!(process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_ID.includes('your-google-client-id')),
    clientSecretSet: !!(process.env.GOOGLE_CLIENT_SECRET && !PLACEHOLDER_GOOGLE_SECRETS.has(process.env.GOOGLE_CLIENT_SECRET)),
  });
});

router.get('/google', (req, res) => {
  try {
    if (!isGoogleOAuthConfigured()) {
      return res.status(500).json({
        error: 'Google OAuth is not configured',
        hint: 'Set GOOGLE_CLIENT_SECRET in backend/.env (from Google Cloud Console → Credentials → OAuth client).',
        redirectUri: getGoogleRedirectUri(),
      });
    }

    const oauth2Client = createOAuthClient();
    const state = createOAuthState();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      state,
    });

    res.redirect(authUrl);
  } catch (err) {
    logger.error('Google auth start failed', { error: err.message });
    res.status(500).json({ error: 'Unable to start Google authentication' });
  }
});

router.get('/google/callback', async (req, res) => {
  logger.debug('Google OAuth callback', {
    query: req.query,
    url: req.originalUrl,
  });

  try {
    if (req.query.error) {
      logger.warn('Google OAuth returned an error', {
        error: req.query.error,
        description: req.query.error_description,
      });
      return res.redirect(oauthErrorRedirect('oauth_denied', String(req.query.error)));
    }

    if (!verifyOAuthState(req.query.state)) {
      logger.warn('Google OAuth state validation failed', { state: req.query.state });
      return res.redirect(oauthErrorRedirect('oauth_failed', 'invalid_state'));
    }

    const code = req.query.code;
    if (!code) {
      return res.redirect(oauthErrorRedirect('oauth_failed', 'no_code'));
    }

    if (!isGoogleOAuthConfigured()) {
      return res.redirect(oauthErrorRedirect('oauth_failed', 'not_configured'));
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
      return res.redirect(oauthErrorRedirect('oauth_no_email'));
    }

    let user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          displayName,
          googleId,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || user.refreshToken,
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

    if (!user.refreshToken) {
      logger.warn('Google login succeeded but no refresh token — user may need to revoke app access and re-consent', { userId: user.id });
    }

    processUserEmails(user).then((stats) => {
      logger.info('Google login scan finished', { userId: user.id, stats });
    }).catch((scanErr) => {
      logger.warn('Google login scan failed', { userId: user.id, error: scanErr.message });
    });

    const jwtToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    const redirectUrl = `${frontendUrl()}/auth/callback?token=${encodeURIComponent(jwtToken)}`;
    res.redirect(redirectUrl);
  } catch (err) {
    logger.error('Google callback failed', {
      error: err.message,
      response: err.response?.data,
    });
    res.redirect(oauthErrorRedirect('oauth_failed', err.message));
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const googleConnected = !!(req.user.accessToken && req.user.refreshToken);
  const { accessToken, refreshToken, passwordHash, ...safeUser } = req.user;
  res.json({ user: { ...safeUser, googleConnected } });
});

// POST /api/auth/logout
router.post('/logout', authenticate, (req, res) => {
  logger.info('User logged out', { userId: req.user.id });
  res.json({ success: true });
});

module.exports = router;
