/**
 * Natalie Business Memory HTTP routes.
 *
 * Thin transport — all logic in services/businessMemory/*. Organization is always
 * taken from req.auth; never from the request body.
 */

import { Router, type Request, type Response } from "express";
import { requirePerm } from "../services/rbac/index.js";
import { processBusinessMemoryCommand } from "../services/businessMemory/businessMemoryAIService.js";
import {
  searchBusinessMemory,
  upsertBusinessMemoryDocument,
} from "../services/businessMemory/businessMemoryRepository.js";
import { buildCustomerWorkspace } from "../services/businessMemory/customerWorkspace.js";
import { syncGoogleDriveMetadata } from "../services/businessMemory/sources/googleDriveSourceAdapter.js";
import {
  isKnowledgeCategory,
  type BusinessMemoryDocumentType,
} from "../services/businessMemory/businessMemoryTypes.js";

export const businessMemoryRouter = Router();

const requireMemoryView = requirePerm("document.view");
const requireMemoryUpload = requirePerm("document.upload");
const requireDriveConnect = requirePerm("integrations.drive.connect");

function handleRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      const status = message.includes("required") || message.includes("cannot") ? 400 : 500;
      res.status(status).json({ error: { code: "BUSINESS_MEMORY_ERROR", message } });
    }
  };
}

function requireText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("text is required");
  return value.trim();
}

function rejectOrganizationIdInBody(body: Record<string, unknown>): void {
  if ("organizationId" in body) throw new Error("organizationId cannot be set in request body");
}

function parseDocumentType(value: unknown): BusinessMemoryDocumentType | null {
  if (typeof value === "string" && isKnowledgeCategory(value)) return value;
  return null;
}

/** Natural-language lookup — same engine as chat/voice/WhatsApp. */
businessMemoryRouter.post(
  "/business-memory/ai/command",
  requireMemoryView,
  handleRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    rejectOrganizationIdInBody(body);
    const response = await processBusinessMemoryCommand({
      organizationId: req.auth!.organizationId,
      userId: req.auth!.userId,
      text: requireText(body.text),
    });
    res.status(200).json(response);
  })
);

/** Structured unified search. */
businessMemoryRouter.get(
  "/business-memory/documents",
  requireMemoryView,
  handleRoute(async (req, res) => {
    const query = req.query as Record<string, unknown>;
    const subject =
      typeof query.q === "string" ? query.q : typeof query.subject === "string" ? query.subject : null;
    const documents = await searchBusinessMemory({
      organizationId: req.auth!.organizationId,
      documentType: parseDocumentType(query.documentType ?? query.category),
      subject,
      title: typeof query.title === "string" ? query.title : null,
      fileName: typeof query.fileName === "string" ? query.fileName : null,
      tag: typeof query.tag === "string" ? query.tag : null,
      source: typeof query.source === "string" ? (query.source as "manual" | "google_drive" | "knowledge") : null,
    });
    res.status(200).json({ documents, count: documents.length });
  })
);

/** Register a document (manual upload path). */
businessMemoryRouter.post(
  "/business-memory/documents",
  requireMemoryUpload,
  handleRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    rejectOrganizationIdInBody(body);
    const document = await upsertBusinessMemoryDocument({
      organizationId: req.auth!.organizationId,
      source: "manual",
      documentType: parseDocumentType(body.documentType ?? body.category) ?? "other",
      title: requireText(body.title),
      fileName: typeof body.fileName === "string" ? body.fileName : null,
      clientId: typeof body.clientId === "string" ? body.clientId : null,
      customer: typeof body.customerName === "string" ? body.customerName : typeof body.customer === "string" ? body.customer : null,
      supplier: typeof body.supplierName === "string" ? body.supplierName : typeof body.supplier === "string" ? body.supplier : null,
      tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [],
      storageLocation: typeof body.storageLocation === "string" ? body.storageLocation : null,
      driveUrl: typeof body.driveUrl === "string" ? body.driveUrl : null,
      driveFileId: typeof body.driveFileId === "string" ? body.driveFileId : null,
      createdById: req.auth!.userId,
      createdByName: typeof body.createdByName === "string" ? body.createdByName : null,
    });
    res.status(201).json({ document });
  })
);

/** Google Drive metadata sync (no OCR, no content scan). */
businessMemoryRouter.post(
  "/business-memory/sync/drive",
  requireDriveConnect,
  handleRoute(async (req, res) => {
    const result = await syncGoogleDriveMetadata(req.auth!.organizationId);
    res.status(200).json(result);
  })
);

/** Customer workspace foundation (architecture preview, no UI). */
businessMemoryRouter.get(
  "/business-memory/workspace/:customerName",
  requireMemoryView,
  handleRoute(async (req, res) => {
    const rawName = req.params.customerName;
    const customerName = decodeURIComponent(
      Array.isArray(rawName) ? (rawName[0] ?? "") : (rawName ?? "")
    ).trim();
    if (!customerName) throw new Error("customerName is required");
    const workspace = await buildCustomerWorkspace({
      organizationId: req.auth!.organizationId,
      customerName,
      clientId: typeof req.query.clientId === "string" ? req.query.clientId : null,
    });
    res.status(200).json({ workspace });
  })
);
