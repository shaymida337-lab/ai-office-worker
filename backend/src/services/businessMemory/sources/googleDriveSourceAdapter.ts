/**
 * Google Drive source adapter (Phase 2) — metadata only.
 *
 * Discovers files in the organization's Drive folder tree, registers metadata
 * into Business Memory, synchronizes updates, and avoids duplicates via
 * driveFileId upsert. Does NOT read file content, OCR, or change invoice OCR.
 */

import type { drive_v3 } from "googleapis";
import { getGoogleClients } from "../../google.js";
import { ensureInvoiceFolderTree, DRIVE_FOLDER_NAMES } from "../../driveService.js";
import {
  upsertBusinessMemoryDocument,
  findBusinessMemoryByDriveFileId,
} from "../businessMemoryRepository.js";
import type { BusinessMemoryDocumentType } from "../businessMemoryTypes.js";
import { isKnowledgeCategory } from "../businessMemoryTypes.js";

export type DriveFileMetadata = {
  id: string;
  name: string;
  webViewLink: string | null;
  modifiedTime: string | null;
  mimeType: string | null;
  parentFolderName: string | null;
};

export type GoogleDriveSyncResult = {
  discovered: number;
  registered: number;
  updated: number;
  skipped: number;
  errors: string[];
};

const FOLDER_MIME = "application/vnd.google-apps.folder";
const MAX_FOLDER_DEPTH = 5;

/** Infer document type from filename heuristics (metadata only, no content scan). */
export function inferDocumentTypeFromFileName(fileName: string): BusinessMemoryDocumentType {
  const lower = fileName.toLowerCase();
  const hebrew = fileName;
  if (/חוז|contract/u.test(hebrew) || /contract/.test(lower)) return "contract";
  if (/הסכם|agreement/u.test(hebrew) || /agreement/.test(lower)) return "agreement";
  if (/אחריות|warranty/u.test(hebrew) || /warranty/.test(lower)) return "warranty";
  if (/הצע|quote|quotation/u.test(hebrew) || /quotation|quote/.test(lower)) return "quotation";
  if (/מדריך|הוראות|manual/u.test(hebrew) || /manual|guide/.test(lower)) return "manual";
  if (/רישיון|רשיון|license/u.test(hebrew) || /license/.test(lower)) return "license";
  if (/תעוד|certificate/u.test(hebrew) || /certificate/.test(lower)) return "certificate";
  return "other";
}

function inferCustomerFromContext(fileName: string, parentFolderName: string | null): string | null {
  if (!parentFolderName) return null;
  if (parentFolderName === DRIVE_FOLDER_NAMES.clients) return null;
  // Files inside Clients/<name>/… inherit the client folder name.
  return parentFolderName.trim() || null;
}

export function mapDriveFileToUpsertInput(
  file: DriveFileMetadata,
  organizationId: string
): Parameters<typeof upsertBusinessMemoryDocument>[0] {
  const documentType = inferDocumentTypeFromFileName(file.name);
  const customer = inferCustomerFromContext(file.name, file.parentFolderName);
  return {
    organizationId,
    source: "google_drive",
    documentType,
    title: file.name.replace(/\.[^.]+$/, "").trim() || file.name,
    fileName: file.name,
    customer,
    driveUrl: file.webViewLink,
    driveFileId: file.id,
    uploadedAt: file.modifiedTime ? new Date(file.modifiedTime) : undefined,
    metadata: {
      mimeType: file.mimeType,
      parentFolderName: file.parentFolderName,
      syncedAt: new Date().toISOString(),
    },
  };
}

/** List non-folder files under a Drive folder (one level). */
export async function listDriveFilesInFolder(
  drive: drive_v3.Drive,
  folderId: string,
  parentFolderName: string | null
): Promise<DriveFileMetadata[]> {
  const files: DriveFileMetadata[] = [];
  let pageToken: string | undefined;
  do {
    const result = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken, files(id, name, mimeType, webViewLink, modifiedTime)",
      pageSize: 200,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const file of result.data.files ?? []) {
      if (!file.id || !file.name) continue;
      if (file.mimeType === FOLDER_MIME) continue;
      files.push({
        id: file.id,
        name: file.name,
        webViewLink: file.webViewLink ?? null,
        modifiedTime: file.modifiedTime ?? null,
        mimeType: file.mimeType ?? null,
        parentFolderName,
      });
    }
    pageToken = result.data.nextPageToken ?? undefined;
  } while (pageToken);
  return files;
}

/** Walk the business folder tree and collect file metadata (no content download). */
export async function discoverDriveDocuments(
  drive: drive_v3.Drive,
  rootFolderId: string
): Promise<DriveFileMetadata[]> {
  const discovered: DriveFileMetadata[] = [];
  const queue: Array<{ folderId: string; folderName: string | null; depth: number }> = [
    { folderId: rootFolderId, folderName: null, depth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > MAX_FOLDER_DEPTH) continue;

    const files = await listDriveFilesInFolder(drive, current.folderId, current.folderName);
    discovered.push(...files);

    if (current.depth >= MAX_FOLDER_DEPTH) continue;

    let pageToken: string | undefined;
    do {
      const result = await drive.files.list({
        q: `'${current.folderId}' in parents and trashed=false and mimeType='${FOLDER_MIME}'`,
        fields: "nextPageToken, files(id, name)",
        pageSize: 100,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const folder of result.data.files ?? []) {
        if (!folder.id || !folder.name) continue;
        queue.push({
          folderId: folder.id,
          folderName: folder.name,
          depth: current.depth + 1,
        });
      }
      pageToken = result.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  return discovered;
}

export type GoogleDriveSyncDeps = {
  getGoogleClients?: typeof getGoogleClients;
  ensureInvoiceFolderTree?: typeof ensureInvoiceFolderTree;
};

/**
 * Synchronize Google Drive file metadata into Business Memory.
 * Idempotent: re-running updates existing rows matched by driveFileId.
 */
export async function syncGoogleDriveMetadata(
  organizationId: string,
  deps: GoogleDriveSyncDeps = {}
): Promise<GoogleDriveSyncResult> {
  const getClients = deps.getGoogleClients ?? getGoogleClients;
  const ensureTree = deps.ensureInvoiceFolderTree ?? ensureInvoiceFolderTree;

  const result: GoogleDriveSyncResult = {
    discovered: 0,
    registered: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  let drive: drive_v3.Drive;
  try {
    const clients = await getClients(organizationId);
    drive = clients.drive;
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }

  let rootFolderId: string;
  try {
    rootFolderId = await ensureTree(drive);
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }

  const files = await discoverDriveDocuments(drive, rootFolderId);
  result.discovered = files.length;

  for (const file of files) {
    try {
      const existing = await findBusinessMemoryByDriveFileId(organizationId, file.id);
      const input = mapDriveFileToUpsertInput(file, organizationId);
      if (input.documentType && !isKnowledgeCategory(input.documentType)) {
        input.documentType = "other";
      }
      await upsertBusinessMemoryDocument(input);
      if (existing) result.updated += 1;
      else result.registered += 1;
    } catch (err) {
      result.skipped += 1;
      result.errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
