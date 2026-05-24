const { google } = require('googleapis');
const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');
const { getGoogleRedirectUri } = require('../utils/googleOAuth');

const prisma = new PrismaClient();

/**
 * Returns an authenticated Google OAuth2 client for a given user.
 * Handles token refresh automatically.
 */
const getAuthClient = async (user) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    getGoogleRedirectUri()
  );

  oauth2Client.setCredentials({
    access_token: user.accessToken,
    refresh_token: user.refreshToken,
  });

  // Auto-refresh tokens
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          accessToken: tokens.access_token,
          ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
        },
      });
      logger.info('Tokens refreshed', { userId: user.id });
    }
  });

  return oauth2Client;
};

module.exports = { getAuthClient };
