import { Readable } from "node:stream";
import type { drive_v3 } from "googleapis";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";

export type UploadedDriveFile = {
  fileId: string | null;
  webViewLink: string;
  clientFolderId: string | null;
  supplierFolderId: string | null;
  folderId: string | null;
  folderPath: string;
  folderWebViewLink: string | null;
  supplierName: string;
  invoiceMonth: number;
  invoiceYear: number;
  duplicateDetected?: boolean;
};

export type DriveDocumentReviewStatus = "auto_saved" | "needs_review" | string;

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
  folderCache?: Record<string, { folderId: string; folderPath: string; updatedAt: string }>;
};

export const INVOICE_DRIVE_FOLDER_NAME = safeFolderName(config.driveRootFolder);
export const DRIVE_FOLDER_NAMES = Object.freeze({
  root: INVOICE_DRIVE_FOLDER_NAME,
  clients: "Clients",
  suppliers: "Suppliers",
  invoices: "Invoices",
  receipts: "Receipts",
  needsReview: "Needs Review",
  unknownSupplier: "לא זוהה",
  unknownClient: "לקוח לא מזוהה",
});

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

  console.log(
    `[drive] DRIVE_FOLDER_CREATED name="${name}" folderId=${created.data.id} parentId=${parentId ?? "root"}`
  );

  return created.data.id;
}

export async function ensureInvoiceFolderTree(
  drive: drive_v3.Drive
): Promise<string> {
  const rootId = await ensureDriveFolder(drive, INVOICE_DRIVE_FOLDER_NAME);
  for (const folderName of [DRIVE_FOLDER_NAMES.clients]) {
    await ensureDriveFolder(drive, folderName, rootId);
  }
  return rootId;
}

