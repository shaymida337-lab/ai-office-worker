const { Readable } = require('node:stream');
const { google } = require('googleapis');
const { getAuthClient, getAuthClientForClient } = require('./googleAuth');
const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');

const prisma = new PrismaClient();

const driveRootFolder = process.env.GOOGLE_DRIVE_ROOT || 'AI Office Worker';

const escapeDriveQueryValue = (value) =>
  value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const ensureDriveFolder = async (drive, name, parentId) => {
  const escapedName = escapeDriveQueryValue(name);
  const q = parentId
    ? `name='${escapedName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    : `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const existing = await drive.files.list({
    q,
    fields: 'files(id)',
    pageSize: 1,
  });
  const existingId = existing.data.files?.[0]?.id;
  if (existingId) return existingId;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    },
    fields: 'id',
  });

  if (!created.data.id) {
    throw new Error(`Failed to create Google Drive folder: ${name}`);
  }

  return created.data.id;
};

const folderForDocumentType = (documentType) => {
  switch (documentType) {
    case 'invoice':
    case 'INVOICE':
      return 'Invoices';
    case 'receipt':
    case 'RECEIPT':
      return 'Receipts';
    case 'payment_request':
    case 'PAYMENT_REQUEST':
      return 'Payment Requests';
    default:
      return 'Other';
  }
};

const safeFolderName = (name) =>
  (name || 'Unknown Supplier').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);

const ensureInvoiceFolderTree = async (drive) => {
  const rootId = await ensureDriveFolder(drive, driveRootFolder);
  await Promise.all([
    ensureDriveFolder(drive, 'Invoices', rootId),
    ensureDriveFolder(drive, 'Receipts', rootId),
    ensureDriveFolder(drive, 'Payment Requests', rootId),
    ensureDriveFolder(drive, 'Missing Invoices', rootId),
    ensureDriveFolder(drive, 'Other', rootId),
  ]);
  return rootId;
};

const ensureUserDriveRoot = async (user) => {
  const folderId = user.driveFolderId || user.driveFolder;
  if (folderId) return folderId;

  const auth = await getAuthClient(user);
  const drive = google.drive({ version: 'v3', auth });
  const rootId = await ensureInvoiceFolderTree(drive);

  await prisma.user.update({
    where: { id: user.id },
    data: { driveFolder: rootId },
  });

  logger.info('Drive folder tree ready', { userId: user.id, rootId });
  return rootId;
};

const uploadInvoiceAttachmentToDrive = async (user, input) => {
  const auth = await getAuthClient(user);
  const drive = google.drive({ version: 'v3', auth });

  const folderType = folderForDocumentType(input.documentType);
  const typeFolderId = await ensureDriveFolder(drive, folderType, input.rootFolderId);
  const supplierFolderId = await ensureDriveFolder(
    drive,
    safeFolderName(input.supplier),
    typeFolderId
  );

  const upload = await drive.files.create({
    requestBody: {
      name: `${input.receivedAt.toISOString().slice(0, 10)}_${input.filename}`,
      parents: [supplierFolderId],
    },
    media: {
      mimeType: input.mimeType || 'application/octet-stream',
      body: Readable.from(input.buffer),
    },
    fields: 'id, webViewLink',
  });

  const fileId = upload.data.id ?? null;
  return {
    fileId,
    webViewLink:
      upload.data.webViewLink ||
      (fileId ? `https://drive.google.com/file/d/${fileId}/view` : ''),
  };
};

const ensureClientDriveRoot = async (client) => {
  if (client.driveFolderId) return client.driveFolderId;

  const auth = await getAuthClientForClient(client);
  const drive = google.drive({ version: 'v3', auth });
  const rootId = await ensureInvoiceFolderTree(drive);

  await prisma.client.update({
    where: { id: client.id },
    data: { driveFolderId: rootId, driveFolderUrl: `https://drive.google.com/drive/folders/${rootId}` },
  });

  logger.info('Client Drive folder tree ready', { clientId: client.id, rootId });
  return rootId;
};

const uploadInvoiceAttachmentForClient = async (client, input) => {
  const auth = await getAuthClientForClient(client);
  const drive = google.drive({ version: 'v3', auth });

  const folderType = folderForDocumentType(input.documentType);
  const typeFolderId = await ensureDriveFolder(drive, folderType, input.rootFolderId);
  const supplierFolderId = await ensureDriveFolder(
    drive,
    safeFolderName(input.supplier),
    typeFolderId
  );

  const upload = await drive.files.create({
    requestBody: {
      name: `${input.receivedAt.toISOString().slice(0, 10)}_${input.filename}`,
      parents: [supplierFolderId],
    },
    media: {
      mimeType: input.mimeType || 'application/octet-stream',
      body: Readable.from(input.buffer),
    },
    fields: 'id, webViewLink',
  });

  const fileId = upload.data.id ?? null;
  return {
    fileId,
    webViewLink:
      upload.data.webViewLink ||
      (fileId ? `https://drive.google.com/file/d/${fileId}/view` : ''),
  };
};

module.exports = {
  ensureDriveFolder,
  ensureInvoiceFolderTree,
  ensureUserDriveRoot,
  ensureClientDriveRoot,
  uploadInvoiceAttachmentToDrive,
  uploadInvoiceAttachmentForClient,
  folderForDocumentType,
  safeFolderName,
};
