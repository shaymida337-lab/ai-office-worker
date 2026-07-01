import express from "express";
import test from "node:test";
import assert from "node:assert/strict";

import { authMiddleware, type JwtPayload } from "../lib/auth.js";
import { createScannerHealthRouter } from "./scannerHealthRoutes.js";
import type {
  ScannerHealthApiResponse,
  ScannerHealthFailuresApiResponse,
  ScannerHealthServiceDb,
} from "../services/scanner/scannerHealthService.js";
import { emptyDecisionBucketCounts } from "../services/scanner/scannerHealthQueries.js";

const ORG_A = "org-scanner-a";
const ORG_B = "org-scanner-b";
const AUTH_A: JwtPayload = { organizationId: ORG_A, userId: "user-a", email: "a@example.com" };
const AUTH_B: JwtPayload = { organizationId: ORG_B, userId: "user-b", email: "b@example.com" };

const NOW = new Date("2026-07-01T12:00:00.000Z");
const RANGE = {
  from: new Date("2026-07-01T00:00:00.000Z"),
  to: new Date("2026-07-01T23:59:59.999Z"),
};

function emptyHealthResponse(organizationId: string): ScannerHealthApiResponse {
  return {
    organizationId,
    generatedAt: NOW.toISOString(),
    range: {
      from: RANGE.from.toISOString(),
      to: RANGE.to.toISOString(),
    },
    health: {
      organizationId,
      range: {
        from: RANGE.from.toISOString(),
        to: RANGE.to.toISOString(),
      },
      ingestion: {
        emailsIngested: 0,
        emailsProcessed: 0,
        ingestionSuccessRate: null,
      },
      artifacts: {
        gmailScanItemCount: 0,
        financialDocumentReviewCount: 0,
      },
      extraction: {
        financialCandidateCount: 0,
        amountExtractedCount: 0,
        amountExtractionRate: null,
        supplierDetectedCount: 0,
        supplierDetectionRate: null,
        missingAmountCount: 0,
        missingAmountRate: null,
      },
      decisions: emptyDecisionBucketCounts(),
      scans: {
        stuckScanCount: 0,
        scanErrorCount: 0,
      },
    },
    violations: {
      total: 0,
      bySeverity: { critical: 0, warning: 0, info: 0 },
      byType: {
        stuck_active_scan: 0,
        duplicate_supplier_payment_fingerprint: 0,
        blocked_outcome_persisted: 0,
        auto_saved_without_attachment: 0,
        drive_link_invoice_confusion: 0,
        fdr_without_gsi: 0,
        cross_org_gmail_message_id: 0,
        gmail_mailbox_mismatch: 0,
      },
    },
  };
}

function createMockDeps() {
  const calls: Array<{ kind: "health" | "failures"; organizationId: string; limit?: number }> = [];
  const db = {} as ScannerHealthServiceDb;

  return {
    calls,
    router: createScannerHealthRouter({
      db,
      getHealth: async (_db, input) => {
        calls.push({ kind: "health", organizationId: input.organizationId });
        if (input.organizationId === ORG_A) {
          return {
            ...emptyHealthResponse(ORG_A),
            violations: {
              total: 1,
              bySeverity: { critical: 1, warning: 0, info: 0 },
              byType: {
                stuck_active_scan: 1,
                duplicate_supplier_payment_fingerprint: 0,
                blocked_outcome_persisted: 0,
                auto_saved_without_attachment: 0,
                drive_link_invoice_confusion: 0,
                fdr_without_gsi: 0,
                cross_org_gmail_message_id: 0,
                gmail_mailbox_mismatch: 0,
              },
            },
          };
        }
        return emptyHealthResponse(input.organizationId);
      },
      getFailures: async (_db, input) => {
        calls.push({ kind: "failures", organizationId: input.organizationId, limit: input.limit });
        const payload: ScannerHealthFailuresApiResponse = {
          organizationId: input.organizationId,
          generatedAt: NOW.toISOString(),
          range: {
            from: input.range.from.toISOString(),
            to: input.range.to.toISOString(),
          },
          limit: input.limit,
          totals: { violations: 2, failedExamples: 1 },
          violations: [
            {
              severity: "critical",
              violationType: "blocked_outcome_persisted",
              organizationId: input.organizationId,
              affectedIds: ["fdr-1", "pay-1"],
              explanation: "blocked persisted",
              recommendedAction: "inspect",
            },
            {
              severity: "warning",
              violationType: "fdr_without_gsi",
              organizationId: input.organizationId,
              affectedIds: ["fdr-2"],
              explanation: "missing gsi",
              recommendedAction: "mirror",
            },
          ].slice(0, input.limit),
          failedExamples: [
            {
              id: "gsi-1",
              kind: "gmail_scan_item",
              gmailMessageId: "gmail-1",
              subject: "Invoice",
              reviewStatus: "needs_review",
              decisionBucket: "needs_review",
              failureReason: "Held for review",
              occurredAt: NOW.toISOString(),
            },
          ],
        };
        return payload;
      },
    }),
  };
}