export async function uploadInvoiceAttachmentToDrive(input: {
  organizationId: string;
  drive: drive_v3.Drive;
  rootFolderId: string;
  clientId?: string | null;
  clientName?: string | null;
  supplier: string;
  supplierTaxId?: string | null;
  documentType: string;
  reviewStatus?: DriveDocumentReviewStatus | null;
  filename: string;
  mimeType?: string | null;
  receivedAt: Date;
  documentDate?: Date | string | null;
  invoiceNumber?: string | null;
  amount?: number | null;
  totalAmount?: number | null;
  buffer: Buffer;
  fileSha256?: string | null;
  fileMd5?: string | null;
}): Promise<UploadedDriveFile> {
  const documentDate = normalizeDocumentDate(input.documentDate, input.receivedAt);
  const invoiceYear = documentDate.getFullYear();
  const invoiceMonth = documentDate.getMonth() + 1;
  const amount = input.totalAmount ?? input.amount ?? null;
  const clientName = await resolveDriveClientName(input.organizationId, input.clientId, input.clientName);
  const supplierName = normalizedSupplierFolderName(input.supplier);
  const targetFolder = await ensureProductionInvoiceFolder({
    organizationId: input.organizationId,
    drive: input.drive,
    rootFolderId: input.rootFolderId,
    clientName,
    supplierName,
    supplierTaxId: input.supplierTaxId ?? null,
    documentType: input.documentType,
    reviewStatus: input.reviewStatus ?? null,
    documentDate,
  });
  const driveFilename = buildInvoiceDriveFilename(input.filename, supplierName, input.invoiceNumber, documentDate, amount);
  const existingFile = await findExistingDriveDocument(input.drive, targetFolder.folderId, {
    filename: driveFilename,
    fileSha256: input.fileSha256 ?? null,
    fileMd5: input.fileMd5 ?? null,
    supplierName,
    invoiceNumber: input.invoiceNumber ?? null,
    amount,
    invoiceDate: documentDate,
  });
  if (existingFile) {
    const fileId = existingFile.id ?? null;
    const webViewLink = existingFile.webViewLink ?? (fileId ? `https://drive.google.com/file/d/${fileId}/view` : "");
    console.log(
      `[drive] DRIVE_DUPLICATE_SKIPPED org=${input.organizationId} reason=existing_drive_file file="${driveFilename}" driveFileId=${fileId ?? "none"} link=${webViewLink || "none"} folderId=${targetFolder.folderId} folderPath="${targetFolder.folderPath}"`
    );
    return {
      fileId,
      clientFolderId: targetFolder.clientFolderId,
      supplierFolderId: targetFolder.supplierFolderId,
      folderId: targetFolder.folderId,
      folderPath: targetFolder.folderPath,
      folderWebViewLink: targetFolder.folderWebViewLink,
      supplierName,
      invoiceMonth,
      invoiceYear,
      duplicateDetected: true,
      webViewLink,
    };
  }

  const upload = await input.drive.files.create({
    requestBody: {
      name: driveFilename,
      parents: [targetFolder.folderId],
      appProperties: {
        ...(input.fileSha256 ? { fileSha256: input.fileSha256 } : {}),
        ...(input.fileMd5 ? { fileMd5: input.fileMd5 } : {}),
        clientName,
        supplierName,
        ...(input.invoiceNumber ? { invoiceNumber: input.invoiceNumber } : {}),
        ...(amount !== null ? { amount: amount.toFixed(2) } : {}),
        invoiceDate: documentDate.toISOString().slice(0, 10),
        invoiceYear: String(invoiceYear),
        invoiceMonth: String(invoiceMonth).padStart(2, "0"),
        driveFolderPath: targetFolder.folderPath,
      },
    },
    media: {
      mimeType: input.mimeType ?? "application/octet-stream",
      body: Readable.from(input.buffer),
    },
    fields: "id, webViewLink",
  });

  const fileId = upload.data.id ?? null;
  const webViewLink =
    upload.data.webViewLink ??
    (fileId ? `https://drive.google.com/file/d/${fileId}/view` : "");
  console.log(
    `[drive] DRIVE_FILE_SAVED org=${input.organizationId} file="${driveFilename}" driveFileId=${fileId ?? "none"} link=${webViewLink || "none"} folderId=${targetFolder.folderId} folderPath="${targetFolder.folderPath}"`
  );
  console.log(
    `[drive] DRIVE_UPLOAD_SUCCESS org=${input.organizationId} file="${driveFilename}" driveFileId=${fileId ?? "none"} link=${webViewLink || "none"} folderId=${targetFolder.folderId} folderPath="${targetFolder.folderPath}"`
  );
  return {
    fileId,
    clientFolderId: targetFolder.clientFolderId,
    supplierFolderId: targetFolder.supplierFolderId,
    folderId: targetFolder.folderId,
    folderPath: targetFolder.folderPath,
    folderWebViewLink: targetFolder.folderWebViewLink,
    supplierName,
    invoiceMonth,
    invoiceYear,
    webViewLink,
  };
}

export async function findExistingSupplierDriveDocument(input: {
  organizationId: string;
  drive: drive_v3.Drive;
  rootFolderId: string;
  clientId?: string | null;
  clientName?: string | null;
  supplier: string;
  supplierTaxId?: string | null;
  documentType: string;
  reviewStatus?: DriveDocumentReviewStatus | null;
  filename: string;
  fileSha256?: string | null;
  fileMd5?: string | null;
  documentDate?: Date | string | null;
  invoiceNumber?: string | null;
  amount?: number | null;
  totalAmount?: number | null;
}) {
  const documentDate = normalizeDocumentDate(input.documentDate, new Date());
  const amount = input.totalAmount ?? input.amount ?? null;
  const clientName = await resolveDriveClientName(input.organizationId, input.clientId, input.clientName);
  const supplierName = normalizedSupplierFolderName(input.supplier);
  const documentFolder = await ensureProductionInvoiceFolder({
    organizationId: input.organizationId,
    drive: input.drive,
    rootFolderId: input.rootFolderId,
    clientName,
    supplierName,
    supplierTaxId: input.supplierTaxId ?? null,
    documentType: input.documentType,
    reviewStatus: input.reviewStatus ?? null,
    documentDate,
  });
  const documentFolderId = documentFolder.folderId;
  const filename = buildInvoiceDriveFilename(input.filename, supplierName, input.invoiceNumber, documentDate, amount);
  const existingFile = await findExistingDriveDocument(input.drive, documentFolderId, {
    filename,
    fileSha256: input.fileSha256 ?? null,
    fileMd5: input.fileMd5 ?? null,
    supplierName,
    invoiceNumber: input.invoiceNumber ?? null,
    amount,
    invoiceDate: documentDate,
  });
  if (existingFile) {
    console.log(
      `[drive] DRIVE_DUPLICATE_SKIPPED org=${input.organizationId} reason=existing_drive_file file="${filename}" driveFileId=${existingFile.id ?? "none"} link=${existingFile.webViewLink || "none"} folderId=${documentFolder.folderId} folderPath="${documentFolder.folderPath}"`
    );
  }
  return existingFile;
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
    if (existingStored?.id && existingStored.parents?.includes(input.rootFolderId)) return stored;
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
  return driveDocumentCategoryFolder({ documentType });
}

