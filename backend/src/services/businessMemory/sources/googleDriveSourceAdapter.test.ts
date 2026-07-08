import test from "node:test";
import assert from "node:assert/strict";

import {
  inferDocumentTypeFromFileName,
  mapDriveFileToUpsertInput,
  discoverDriveDocuments,
  syncGoogleDriveMetadata,
  type DriveFileMetadata,
} from "./googleDriveSourceAdapter.js";
import { prisma } from "../../../lib/prisma.js";

test("inferDocumentTypeFromFileName maps Hebrew and English hints", () => {
  assert.equal(inferDocumentTypeFromFileName("חוזה-שרית.pdf"), "contract");
  assert.equal(inferDocumentTypeFromFileName("warranty-ac.pdf"), "warranty");
  assert.equal(inferDocumentTypeFromFileName("random-notes.pdf"), "other");
});

test("mapDriveFileToUpsertInput registers google_drive source metadata", () => {
  const file: DriveFileMetadata = {
    id: "file-abc",
    name: "חוזה-שרית.pdf",
    webViewLink: "https://drive.google.com/file/d/file-abc/view",
    modifiedTime: "2026-07-01T12:00:00.000Z",
    mimeType: "application/pdf",
    parentFolderName: "שרית",
  };
  const input = mapDriveFileToUpsertInput(file, "org-1");
  assert.equal(input.source, "google_drive");
  assert.equal(input.driveFileId, "file-abc");
  assert.equal(input.documentType, "contract");
  assert.equal(input.customer, "שרית");
});

test("syncGoogleDriveMetadata discovers files and upserts without duplicates", async () => {
  const stored: Array<Record<string, unknown>> = [];
  const mockDrive = {
    files: {
      list: async (args: { q: string; pageToken?: string }) => {
        if (args.q.includes("mimeType='application/vnd.google-apps.folder'")) {
          return { data: { files: [], nextPageToken: null } };
        }
        return {
          data: {
            files: [
              {
                id: "gd-1",
                name: "חוזה-דני.pdf",
                mimeType: "application/pdf",
                webViewLink: "https://drive.google.com/gd-1",
                modifiedTime: "2026-07-02T10:00:00.000Z",
              },
            ],
            nextPageToken: null,
          },
        };
      },
    },
  };

  (prisma as any).knowledgeDocument.findFirst = async (args: any) => {
    const where = args.where ?? {};
    const found = stored.find((r) =>
      Object.entries(where).every(([key, val]) => (r as Record<string, unknown>)[key] === val)
    );
    return found ?? null;
  };
  (prisma as any).knowledgeDocument.create = async (args: any) => {
    const uploadedAt = new Date();
    const row = {
      id: `id-${stored.length + 1}`,
      organizationId: args.data.organizationId,
      source: args.data.source ?? "manual",
      category: args.data.category,
      title: args.data.title,
      fileName: args.data.fileName ?? null,
      customerName: args.data.customerName ?? null,
      supplierName: args.data.supplierName ?? null,
      tags: args.data.tags ?? [],
      driveUrl: args.data.driveUrl ?? null,
      driveFileId: args.data.driveFileId ?? null,
      storageLocation: args.data.storageLocation ?? null,
      metadata: args.data.metadata ?? null,
      createdAt: uploadedAt,
      updatedAt: uploadedAt,
      uploadedAt: args.data.uploadedAt ?? uploadedAt,
    };
    stored.push(row);
    return row;
  };
  (prisma as any).knowledgeDocument.update = async (args: any) => {
    const idx = stored.findIndex((r) => r.id === args.where.id);
    if (idx < 0) throw new Error("not found");
    stored[idx] = { ...stored[idx], ...args.data, updatedAt: new Date() };
    return stored[idx];
  };

  const files = await discoverDriveDocuments(mockDrive as any, "root-folder");
  assert.equal(files.length, 1);

  const result = await syncGoogleDriveMetadata("org-sync", {
    getGoogleClients: async () => ({ drive: mockDrive }) as any,
    ensureInvoiceFolderTree: async () => "root-folder",
  });

  assert.equal(result.discovered, 1);
  assert.equal(result.registered, 1);
  assert.equal(stored.length, 1);

  const second = await syncGoogleDriveMetadata("org-sync", {
    getGoogleClients: async () => ({ drive: mockDrive }) as any,
    ensureInvoiceFolderTree: async () => "root-folder",
  });
  assert.equal(second.updated, 1);
  assert.equal(second.registered, 0);
  assert.equal(stored.length, 1);
});
