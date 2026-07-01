import express from "express";
import test from "node:test";
import assert from "node:assert/strict";

import type { JwtPayload } from "../lib/auth.js";
import { createReleaseCertificateRouter } from "./releaseCertificateRoutes.js";
import { allowAllPermissionsMiddleware } from "../services/rbac/rbacMiddleware.js";
import { evaluateReleaseCertificate, buildGateResult } from "../services/releaseCertificate/index.js";
import { RELEASE_GATE_NAMES } from "../services/releaseCertificate/certificateTypes.js";
import type { ReleaseCertificate } from "../services/releaseCertificate/certificateTypes.js";

const ORG = "org-release";
const AUTH: JwtPayload = { organizationId: ORG, userId: "user-1", email: "u@example.com" };

function greenCertificate(): ReleaseCertificate {
  const gates = RELEASE_GATE_NAMES.map((name) =>
    buildGateResult({ name, status: "pass", critical: name !== "reliability_foundation" }),
  );
  return evaluateReleaseCertificate(
    gates,
    { organizationId: ORG, buildResult: "pass", testResults: { passed: 10, failed: 0, total: 10 } },
    "rc-test-green",
  );
}

function createTestRouter(certificate: ReleaseCertificate, history: ReleaseCertificate[] = []) {
  return createReleaseCertificateRouter({
    requirePermission: () => allowAllPermissionsMiddleware(),
    generate: async () => certificate,
    getLatest: async () => history[0] ?? null,
    getById: async (_orgId, id) => (id === certificate.certificateId ? certificate : null),
    listHistory: async () => ({
      items: history.map((item) => ({
        certificateId: item.certificateId,
        timestamp: item.timestamp,
        commitHash: item.commitHash,
        deployId: item.deployId,
        environment: item.environment,
        overallStatus: item.overallStatus,
        overallScore: item.overallScore,
        failedGates: item.failedGates,
        warningGates: item.warningGates,
        releaseRecommendation: item.releaseRecommendation,
      })),
      nextCursor: null,
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

test("GET /release-certificate/latest returns certificate", async () => {
  const cert = greenCertificate();
  const app = createAuthedApp(createTestRouter(cert));
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/release-certificate/latest`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { certificate: ReleaseCertificate };
    assert.equal(body.certificate.overallStatus, "GREEN");
    assert.ok(body.certificate.gateResults.length > 0);
  });
});

test("GET /release-certificate/history returns items", async () => {
  const cert = greenCertificate();
  const app = createAuthedApp(createTestRouter(cert, [cert]));
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/release-certificate/history`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { items: unknown[] };
    assert.equal(body.items.length, 1);
  });
});

test("GET /release-certificate/:certificateId returns 404 when missing", async () => {
  const cert = greenCertificate();
  const app = createAuthedApp(createTestRouter(cert));
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/release-certificate/missing-id`);
    assert.equal(res.status, 404);
  });
});

test("GET /release-certificate/:certificateId returns certificate", async () => {
  const cert = greenCertificate();
  const app = createAuthedApp(createTestRouter(cert));
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/release-certificate/${cert.certificateId}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { certificate: ReleaseCertificate };
    assert.equal(body.certificate.certificateId, cert.certificateId);
  });
});