export function safeFolderName(name: string): string {
  const normalized = normalizeFolderText(name || DRIVE_FOLDER_NAMES.unknownSupplier).replace(/[\x00-\x1F\x7F\\/:*?"<>|]/g, "-").slice(0, 80);
  return /^(unknown|unknown supplier|לא ידוע)$/i.test(normalized) ? DRIVE_FOLDER_NAMES.unknownSupplier : normalized;
}

export function normalizedSupplierFolderName(name: string): string {
  const withoutBranch = (name || DRIVE_FOLDER_NAMES.unknownSupplier).split(/\s+-\s+/)[0] ?? DRIVE_FOLDER_NAMES.unknownSupplier;
  const normalized = safeFolderName(withoutBranch);
  return isUnknownSupplierName(name) || isUnknownSupplierName(normalized)
    ? DRIVE_FOLDER_NAMES.unknownSupplier
    : normalized || DRIVE_FOLDER_NAMES.unknownSupplier;
}

async function ensureProductionInvoiceFolder(input: {
  organizationId: string;
  drive: drive_v3.Drive;
  rootFolderId: string;
  clientName: string;
  supplierName: string;
  supplierTaxId?: string | null;
  documentType: string;
  reviewStatus?: DriveDocumentReviewStatus | null;
  documentDate: Date;
}) {
  const clientName = normalizedClientFolderName(input.clientName);
  const supplierName = normalizedSupplierFolderName(input.supplierName);
  const folderPathParts = buildInvoiceDriveFolderPathParts({
    clientName,
    supplierName,
    documentType: input.documentType,
    reviewStatus: input.reviewStatus,
    documentDate: input.documentDate,
  });
  const clientsFolderId = await ensureCachedDriveFolder(input, DRIVE_FOLDER_NAMES.clients, input.rootFolderId, [INVOICE_DRIVE_FOLDER_NAME, DRIVE_FOLDER_NAMES.clients]);
  const clientFolderId = await ensureCachedDriveFolder(input, clientName, clientsFolderId, [INVOICE_DRIVE_FOLDER_NAME, DRIVE_FOLDER_NAMES.clients, clientName]);
  let parentId = clientFolderId;
  let supplierFolderId: string | null = null;
  const nestedFolders = folderPathParts.slice(3);
  for (let index = 0; index < nestedFolders.length; index++) {
    const folderName = nestedFolders[index];
    const currentPath = [INVOICE_DRIVE_FOLDER_NAME, DRIVE_FOLDER_NAMES.clients, clientName, ...nestedFolders.slice(0, index + 1)];
    parentId = await ensureCachedDriveFolder(input, folderName, parentId, currentPath);
    if (
      folderName === supplierName &&
      folderPathParts[index + 2] === DRIVE_FOLDER_NAMES.suppliers &&
      folderPathParts[index + 4]
    ) {
      supplierFolderId = parentId;
    }
  }
  if (parentId === input.rootFolderId) {
    throw new Error("Refusing to upload Drive file into root folder");
  }
  const folderPath = folderPathParts.join("/");
  return {
    clientFolderId,
    supplierFolderId,
    folderId: parentId,
    folderPath,
    folderWebViewLink: `https://drive.google.com/drive/folders/${parentId}`,
  };
}

async function ensureCachedDriveFolder(
  input: { organizationId: string; drive: drive_v3.Drive },
  name: string,
  parentId: string,
  folderPathParts: string[]
) {
  const folderPath = folderPathParts.join("/");
  const metadata = await readDriveIntegrationMetadata(input.organizationId);
  const cached = metadata.folderCache?.[folderPath];
  if (cached?.folderId) {
    const existing = await getDriveFolder(input.drive, cached.folderId).catch(() => null);
    if (existing?.id && existing.parents?.includes(parentId)) return cached.folderId;
  }

  const folderId = await ensureDriveFolder(input.drive, name, parentId);
  await writeFolderCacheMetadata(input.organizationId, folderPath, folderId);
  return folderId;
}

export function supplierFolderIdentityKey(input: { supplierName: string; supplierTaxId?: string | null }) {
  const taxId = normalizeSupplierTaxId(input.supplierTaxId);
  if (taxId) return `tax:${taxId}`;
  return `name:${canonicalSupplierFolderKey(input.supplierName)}`;
}

export function canonicalSupplierFolderKey(name: string): string {
  const folderName = normalizedSupplierFolderName(name);
  if (/(^|[\s([{-])(wolt|וולט)([\s)\]}-]|$)/i.test(folderName)) return "wolt";
  if (/(^|[\s([{-])(partner|פרטנר)([\s)\]}-]|$)/i.test(folderName)) return "partner";
  if (/(^|[\s([{-])(anthropic|claude|אנתרופיק)([\s)\]}-]|$)/i.test(folderName)) return "anthropic";

  const normalized = folderName
    .toLowerCase()
    .replace(/\b(?:ltd|limited|inc|llc|corp|company|co)\b\.?/gi, "")
    .replace(/\b(?:invoice|invoices|receipt|receipts|billing|payments?|accounts?)\b/gi, "")
    .replace(/\b(?:בע"מ|בע״מ|בעמ|חברה|חשבוניות|חשבונית|קבלה|תשלומים|גבייה)\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
  if (/(wolt|וולט)/i.test(normalized)) return "wolt";
  if (/(partner|פרטנר)/i.test(normalized)) return "partner";
  if (/(anthropic|claude|אנתרופיק)/i.test(normalized)) return "anthropic";
  const municipality = normalized.match(/^(?:עיריית|עיריה|municipality)(.+)$/i)?.[1];
  if (municipality) return `municipality:${municipality}`;
  return normalized || "unknownsupplier";
}

export function supplierBranchNameFromFolderName(name: string): string | null {
  const folderName = normalizedSupplierFolderName(name);
  const withoutSupplierBrand = folderName
    .replace(/\s*[\[(]\s*(?:wolt|וולט|partner|פרטנר|anthropic|claude|אנתרופיק)\s*[\])]\s*/gi, " ")
    .replace(/\b(?:wolt|וולט|partner|פרטנר|anthropic|claude|אנתרופיק)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!withoutSupplierBrand || canonicalSupplierFolderKey(withoutSupplierBrand) !== canonicalSupplierFolderKey(folderName)) {
    return withoutSupplierBrand || null;
  }
  return null;
}

async function findExistingDriveDocument(
  drive: drive_v3.Drive,
  parentId: string,
  input: {
    filename: string;
    fileSha256: string | null;
    fileMd5: string | null;
    supplierName?: string | null;
    invoiceNumber?: string | null;
    amount?: number | null;
    invoiceDate?: Date | string | null;
  }
) {
  let pageToken: string | undefined;
  const normalizedFilename = normalizeDriveFilename(input.filename);
  const businessKey = driveBusinessDuplicateKey(input);
  do {
    const result = await drive.files.list({
      q: `'${parentId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`,
      fields: "nextPageToken, files(id, name, webViewLink, md5Checksum, appProperties)",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const file of result.data.files ?? []) {
      if (!file.id) continue;
      const appProperties = file.appProperties ?? {};
      if (input.fileSha256 && appProperties.fileSha256 === input.fileSha256) return file;
      if (input.fileMd5 && (appProperties.fileMd5 === input.fileMd5 || file.md5Checksum === input.fileMd5)) return file;
      if (businessKey && driveBusinessDuplicateKey(appProperties) === businessKey) return file;
      if (file.name && normalizeDriveFilename(file.name).endsWith(normalizedFilename)) return file;
    }
    pageToken = result.data.nextPageToken ?? undefined;
  } while (pageToken);
  return null;
}

function normalizeDriveFilename(value: string) {
  return value.toLowerCase().replace(/^\d{4}-\d{2}-\d{2}_/, "").replace(/\s+/g, " ").trim();
}

function driveBusinessDuplicateKey(input: {
  supplierName?: string | null;
  invoiceNumber?: string | null;
  amount?: number | string | null;
  invoiceDate?: Date | string | null;
}) {
  if (!input.supplierName || !input.invoiceNumber || input.amount == null || !input.invoiceDate) return null;
  const date = normalizeDocumentDate(input.invoiceDate, new Date()).toISOString().slice(0, 10);
  const amount = typeof input.amount === "number" ? input.amount.toFixed(2) : normalizeAmountText(input.amount);
  return [
    canonicalSupplierFolderKey(input.supplierName),
    String(input.invoiceNumber).trim().toLowerCase(),
    amount,
    date,
  ].join("|");
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
      `'${input.rootFolderId}' in parents and appProperties has { key='supplierTaxId' and value='${escapeDriveQueryValue(input.supplierTaxId)}' } and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const id = byTaxId.data.files?.[0]?.id;
    if (id) return id;
  }

  const bySupplierKey = await findDriveFolder(
    drive,
    `'${input.rootFolderId}' in parents and appProperties has { key='supplierKey' and value='${escapeDriveQueryValue(input.supplierKey)}' } and mimeType='application/vnd.google-apps.folder' and trashed=false`
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
  console.log(
    `[drive] DRIVE_FOLDER_CREATED name="${input.supplierName}" folderId=${created.data.id} parentId=${input.rootFolderId}`
  );
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
    fields: "id, name, parents, trashed",
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

async function writeFolderCacheMetadata(organizationId: string, folderPath: string, folderId: string) {
  const existing = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider: "drive" } },
    select: { metadata: true },
  });
  const metadata = parseDriveMetadata(existing?.metadata);
  const nextMetadata: DriveIntegrationMetadata = {
    ...metadata,
    folderCache: {
      ...(metadata.folderCache ?? {}),
      [folderPath]: { folderId, folderPath, updatedAt: new Date().toISOString() },
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

function isUnknownSupplierName(name?: string | null) {
  const normalized = normalizeFolderText(name ?? "").toLowerCase();
  return /^(unknown|unknown supplier|unknown vendor|לא זוהה|לא ידוע|ספק לא מזוהה)(?:\s+-\s+.*)?$/i.test(normalized);
}

function normalizeDocumentDate(value: Date | string | null | undefined, fallback: Date) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

export function buildInvoiceDriveFolderPath(input: {
  rootFolderName?: string | null;
  clientName: string;
  supplierName: string;
  documentType?: string | null;
  reviewStatus?: DriveDocumentReviewStatus | null;
  documentDate: Date;
}) {
  return buildInvoiceDriveFolderPathParts(input).join("/");
}

export function buildInvoiceDriveFolderPathParts(input: {
  rootFolderName?: string | null;
  clientName: string;
  supplierName: string;
  documentType?: string | null;
  reviewStatus?: DriveDocumentReviewStatus | null;
  documentDate: Date;
}) {
  const rootFolderName = safeFolderName(input.rootFolderName || INVOICE_DRIVE_FOLDER_NAME);
  const clientName = normalizedClientFolderName(input.clientName);
  const supplierName = normalizedSupplierFolderName(input.supplierName);
  const categoryFolder = driveDocumentCategoryFolder({
    documentType: input.documentType ?? "invoice",
    reviewStatus: input.reviewStatus ?? null,
    supplierName,
  });
  return [
    rootFolderName,
    DRIVE_FOLDER_NAMES.clients,
    clientName,
    String(input.documentDate.getFullYear()),
    monthFolderName(input.documentDate),
    DRIVE_FOLDER_NAMES.suppliers,
    supplierName,
    categoryFolder,
  ];
}

function monthFolderName(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")} - ${HEBREW_MONTH_NAMES[date.getMonth()] ?? "חודש לא מזוהה"}`;
}

function normalizedClientFolderName(name: string) {
  const normalized = safeFolderName(name || DRIVE_FOLDER_NAMES.unknownClient);
  return /^(unknown|unknown client|unassigned client|לא מזוהה)$/i.test(normalized) ? DRIVE_FOLDER_NAMES.unknownClient : normalized || DRIVE_FOLDER_NAMES.unknownClient;
}

function driveDocumentCategoryFolder(input: { documentType?: string | null; reviewStatus?: DriveDocumentReviewStatus | null; supplierName?: string | null }) {
  if (isNeedsReviewDocument(input) || isUnknownSupplierName(input.supplierName) || isUncertainDocument(input.documentType)) return DRIVE_FOLDER_NAMES.needsReview;
  if (isReceiptDocument(input.documentType)) return DRIVE_FOLDER_NAMES.receipts;
  if (isInvoiceDocument(input.documentType)) return DRIVE_FOLDER_NAMES.invoices;
  return DRIVE_FOLDER_NAMES.needsReview;
}

function isNeedsReviewDocument(input: { documentType?: string | null; reviewStatus?: DriveDocumentReviewStatus | null }) {
  return input.reviewStatus === "needs_review" || input.documentType === "unknown_needs_review";
}

function isUncertainDocument(documentType?: string | null) {
  return /^(unknown|unknown_needs_review|other|quote|supplier_message|payment_request)$/i.test(documentType ?? "");
}

function isInvoiceDocument(documentType?: string | null) {
  return /^(invoice|tax_invoice|tax_invoice_receipt|regular_invoice)$/i.test(documentType ?? "");
}

function isReceiptDocument(documentType?: string | null) {
  return /^(receipt|payment_receipt|payment|payment_confirmation)$/i.test(documentType ?? "");
}

const HEBREW_MONTH_NAMES = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

async function resolveDriveClientName(organizationId: string, clientId?: string | null, clientName?: string | null) {
  if (clientName?.trim()) return safeFolderName(clientName);
  if (clientId) {
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId },
      select: { name: true },
    });
    if (client?.name) return safeFolderName(client.name);
  }
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { businessName: true, name: true },
  });
  return normalizedClientFolderName(organization?.businessName || organization?.name || "לקוח לא מזוהה");
}

export function buildInvoiceDriveFilename(
  originalFilename: string,
  supplierName: string | null | undefined,
  invoiceNumber: string | null | undefined,
  invoiceDate: Date,
  amount: number | null
) {
  const extension = driveFileExtension(originalFilename);
  const supplierPart = safeFilenamePart(supplierName || "unknown-supplier");
  const invoicePart = safeFilenamePart(invoiceNumber || "no-invoice-number");
  const datePart = invoiceDate.toISOString().slice(0, 10);
  const amountPart = amount === null ? "unknown" : safeFilenamePart(formatAmountForFilename(amount));
  return `${supplierPart}_${invoicePart}_${datePart}_${amountPart}${extension}`;
}

function driveFileExtension(filename: string) {
  const match = filename.match(/(\.[A-Za-z0-9]{2,8})$/);
  return match?.[1]?.toLowerCase() ?? ".pdf";
}

function safeFilenamePart(value: string) {
  return value.trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

function formatAmountForFilename(amount: number) {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/\.?0+$/, "");
}

function normalizeAmountText(value: string) {
  const numeric = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? numeric.toFixed(2) : value.trim().toLowerCase();
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
