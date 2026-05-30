import { Readable } from "node:stream";
import type { drive_v3 } from "googleapis";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";

export type UploadedDriveFile = {
  fileId: string | null;
  webViewLink: string;
  supplierFolderId: string | null;
};

export type SupplierFolderMetadata = {
  folderId: string;
  folderName: string;
  supplierName: string;
  supplierTaxId: string | null;
  supplierKey: string;
  updatedAt: string;
};

type DriveIntegrationMetadata = {
  supplierFolders?: Record<string, SupplierFolderMetadata>;
};

export const INVOICE_DRIVE_FOLDER_NAME = `${config.driveRootFolder} - חשבוניות`;

export async function ensureDriveFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId?: string
): Promise<string> {
  const escapedName = escapeDriveQueryValue(name);
  const q = driveFolderQuery(escapedName, parentId);
  const existing = await findDriveFolder(drive, q);
  const existingId = existing.data.files?.[0]?.id;
  if (existingId) return existingId;

  const raceCheck = await findDriveFolder(drive, q);
  const raceCheckId = raceCheck.data.files?.[0]?.id;
  if (raceCheckId) return raceCheckId;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    },
    fields: "id",
  });

  if (!created.data.id) {
    throw new Error(`Failed to create Google Drive folder: ${name}`);
  }

  return created.data.id;
}

export async function ensureInvoiceFolderTree(
  drive: drive_v3.Drive
): Promise<string> {
  const rootId = await ensureDriveFolder(drive, INVOICE_DRIVE_FOLDER_NAME);
  for (const folderName of ["Invoices", "Receipts", "Payment Requests", "Missing Invoices", "Other"]) {
    await ensureDriveFolder(drive, folderName, rootId);
  }
  return rootId;
}

export async function uploadInvoiceAttachmentToDrive(input: {
  organizationId: string;
  drive: drive_v3.Drive;
  rootFolderId: string;
  supplier: string;
  supplierTaxId?: string | null;
  documentType: string;
  filename: string;
  mimeType?: string | null;
  receivedAt: Date;
  buffer: Buffer;
}): Promise<UploadedDriveFile> {
  const folderType = folderForDocumentType(input.documentType);
  const supplierFolder = await ensureSupplierDriveFolder({
    organizationId: input.organizationId,
    drive: input.drive,
    rootFolderId: input.rootFolderId,
    supplierName: input.supplier,
    supplierTaxId: input.supplierTaxId ?? null,
  });
  const supplierFolderId = supplierFolder.folderId;
  const documentTypeFolderId = await ensureDriveFolder(input.drive, folderType, supplierFolderId);

  const upload = await input.drive.files.create({
    requestBody: {
      name: `${input.receivedAt.toISOString().slice(0, 10)}_${input.filename}`,
      parents: [documentTypeFolderId],
    },
    media: {
      mimeType: input.mimeType ?? "application/octet-stream",
      body: Readable.from(input.buffer),
    },
    fields: "id, webViewLink",
  });

  const fileId = upload.data.id ?? null;
  return {
    fileId,
    supplierFolderId,
    webViewLink:
      upload.data.webViewLink ??
      (fileId ? `https://drive.google.com/file/d/${fileId}/view` : ""),
  };
}

export async function ensureSupplierDriveFolder(input: {
  organizationId: string;
  drive: drive_v3.Drive;
  rootFolderId: string;
  supplierName: string;
  supplierTaxId?: string | null;
}) {
  const supplierName = normalizedSupplierFolderName(input.supplierName);
  const supplierTaxId = normalizeSupplierTaxId(input.supplierTaxId);
  const supplierKey = supplierFolderIdentityKey({ supplierName, supplierTaxId });
  const metadata = await readDriveIntegrationMetadata(input.organizationId);
  const stored = metadata.supplierFolders?.[supplierKey];
  if (stored?.folderId) {
    const existingStored = await getDriveFolder(input.drive, stored.folderId).catch(() => null);
    if (existingStored?.id) return stored;
  }

  const existingByIdentity = await findSupplierFolderByIdentity(input.drive, {
    rootFolderId: input.rootFolderId,
    supplierName,
    supplierTaxId,
    supplierKey,
  });
  const folderId = existingByIdentity ?? await createSupplierFolder(input.drive, {
    rootFolderId: input.rootFolderId,
    supplierName,
    supplierTaxId,
    supplierKey,
  });
  await tagSupplierFolder(input.drive, folderId, { supplierTaxId, supplierKey }).catch((err) => {
    console.warn(`[drive] Failed to tag supplier folder ${folderId}`, err);
  });
  const saved: SupplierFolderMetadata = {
    folderId,
    folderName: supplierName,
    supplierName,
    supplierTaxId,
    supplierKey,
    updatedAt: new Date().toISOString(),
  };
  await writeSupplierFolderMetadata(input.organizationId, supplierKey, saved);
  return saved;
}

