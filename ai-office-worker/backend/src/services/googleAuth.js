const { google } = require('googleapis');
const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');
const { getGoogleRedirectUri, getClientGmailRedirectUri } = require('../utils/googleOAuth');

const prisma = new PrismaClient();

const getAuthClient = async (user) =>
  getAuthClientForTokens({
    id: user.id,
    accessToken: user.accessToken,
    refreshToken: user.refreshToken,
    entityType: 'user',
    redirectUri: getGoogleRedirectUri(),
  });

const getAuthClientForClient = async (client) =>
  getAuthClientForTokens({
    id: client.id,
    accessToken: client.googleAccessToken,
    refreshToken: client.googleRefreshToken,
    entityType: 'client',
    redirectUri: getClientGmailRedirectUri(),
  });

const getAuthClientForTokens = async ({ id, accessToken, refreshToken, entityType, redirectUri }) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  oauth2Client.on('tokens', async (tokens) => {
    if (!tokens.access_token) return;
    const data = {
      ...(entityType === 'client'
        ? { googleAccessToken: tokens.access_token }
        : { accessToken: tokens.access_token }),
      ...(tokens.refresh_token && (entityType === 'client'
        ? { googleRefreshToken: tokens.refresh_token }
        : { refreshToken: tokens.refresh_token })),
    };

    if (entityType === 'client') {
      await prisma.client.update({ where: { id }, data });
      logger.info('Client tokens refreshed', { clientId: id });
    } else {
      await prisma.user.update({ where: { id }, data });
      logger.info('Tokens refreshed', { userId: id });
    }
  });

  return oauth2Client;
};

module.exports = { getAuthClient, getAuthClientForClient, getAuthClientForTokens };
