import { Router, type Request, type Response, type RequestHandler } from "express";
import { errorDetails } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import {
  buildConfidenceInputFromEntity,
  evaluateAndRecordConfidenceDecision,
  loadConfidenceThresholds,
  type ConfidenceEntityType,
} from "../services/confidenceGates/index.js";
import { requirePermissionMiddleware } from "../services/rbac/rbacMiddleware.js";
import type { PlatformPermission } from "../services/rbac/permissions.js";

const SUPPORTED_ENTITY_TYPES = new Set<ConfidenceEntityType>([
  "financial_document_review",
  "gmail_scan_item",
  "supplier_payment",
]);

export type ConfidenceRouteDeps = {
  loadThresholds: typeof loadConfidenceThresholds;
  buildInput: typeof buildConfidenceInputFromEntity;
  evaluate: typeof evaluateAndRecordConfidenceDecision;
  requirePermission?: (permission: PlatformPermission) => RequestHandler;
};

const defaultDeps: ConfidenceRouteDeps = {
  loadThresholds: loadConfidenceThresholds,
  buildInput: buildConfidenceInputFromEntity,
  evaluate: evaluateAndRecordConfidenceDecision,
};

export function createConfidenceRouter(deps: ConfidenceRouteDeps = defaultDeps): Router {
  const router = Router();
  const guard = (permission: PlatformPermission) =>
    deps.requirePermission?.(permission) ?? requirePermissionMiddleware(permission);

  router.get("/confidence/:entityId", guard("reliability.view"), async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const entityId = String(req.params.entityId);
    const entityTypeRaw = typeof req.query.entityType === "string" ? req.query.entityType : null;
    if (!entityTypeRaw || !SUPPORTED_ENTITY_TYPES.has(entityTypeRaw as ConfidenceEntityType)) {
      res.status(400).json({
        error: "entityType query parameter is required (financial_document_review | gmail_scan_item | supplier_payment)",
      });
      return;
    }
    const entityType = entityTypeRaw as ConfidenceEntityType;

    try {
      const [thresholds, input] = await Promise.all([
        deps.loadThresholds(organizationId, prisma),
        deps.buildInput(organizationId, entityType, entityId, prisma),
      ]);
      if (!input) {
        res.status(404).json({ error: "Entity not found" });
        return;
      }

      const result = deps.evaluate(input, thresholds, {
        sourceRoute: "GET /confidence/:entityId",
        actorId: req.auth!.userId,
      });

      res.json({
        organizationId,
        entityType,
        entityId,
        score: result.confidenceScore,
        decision: result.decision,
        confidenceLevel: result.confidenceLevel,
        explanation: result.explanation,
        evidence: {
          supporting: result.supportingEvidence,
          missing: result.missingEvidence,
        },
        blockingReasons: result.blockingReasons,
        recommendedAction: result.recommendedAction,
        thresholds: result.thresholds,
        evaluatedAt: result.evaluatedAt,
      });
    } catch (err) {
      console.error("[confidence]", errorDetails(err));
      res.status(500).json({ error: "Confidence evaluation failed" });
    }
  });

  return router;
}

export const confidenceRouter = createConfidenceRouter();