export function folderForDocumentType(documentType: string): string {
  switch (documentType) {
    case "invoice":
      return "Invoices";
    case "receipt":
      return "Receipts";
    case "payment_request":
      return "Payment Requests";
    default:
      return "Other";
  }
}

export function safeFolderName(name: string): string {
  return normalizeFolderText(name || "Unknown Supplier").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
}

export function normalizedSupplierFolderName(name: string): string {
  const withoutBranch = (name || "Unknown Supplier").split(/\s+-\s+/)[0] ?? "Unknown Supplier";
  return safeFolderName(withoutBranch) || "Unknown Supplier";
}

export function supplierFolderIdentityKey(input: { supplierName: string; supplierTaxId?: string | null }) {
  const taxId = normalizeSupplierTaxId(input.supplierTaxId);
  if (taxId) return `tax:${taxId}`;
  return `name:${canonicalSupplierFolderKey(input.supplierName)}`;
}

export function canonicalSupplierFolderKey(name: string): string {
  const normalized = normalizedSupplierFolderName(name)
    .toLowerCase()
    .replace(/\b(?:ltd|limited|inc|llc|corp|company|co)\b\.?/gi, "")
    .replace(/\b(?:invoice|invoices|receipt|receipts|billing|payments?|accounts?)\b/gi, "")
    .replace(/\b(?:בע"מ|בע״מ|בעמ|חברה|חשבוניות|חשבונית|קבלה|תשלומים|גבייה)\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
  if (/^(wolt|וולט)/i.test(normalized)) return "wolt";
  if (/^(partner|פרטנר)/i.test(normalized)) return "partner";
  if (/^(anthropic|claude|אנתרופיק)/i.test(normalized)) return "anthropic";
  const municipality = normalized.match(/^(?:עיריית|עיריה|municipality)(.+)$/i)?.[1];
  if (municipality) return `municipality:${municipality}`;
  return normalized || "unknownsupplier";
}

function normalizeSupplierTaxId(value?: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length >= 7 && digits.length <= 10 ? digits : null;
}

async function findSupplierFolderByIdentity(
  drive: drive_v3.Drive,
  input: { rootFolderId: string; supplierName: string; supplierTaxId: string | null; supplierKey: string }
) {
  if (input.supplierTaxId) {
    const byTaxId = await findDriveFolder(
      drive,
      `appProperties has { key='supplierTaxId' and value='${escapeDriveQueryValue(input.supplierTaxId)}' } and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const id = byTaxId.data.files?.[0]?.id;
    if (id) return id;
  }

  const bySupplierKey = await findDriveFolder(
    drive,
    `appProperties has { key='supplierKey' and value='${escapeDriveQueryValue(input.supplierKey)}' } and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const supplierKeyId = bySupplierKey.data.files?.[0]?.id;
  if (supplierKeyId) return supplierKeyId;

  const byAlias = await findSupplierFolderByAlias(drive, input);
  if (byAlias) return byAlias;

  return ensureExistingFolderByName(drive, input.supplierName, input.rootFolderId);
}

async function findSupplierFolderByAlias(
  drive: drive_v3.Drive,
  input: { rootFolderId: string; supplierName: string; supplierTaxId: string | null; supplierKey: string }
) {
  const canonicalKey = canonicalSupplierFolderKey(input.supplierName);
  const aliases = supplierFolderSearchAliases(canonicalKey);
  if (aliases.length === 0) return null;
  const nameClauses = aliases.map((alias) => `name contains '${escapeDriveQueryValue(alias)}'`).join(" or ");
  const result = await findDriveFolder(
    drive,
    `'${input.rootFolderId}' in parents and (${nameClauses}) and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  return result.data.files?.[0]?.id ?? null;
}

function supplierFolderSearchAliases(canonicalKey: string) {
  switch (canonicalKey) {
    case "wolt":
      return ["Wolt", "wolt", "וולט"];
    case "partner":
      return ["Partner", "partner", "פרטנר"];
    case "anthropic":
      return ["Anthropic", "anthropic", "Claude", "claude", "אנתרופיק"];
    default:
      return [];
  }
}

async function createSupplierFolder(
  drive: drive_v3.Drive,
  input: { rootFolderId: string; supplierName: string; supplierTaxId: string | null; supplierKey: string }
) {
  const created = await drive.files.create({
    requestBody: {
      name: input.supplierName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [input.rootFolderId],
      appProperties: {
        supplierKey: input.supplierKey,
        ...(input.supplierTaxId ? { supplierTaxId: input.supplierTaxId } : {}),
      },
    },
    fields: "id",
  });
  if (!created.data.id) throw new Error(`Failed to create supplier Drive folder: ${input.supplierName}`);
  return created.data.id;
}

async function tagSupplierFolder(
  drive: drive_v3.Drive,
  folderId: string,
  input: { supplierTaxId: string | null; supplierKey: string }
) {
  await drive.files.update({
    fileId: folderId,
    requestBody: {
      appProperties: {
        supplierKey: input.supplierKey,
        ...(input.supplierTaxId ? { supplierTaxId: input.supplierTaxId } : {}),
      },
    },
    fields: "id",
    supportsAllDrives: true,
  });
}

async function ensureExistingFolderByName(drive: drive_v3.Drive, name: string, parentId: string) {
  const escapedName = escapeDriveQueryValue(name);
  const q = driveFolderQuery(escapedName, parentId);
  const existing = await findDriveFolder(drive, q);
  return existing.data.files?.[0]?.id ?? null;
}

async function getDriveFolder(drive: drive_v3.Drive, folderId: string) {
  const result = await drive.files.get({
    fileId: folderId,
    fields: "id, name, trashed",
    supportsAllDrives: true,
  });
  return result.data.trashed ? null : result.data;
}

async function readDriveIntegrationMetadata(organizationId: string): Promise<DriveIntegrationMetadata> {
  const existing = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider: "drive" } },
    select: { metadata: true },
  });
  return parseDriveMetadata(existing?.metadata);
}

export async function writeSupplierFolderMetadata(organizationId: string, supplierKey: string, folder: SupplierFolderMetadata) {
  const existing = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider: "drive" } },
    select: { metadata: true },
  });
  const metadata = parseDriveMetadata(existing?.metadata);
  const nextMetadata: DriveIntegrationMetadata = {
    ...metadata,
    supplierFolders: {
      ...(metadata.supplierFolders ?? {}),
      [supplierKey]: folder,
    },
  };
  await prisma.integration.upsert({
    where: { organizationId_provider: { organizationId, provider: "drive" } },
    create: { organizationId, provider: "drive", metadata: JSON.stringify(nextMetadata) },
    update: { metadata: JSON.stringify(nextMetadata) },
  });
}

function parseDriveMetadata(value?: string | null): DriveIntegrationMetadata {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as DriveIntegrationMetadata;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeFolderText(value: string) {
  return value
    .replace(/[־–—]+/g, "-")
    .replace(/[׳‘’`]/g, "'")
    .replace(/[״“”]/g, '"')
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .replace(/(?:\s+-\s+){2,}/g, " - ")
    .trim();
}

function driveFolderQuery(escapedName: string, parentId?: string) {
  return parentId
    ? `name='${escapedName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    : `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
}

function findDriveFolder(drive: drive_v3.Drive, q: string) {
  return drive.files.list({
    q,
    fields: "files(id)",
    pageSize: 1,
  });
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