function createAuthedApp(router: express.Router, auth?: JwtPayload) {
  const app = express();
  app.use(express.json());
  if (auth) {
    app.use((req, _res, next) => {
      req.auth = auth;
      next();
    });
  } else {
    app.use(authMiddleware);
  }
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

async function api(baseUrl: string, path: string, init?: RequestInit) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  return { status: res.status, body };
}

test("GET /scanner/health returns 401 without auth", async () => {
  const { router } = createMockDeps();
  const app = createAuthedApp(router);
  await withServer(app, async (baseUrl) => {
    const res = await api(baseUrl, "/scanner/health");
    assert.equal(res.status, 401);
  });
});

test("GET /scanner/health scopes requests to req.auth.organizationId", async () => {
  const { router, calls } = createMockDeps();
  const app = createAuthedApp(router, AUTH_A);
  await withServer(app, async (baseUrl) => {
    const res = await api(baseUrl, "/scanner/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.organizationId, ORG_A);
    assert.equal(calls[0]?.organizationId, ORG_A);
  });
});

test("GET /scanner/health returns expected summary shape for empty org", async () => {
  const { router } = createMockDeps();
  const app = createAuthedApp(router, AUTH_B);
  await withServer(app, async (baseUrl) => {
    const res = await api(baseUrl, "/scanner/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.organizationId, ORG_B);
    assert.ok(res.body.generatedAt);
    assert.ok(res.body.range?.from);
    assert.ok(res.body.health?.ingestion);
    assert.ok(res.body.health?.artifacts);
    assert.ok(res.body.health?.extraction);
    assert.ok(res.body.health?.decisions);
    assert.ok(res.body.health?.scans);
    assert.equal(res.body.violations.total, 0);
  });
});

test("GET /scanner/health includes violations summary", async () => {
  const { router } = createMockDeps();
  const app = createAuthedApp(router, AUTH_A);
  await withServer(app, async (baseUrl) => {
    const res = await api(baseUrl, "/scanner/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.violations.total, 1);
    assert.equal(res.body.violations.bySeverity.critical, 1);
    assert.equal(res.body.violations.byType.stuck_active_scan, 1);
  });
});

test("GET /scanner/health/failures respects limit query param", async () => {
  const { router, calls } = createMockDeps();
  const app = createAuthedApp(router, AUTH_A);
  await withServer(app, async (baseUrl) => {
    const res = await api(baseUrl, "/scanner/health/failures?limit=1");
    assert.equal(res.status, 200);
    assert.equal(res.body.limit, 1);
    assert.equal(res.body.violations.length, 1);
    assert.equal(res.body.failedExamples.length, 1);
    assert.equal(calls.at(-1)?.limit, 1);
  });
});

test("GET /scanner/health/failures returns violations and failed examples", async () => {
  const { router } = createMockDeps();
  const app = createAuthedApp(router, AUTH_A);
  await withServer(app, async (baseUrl) => {
    const res = await api(baseUrl, "/scanner/health/failures?limit=5");
    assert.equal(res.status, 200);
    assert.equal(res.body.organizationId, ORG_A);
    assert.equal(res.body.totals.violations, 2);
    assert.equal(res.body.totals.failedExamples, 1);
    assert.equal(res.body.failedExamples[0]?.kind, "gmail_scan_item");
    assert.equal(res.body.violations[0]?.violationType, "blocked_outcome_persisted");
  });
});
