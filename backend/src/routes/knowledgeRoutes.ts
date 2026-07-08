/**
 * Knowledge Center HTTP routes.
 *
 * Thin transport layer over the knowledge services — all logic lives in
 * `services/knowledge/*`. Organization is always taken from `req.auth`, never
 * from the request body, so there is no cross-organization access.
 */

import { Router, type Request, type Response } from "express";
import { requirePerm } from "../services/rbac/index.js";
import { processKnowledgeCommand } from "../services/knowledge/knowledgeAIService.js";
import {
  createKnowledgeDocument,
  searchKnowledgeDocuments,
} from "../services/knowledge/knowledgeRepository.js";
import { isKnowledgeCategory, type KnowledgeCategory } from "../services/knowledge/knowledgeTypes.js";

export const knowledgeRouter = Router();

const requireKnowledgeViewPermission = requirePerm("document.view");
const requireKnowledgeUploadPermission = requirePerm("document.upload");

function handleRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      const status = message.includes("required") || message.includes("cannot") ? 400 : 500;
      res.status(status).json({ error: { code: "KNOWLEDGE_ERROR", message } });
    }
  };
}

function requireText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("text is required");
  }
  return value.trim();
}

function rejectOrganizationIdInBody(body: Record<string, unknown>): void {
  if ("organizationId" in body) {
    throw new Error("organizationId cannot be set in request body");
  }
}

function parseCategoryParam(value: unknown): KnowledgeCategory | null {
  if (typeof value === "string" && isKnowledgeCategory(value)) return value;
  return null;
}

/** Natural-language lookup — same engine as chat/voice/WhatsApp. */
knowledgeRouter.post(
  "/knowledge/ai/command",
  requireKnowledgeViewPermission,
  handleRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    rejectOrganizationIdInBody(body);
    const text = requireText(body.text);
    const response = await processKnowledgeCommand({
      organizationId: req.auth!.organizationId,
      userId: req.auth!.userId,
      text,
    });
    res.status(200).json(response);
  })
);

/** Structured search (filters via query string). */
knowledgeRouter.get(
  "/knowledge/documents",
  requireKnowledgeViewPermission,
  handleRoute(async (req, res) => {
    const query = req.query as Record<string, unknown>;
    const subject = typeof query.q === "string" ? query.q : typeof query.subject === "string" ? query.subject : null;
    const fileName = typeof query.fileName === "string" ? query.fileName : null;
    const tag = typeof query.tag === "string" ? query.tag : null;
    const documents = await searchKnowledgeDocuments({
      organizationId: req.auth!.organizationId,
      category: parseCategoryParam(query.category),
      subject,
      fileName,
      tag,
    });
    res.status(200).json({ documents, count: documents.length });
  })
);

/** Register a document in the repository (upload/import path). */
knowledgeRouter.post(
  "/knowledge/documents",
  requireKnowledgeUploadPermission,
  handleRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    rejectOrganizationIdInBody(body);
    const title = requireText(body.title);
    const category = parseCategoryParam(body.category) ?? "other";
    const document = await createKnowledgeDocument({
      organizationId: req.auth!.organizationId,
      category,
      title,
      fileName: typeof body.fileName === "string" ? body.fileName : null,
      clientId: typeof body.clientId === "string" ? body.clientId : null,
      customerName: typeof body.customerName === "string" ? body.customerName : null,
      supplierName: typeof body.supplierName === "string" ? body.supplierName : null,
      supplierTaxId: typeof body.supplierTaxId === "string" ? body.supplierTaxId : null,
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
