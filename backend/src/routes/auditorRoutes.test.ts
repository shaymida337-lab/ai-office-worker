import express from "express";
import test from "node:test";
import assert from "node:assert/strict";

import type { JwtPayload } from "../lib/auth.js";
import { createAuditorRouter } from "./auditorRoutes.js";
import { allowAllPermissionsMiddleware } from "../services/rbac/rbacMiddleware.js";
import type { AuditorEvaluationInput, AuditorFullReport } from "../services/aiAuditor/auditorTypes.js";
import { DEFAULT_AUDITOR_CONFIG } from "../services/aiAuditor/auditorConfig.js";
import { evaluateAuditorReport } from "../services/aiAuditor/auditorEngine.js";

const ORG = "org-auditor";
const AUTH: JwtPayload = { organizationId: ORG, userId: "user-1", email: "u@example.com" };

function sampleInput(): AuditorEvaluationInput {
  return {
    primary: {
      organizationId: ORG,
      entityType: "financial_document_review",
      entityId: "review-1",
      correlationId: "gmail:msg-1",
      supplierName: "Acme",
      amount: 1000,
      invoiceNumber: "INV-1",
      documentType: "tax_invoice",
      paymentDirection: "incoming_expense",
      confidenceScore: 0.9,
      isFinancial: true,
      isDuplicate: false,
      isDuplicateSuspicion: false,
      autoExecuteRecommended: true,
      crossOrgMismatch: false,
    },
    independent: {
      supplierName: "Acme",
      amount: 1000,
      invoiceNumber: "INV-1",
      documentType: "tax_invoice",
      paymentDirection: "incoming_expense",
      confidenceScore: 0.88,
      isFinancial: true,
      isDuplicate: false,
      isDuplicateSuspicion: false,
    },
  };
}

function createTestRouter(input: AuditorEvaluationInput | null, reportOverride?: AuditorFullReport) {
  return createAuditorRouter({
    requirePermission: () => allowAllPermissionsMiddleware(),
    loadConfig: async () => DEFAULT_AUDITOR_CONFIG,
    buildInput: async () => input,
    evaluate: (evalInput, config) =>
      reportOverride ?? evaluateAuditorReport(evalInput, config),
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

test("GET /auditor/:entityId requires entityType", async () => {
  const app = createAuthedApp(createTestRouter(null));
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/auditor/review-1`);
    assert.equal(res.status, 400);
  });
});

test("GET /auditor/:entityId returns 404 when entity missing", async () => {
  const app = createAuthedApp(createTestRouter(null));
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/auditor/review-1?entityType=financial_document_review`);
    assert.equal(res.status, 404);
  });
});

test("GET /auditor/:entityId returns primary auditor comparison recommendation", async () => {
  const app = createAuthedApp(createTestRouter(sampleInput()));
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/auditor/review-1?entityType=financial_document_review`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.entityId, "review-1");
    assert.equal(body.organizationId, ORG);
    assert.ok(body.primary);
    assert.ok(body.auditor);
    assert.ok(body.comparison);
    assert.ok(body.differences);
    assert.ok(body.explanation);
    assert.ok(body.recommendation);
    assert.equal((body.auditor as { decision: string }).decision, "PASS");
  });
});

test("GET /auditor/:entityId reflects FAIL on amount mismatch", async () => {
  const mismatchInput = sampleInput();
  mismatchInput.independent.amount = 500;
  const report = evaluateAuditorReport(mismatchInput, DEFAULT_AUDITOR_CONFIG);
  const app = createAuthedApp(createTestRouter(mismatchInput, report));
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/auditor/review-1?entityType=financial_document_review`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { auditor: { decision: string }; comparison: { amountMismatch: boolean } };
    assert.equal(body.auditor.decision, "FAIL");
    assert.equal(body.comparison.amountMismatch, true);
  });
});
