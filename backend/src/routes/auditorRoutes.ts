import { Router, type Request, type Response, type RequestHandler } from "express";
import { errorDetails } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import {
  buildAuditorInputFromEntity,
  evaluateAndRecordAuditorReport,
  loadAuditorConfig,
  type AuditorEntityType,
  type AuditorFullReport,
} from "../services/aiAuditor/index.js";
import { requirePermissionMiddleware } from "../services/rbac/rbacMiddleware.js";
import type { PlatformPermission } from "../services/rbac/permissions.js";

const SUPPORTED_ENTITY_TYPES = new Set<AuditorEntityType>([
  "financial_document_review",
  "gmail_scan_item",
  "supplier_payment",
]);

export type AuditorRouteDeps = {
  loadConfig: typeof loadAuditorConfig;
  buildInput: typeof buildAuditorInputFromEntity;
  evaluate: typeof evaluateAndRecordAuditorReport;
  requirePermission?: (permission: PlatformPermission) => RequestHandler;
};

const defaultDeps: AuditorRouteDeps = {
  loadConfig: loadAuditorConfig,
  buildInput: buildAuditorInputFromEntity,
  evaluate: evaluateAndRecordAuditorReport,
};

function toApiResponse(
  organizationId: string,
  entityType: AuditorEntityType,
  entityId: string,
  report: AuditorFullReport,
) {
  return {
    organizationId,
    entityType,
    entityId,
    primary: report.primary,
    auditor: {
      decision: report.auditor.auditorDecision,
      confidence: report.auditor.auditorConfidence,
      findings: report.auditor.findings,
      supportingEvidence: report.auditor.supportingEvidence,
      conflictingEvidence: report.auditor.conflictingEvidence,
      explanation: report.auditor.explanation,
      recommendedAction: report.auditor.recommendedAction,
      evaluatedAt: report.auditor.evaluatedAt,
    },
    comparison: report.comparison,
    differences: report.comparison.differences,
    explanation: report.comparison.explanation,
    recommendation: report.recommendation,
    confidenceGateHint: report.confidenceGateHint,
  };
}

export function createAuditorRouter(deps: AuditorRouteDeps = defaultDeps): Router {
  const router = Router();
  const guard = (permission: PlatformPermission) =>
    deps.requirePermission?.(permission) ?? requirePermissionMiddleware(permission);

  router.get("/auditor/:entityId", guard("reliability.view"), async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const entityId = String(req.params.entityId);
    const entityTypeRaw = typeof req.query.entityType === "string" ? req.query.entityType : null;
    if (!entityTypeRaw || !SUPPORTED_ENTITY_TYPES.has(entityTypeRaw as AuditorEntityType)) {
      res.status(400).json({
        error: "entityType query parameter is required (financial_document_review | gmail_scan_item | supplier_payment)",
      });
      return;
    }
    const entityType = entityTypeRaw as AuditorEntityType;

    try {
      const [config, input] = await Promise.all([
        deps.loadConfig(organizationId, prisma),
        deps.buildInput(organizationId, entityType, entityId, prisma),
      ]);
      if (!input) {
        res.status(404).json({ error: "Entity not found" });
        return;
      }

      const report = deps.evaluate(input, config, {
        sourceRoute: "GET /auditor/:entityId",
        actorId: req.auth!.userId,
      });

      res.json(toApiResponse(organizationId, entityType, entityId, report));
    } catch (err) {
      console.error("[auditor]", errorDetails(err));
      res.status(500).json({ error: "Auditor evaluation failed" });
    }
  });

  return router;
}

export const auditorRouter = createAuditorRouter();
