import express from "express";
import test from "node:test";
import assert from "node:assert/strict";

import type { JwtPayload } from "../lib/auth.js";
import { createConfidenceRouter } from "./confidenceRoutes.js";
import { allowAllPermissionsMiddleware } from "../services/rbac/rbacMiddleware.js";
import type { ConfidenceEvaluationInput, ConfidenceResult } from "../services/confidenceGates/confidenceTypes.js";
import { DEFAULT_CONFIDENCE_THRESHOLDS } from "../services/confidenceGates/confidenceConfig.js";

const ORG = "org-confidence";
const AUTH: JwtPayload = { organizationId: ORG, userId: "user-1", email: "u@example.com" };

function sampleResult(decision: ConfidenceResult["decision"]): ConfidenceResult {
  return {
    decision,
    confidenceScore: decision === "AUTO_EXECUTE" ? 0.95 : 0.7,
    confidenceLevel: decision === "BLOCKED" ? "critical" : "medium",
    explanation: `Decision: ${decision}`,
    supportingEvidence: [],
    missingEvidence: [],
    blockingReasons: decision === "BLOCKED" ? ["policy"] : [],
    recommendedAction: "test",
    thresholds: DEFAULT_CONFIDENCE_THRESHOLDS,
    evaluatedAt: new Date().toISOString(),
  };
}

function createTestRouter(input: ConfidenceEvaluationInput | null) {
  return createConfidenceRouter({
    requirePermission: () => allowAllPermissionsMiddleware(),
    loadThresholds: async () => DEFAULT_CONFIDENCE_THRESHOLDS,
    buildInput: async () => input,
    evaluate: (evalInput, thresholds) => ({
      ...sampleResult(evalInput.confidenceScore && evalInput.confidenceScore >= thresholds.autoExecuteMin ? "AUTO_EXECUTE" : "REVIEW_REQUIRED"),
      confidenceScore: evalInput.confidenceScore ?? 0,
      thresholds,
    }),
  });
}

function createAuthedApp(router: express.Router) {
  const app = express();
  app.use((req, _res, next) => {
    req.auth = AUTH;
    next();
  });
  app.use(router);
  return app;
}

async function withServer(app: express.Express, fn: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test("GET /confidence/:entityId requires entityType", async () => {
  const app = createAuthedApp(createTestRouter(null));
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/confidence/review-1`);
    assert.equal(res.status, 400);
  });
});

test("GET /confidence/:entityId returns score decision evidence thresholds", async () => {
  const input: ConfidenceEvaluationInput = {
    organizationId: ORG,
    entityType: "financial_document_review",
    entityId: "review-1",
    confidenceScore: 0.95,
    ocrConfidence: null,
    amount: 100,
    amountConfidence: null,
    supplierName: "Acme",
    supplierMatchConfidence: null,
    documentType: "tax_invoice",
    paymentDirection: "incoming_expense",
    hasAttachment: true,
    isDuplicateSuspicion: false,
    isConfirmedDuplicate: false,
    hasConflictingAmounts: false,
    missingSupplier: false,
    unsupportedDocument: false,
    corruptedDocument: false,
    sourceTrusted: true,
    permissionDenied: false,
    crossOrgMismatch: false,
    integrityCritical: false,
    integrityWarning: false,
    businessRuleViolations: [],
    aiAuditorObjections: [],
    trustEngineConfidence: null,
    historicalConsistency: null,
  };
  const app = createAuthedApp(createTestRouter(input));
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/confidence/review-1?entityType=financial_document_review`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.organizationId, ORG);
    assert.equal(body.entityId, "review-1");
    assert.equal(body.decision, "AUTO_EXECUTE");
    assert.ok(body.score >= 0.9);
    assert.ok(body.evidence);
    assert.ok(body.thresholds);
    assert.ok(body.explanation);
  });
});

test("GET /confidence/:entityId returns 404 when entity missing", async () => {
  const app = createAuthedApp(createTestRouter(null));
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/confidence/missing?entityType=financial_document_review`);
    assert.equal(res.status, 404);
  });
});

test("confidence route layer is read-only GET", () => {
  const router = createConfidenceRouter({
    requirePermission: () => allowAllPermissionsMiddleware(),
    loadThresholds: async () => DEFAULT_CONFIDENCE_THRESHOLDS,
    buildInput: async () => null,
    evaluate: () => sampleResult("REVIEW_REQUIRED"),
  });
  const stack = (router as unknown as { stack: Array<{ route?: { methods?: Record<string, boolean>; path?: string } }> }).stack;
  const routes = stack
    .map((layer) => layer.route)
    .filter(Boolean)
    .map((route) => ({ methods: Object.keys(route!.methods ?? {}), path: route!.path }));
  assert.deepEqual(routes, [{ methods: ["get"], path: "/confidence/:entityId" }]);
});
