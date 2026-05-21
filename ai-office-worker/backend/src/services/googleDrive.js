const { google } = require('googleapis');
const { getAuthClient } = require('./googleAuth');
const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');

const prisma = new PrismaClient();

const FOLDER_NAME = 'חשבוניות ותשלומים';

/**
 * Ensure the user has a Drive folder. Create if not exists.
 * Returns the folder ID.
 */
const ensureDriveFolder = async (user) => {
  if (user.driveFolder) return user.driveFolder;

  const auth = await getAuthClient(user);
  const drive = google.drive({ version: 'v3', auth });

  // Check if folder already exists
  const existing = await drive.files.list({
    q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
  });

  let folderId;

  if (existing.data.files.length > 0) {
    folderId = existing.data.files[0].id;
    logger.info('Drive folder already exists', { userId: user.id, folderId });
  } else {
    const folder = await drive.files.create({
      requestBody: {
        name: FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });
    folderId = folder.data.id;
    logger.info('Drive folder created', { userId: user.id, folderId });
  }

  // Save to DB
  await prisma.user.update({
    where: { id: user.id },
    data: { driveFolder: folderId },
  });

  return folderId;
};

/**
 * Upload a file (base64) to the user's Drive folder.
 * Returns { fileId, fileUrl }
 */
const uploadFileToDrive = async (user, filename, mimeType, base64Data, folderId) => {
  const auth = await getAuthClient(user);
  const drive = google.drive({ version: 'v3', auth });

  const buffer = Buffer.from(base64Data, 'base64');

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: require('stream').Readable.from(buffer),
    },
    fields: 'id,webViewLink',
  });

  const fileId = res.data.id;
  const fileUrl = res.data.webViewLink;

  logger.info('File uploaded to Drive', { userId: user.id, filename, fileId });

  return { fileId, fileUrl };
};

module.exports = { ensureDriveFolder, uploadFileToDrive };
