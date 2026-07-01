import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const organizationId = process.argv[2] ?? "cmqxujfuj034ndy2czu9tjoko";

async function fetchRenderJwtSecret() {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID;
  if (!apiKey || !serviceId) return null;

  let cursor = null;
  do {
    const url = new URL(`https://api.render.com/v1/services/${serviceId}/env-vars`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!res.ok) {
      console.error("Render env-vars fetch failed:", res.status);
      return null;
    }
    const data = await res.json();
    const items = Array.isArray(data) ? data : [];
    for (const item of items) {
      const envVar = item.envVar ?? item;
      if (envVar.key === "JWT_SECRET" && envVar.value) return envVar.value;
    }
    cursor = items.at(-1)?.cursor ?? null;
  } while (cursor);

  return null;
}

async function fetchLatestDeploy() {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID;
  if (!apiKey || !serviceId) return null;

  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=3`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const deploys = Array.isArray(data) ? data.map((d) => d.deploy ?? d) : [];
  return deploys[0] ?? null;
}

async function main() {
  const jwtSecret = (await fetchRenderJwtSecret()) ?? process.env.PROD_JWT_SECRET ?? process.env.JWT_SECRET;
  const databaseUrl = process.env.PROD_DATABASE_URL;
  const apiBase = process.env.PROD_API_BASE ?? "https://ai-office-worker-backend.onrender.com";

  if (!jwtSecret || !databaseUrl) {
    console.error("Missing JWT_SECRET or PROD_DATABASE_URL");
    process.exit(1);
  }

  const deploy = await fetchLatestDeploy();
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { user: true },
  });
  if (!org?.user) throw new Error(`Org not found: ${organizationId}`);

  const token = jwt.sign(
    { userId: org.user.id, organizationId: org.id, email: org.user.email },
    jwtSecret,
    { expiresIn: "1h" },
  );

  async function apiGet(path) {
    const res = await fetch(`${apiBase}${path}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    return { status: res.status, body };
  }

  const paths = ["/api/integrity/watch", "/api/scanner/health", "/api/scanner/health/failures?limit=20"];
  const endpoints = {};
  for (const path of paths) {
    endpoints[path] = await apiGet(path);
  }

  const integrity = endpoints["/api/integrity/watch"];
  const findings = integrity.body?.report?.organizationReports?.[0]?.findings ?? [];
  const failed = findings.filter((f) => f.status === "fail");
  const byCheck = new Map();
  for (const f of failed) {
    byCheck.set(f.checkId, (byCheck.get(f.checkId) ?? 0) + 1);
  }

  console.log(
    JSON.stringify(
      {
        deploy: deploy
          ? {
              id: deploy.id,
              status: deploy.status,
              commitId: deploy.commit?.id ?? deploy.commitId ?? null,
              createdAt: deploy.createdAt,
              finishedAt: deploy.finishedAt ?? null,
            }
          : null,
        organizationId,
        endpoints: Object.fromEntries(
          Object.entries(endpoints).map(([p, r]) => [p, { status: r.status, ok: r.status === 200 }]),
        ),
        report: integrity.body?.report
          ? {
              schemaVersion: integrity.body.report.schemaVersion,
              checksImplemented: integrity.body.report.checksImplemented,
              overallIntegrityScore: integrity.body.report.overallIntegrityScore,
              criticalFindings: integrity.body.report.criticalFindings,
              warningFindings: integrity.body.report.warningFindings,
              infoFindings: integrity.body.report.infoFindings,
              passed: integrity.body.report.passed,
            }
          : null,
        health: integrity.body?.health ?? null,
        trustStatus: integrity.body?.trustStatus ?? null,
        hasSummary: typeof integrity.body?.summary === "string",
        findings: {
          total: findings.length,
          failed: failed.length,
          critical: failed.filter((f) => f.severity === "critical").length,
          warning: failed.filter((f) => f.severity === "warning").length,
          info: failed.filter((f) => f.severity === "info").length,
          topFindingTypes: [...byCheck.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
          crossOrgCount: failed.filter((f) => f.checkId === "org-cross-org-reference").length,
          paymentWithoutSourceCount: failed.filter((f) => f.checkId === "fin-payment-without-source").length,
          paymentAfterBlockedCount: failed.filter((f) => f.checkId === "fin-payment-after-blocked").length,
          zeroAmountCount: failed.filter((f) => f.checkId === "fin-zero-amount-forbidden").length,
        },
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
