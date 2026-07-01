import express from "express";
import test from "node:test";
import assert from "node:assert/strict";

import type { JwtPayload } from "../lib/auth.js";
import { createIntegrityWatchRouter } from "./dataIntegrityWatchRoutes.js";
import type { IntegrityReadOnlyDb } from "../services/dataIntegrityWatch/integrityDb.js";
import { buildIntegrityWatchReport } from "../services/dataIntegrityWatch/integrityReport.js";
import { buildIntegrityOrgReport } from "../services/dataIntegrityWatch/integrityScore.js";
import { INTEGRITY_WATCH_VERSION } from "../services/dataIntegrityWatch/integrityTypes.js";

const ORG_A = "org-integrity-a";
const ORG_B = "org-integrity-b";
const AUTH_A: JwtPayload = { organizationId: ORG_A, userId: "user-a", email: "a@example.com" };
const AUTH_B: JwtPayload = { organizationId: ORG_B, userId: "user-b", email: "b@example.com" };

function sampleReport(organizationId: string) {
  const orgReport = buildIntegrityOrgReport(organizationId, []);
  return buildIntegrityWatchReport({
    mode: "manual",
    dryRun: false,
    organizationReports: [orgReport],
    generatedAt: "2026-06-01T12:00:00.000Z",
  });
}

function createMockDeps() {
  const calls: string[] = [];
  const db = {} as IntegrityReadOnlyDb;

  return {
    calls,
    router: createIntegrityWatchRouter({
      db,
      runForOrg: async (_db, organizationId) => {
        calls.push(organizationId);
        return sampleReport(organizationId);
      },
    }),
  };
}

function createAuthedApp(router: express.Router, auth: JwtPayload) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = auth;
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

async function api(baseUrl: string, path: string) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { "Content-Type": "application/json" } });
  const body = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  return { status: res.status, body };
}

test("GET /integrity/watch scopes requests to req.auth.organizationId", async () => {
  const { router, calls } = createMockDeps();
  const app = createAuthedApp(router, AUTH_A);
  await withServer(app, async (baseUrl) => {
    const res = await api(baseUrl, "/integrity/watch");
    assert.equal(res.status, 200);
    assert.equal(calls[0], ORG_A);
    assert.equal(res.body.report.organizationReports[0]?.organizationId, ORG_A);
  });
});

test("GET /integrity/watch returns expected response shape", async () => {
  const { router } = createMockDeps();
  const app = createAuthedApp(router, AUTH_B);
  await withServer(app, async (baseUrl) => {
    const res = await api(baseUrl, "/integrity/watch");
    assert.equal(res.status, 200);
    assert.equal(res.body.report.schemaVersion, INTEGRITY_WATCH_VERSION);
    assert.equal(res.body.report.checksImplemented, 8);
    assert.ok(res.body.health);
    assert.equal(typeof res.body.health.integrityScore, "number");
    assert.equal(typeof res.body.health.criticalFindings, "number");
    assert.ok(res.body.report.noiseAnalytics);
    assert.ok(res.body.report.signalQualityComparison);
    assert.equal(typeof res.body.health.importantFindings, "number");
    assert.ok(res.body.summary);
  });
});

test("GET /integrity/watch isolates organizations", async () => {
  const { router, calls } = createMockDeps();
  const appA = createAuthedApp(router, AUTH_A);
  const appB = createAuthedApp(router, AUTH_B);
  await withServer(appA, async (baseUrlA) => {
    await api(baseUrlA, "/integrity/watch");
    await withServer(appB, async (baseUrlB) => {
      await api(baseUrlB, "/integrity/watch");
      assert.deepEqual(calls, [ORG_A, ORG_B]);
    });
  });
});
