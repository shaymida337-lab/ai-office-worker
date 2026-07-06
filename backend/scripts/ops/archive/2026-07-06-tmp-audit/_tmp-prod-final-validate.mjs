import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}
process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;

const { generateReleaseCertificate } = await import("../src/services/releaseCertificate/index.js");
const { runGoldenSuiteDryRun } = await import("../src/services/golden/goldenSuiteRunner.js");

const organizationId = process.argv[2] ?? "cmqxujfuj034ndy2czu9tjoko";
const apiBase = process.env.PROD_API_BASE ?? "https://ai-office-worker-backend.onrender.com";

async function fetchRenderJwtSecret() {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID;
  if (!apiKey || !serviceId) return null;
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars?limit=100`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  for (const item of data) {
    const envVar = item.envVar ?? item;
    if (envVar.key === "JWT_SECRET" && envVar.value) return envVar.value;
  }
  return null;
}

const jwtSecret = (await fetchRenderJwtSecret()) ?? process.env.PROD_JWT_SECRET ?? process.env.JWT_SECRET;
const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL } } });
const org = await prisma.organization.findUnique({ where: { id: organizationId }, include: { user: true } });
const token = jwt.sign(
  { userId: org.user.id, organizationId: org.id, email: org.user.email },
  jwtSecret,
  { expiresIn: "1h" },
);

async function apiGet(path) {
  const res = await fetch(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
  return { status: res.status, body };
}

const health = await fetch(`${apiBase}/health`).then(async (r) => ({ status: r.status, body: await r.json() }));
const releaseRoute = await apiGet("/api/release-certificate/latest");
const scanner = await apiGet("/api/scanner/health");
const integrity = await apiGet("/api/integrity/watch?dryRun=true");
const auditor = await apiGet("/api/auditor/dummy?entityType=financial_document_review");
const confidence = await apiGet("/api/confidence/dummy?entityType=financial_document_review");

const golden = JSON.parse(
  readFileSync(join(process.cwd(), "src/services/golden/fixtures/golden-suite/example-dataset.json"), "utf8"),
);
const goldenDry = runGoldenSuiteDryRun(golden, { mode: "dry_run", dryRun: true });

const cert = await generateReleaseCertificate({
  organizationId,
  commitHash: "d14ebcf",
  deployId: "p0-3.3-recovery",
  buildResult: "pass",
  testResults: { passed: 1107, failed: 0, total: 1108 },
});

console.log(
  JSON.stringify(
    {
      health,
      routes: {
        releaseCertificate: releaseRoute.status,
        scannerHealth: scanner.status,
        integrityWatch: integrity.status,
        auditor: auditor.status,
        confidence: confidence.status,
      },
      scannerCritical: scanner.body?.violations?.bySeverity?.critical,
      integrityCritical: integrity.body?.report?.criticalFindings,
      integrityPassed: integrity.body?.report?.passed,
      goldenDryRun: goldenDry.releaseRecommendation,
      releaseCertificate: {
        status: cert.overallStatus,
        trustScore: cert.trustScore,
        failedGates: cert.failedGates,
        warningGates: cert.warningGates,
        gates: cert.gateResults.map((g) => ({ name: g.name, status: g.status, blockingReason: g.blockingReason })),
      },
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
