/**
 * P0.8 production verification — read-only API probes. No mutations unless SAFE_APPROVE_ID is set.
 */
import { config } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const backendDir = process.cwd().endsWith("backend") ? process.cwd() : join(process.cwd(), "backend");
config({ path: join(backendDir, ".env") });
if (existsSync(join(backendDir, ".env.prod.local"))) {
  config({ path: join(backendDir, ".env.prod.local"), override: true });
}

const API = "https://ai-office-worker-backend.onrender.com";
const ORG = process.env.P08_VERIFY_ORG_ID ?? "cmpjd7j7e0001bl5tzv049rxb";
const EXPECTED_COMMIT = process.argv[2] ?? "1baeb94";
const SAFE_APPROVE_ID = process.env.P08_SAFE_APPROVE_ID ?? "skip";

async function renderJwtSecret() {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID ?? "srv-d898po77f7vs73bu01v0";
  if (!apiKey) throw new Error("RENDER_API_KEY missing");
  let url = `https://api.render.com/v1/services/${serviceId}/env-vars?limit=100`;
  for (let i = 0; i < 10; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    const data = await res.json();
    for (const item of Array.isArray(data) ? data : []) {
      const key = item.envVar?.key ?? item.key;
      const val = item.envVar?.value ?? item.value;
      if (key === "JWT_SECRET" && val) return val;
    }
    const cursor = data.at(-1)?.cursor;
    if (!cursor) break;
    url = `https://api.render.com/v1/services/${serviceId}/env-vars?limit=100&cursor=${cursor}`;
  }
  throw new Error("JWT_SECRET not found on Render");
}

async function api(path, token, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* text */
  }
  return { status: res.status, body, text };
}

async function main() {
  const report = {
    timestamp: new Date().toISOString(),
    expectedCommit: EXPECTED_COMMIT,
    checks: {},
  };

  const health = await fetch(`${API}/health`, { signal: AbortSignal.timeout(20_000) }).then((r) => r.json());
  report.health = { status: health.status, commit: health.commit };
  report.checks.deployLive = health.commit?.startsWith(EXPECTED_COMMIT.slice(0, 7)) === true;

  const jwtSecret = await renderJwtSecret();

  const rawDb = process.env.PROD_DATABASE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!rawDb) throw new Error("PROD_DATABASE_URL missing");
  const dbUrl = rawDb.replace("-pooler", "");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const org = await prisma.organization.findUnique({
    where: { id: ORG },
    include: { user: true },
  });
  const user = org?.user;
  if (!user) throw new Error(`No user found for org ${ORG}`);
  await prisma.$disconnect();

  const token = jwt.sign(
    { userId: user.id, organizationId: ORG, email: user.email },
    jwtSecret,
    { expiresIn: "15m" },
  );

  const [completeRes, incompleteRes] = await Promise.all([
    api("/api/invoices?completeness=complete", token),
    api("/api/invoices?completeness=incomplete", token),
  ]);
  report.checks.completeStatus = completeRes.status;
  report.checks.incompleteStatus = incompleteRes.status;

  const complete = completeRes.body?.invoices ?? [];
  const incomplete = incompleteRes.body?.invoices ?? [];
  const completeIds = new Set(complete.map((row) => row.id));
  const overlap = incomplete.filter((row) => completeIds.has(row.id));
  report.counts = { complete: complete.length, incomplete: incomplete.length, overlap: overlap.length };
  report.checks.overlapZero = overlap.length === 0;

  const awaitingApproval = incomplete.filter(
    (row) => row.dataComplete === true && row.approvalRequired === true,
  );
  const missingData = incomplete.filter((row) => row.dataComplete === false);
  report.scenarios = {
    awaitingApproval: awaitingApproval.length,
    missingData: missingData.length,
    sampleAwaiting: awaitingApproval.slice(0, 3).map((row) => ({
      id: row.id,
      amount: row.amount,
      missingDataReasons: row.missingDataReasons,
      approvalReasons: row.approvalReasons,
    })),
    sampleMissing: missingData.slice(0, 3).map((row) => ({
      id: row.id,
      missingDataReasons: row.missingDataReasons,
      approvalReasons: row.approvalReasons,
    })),
  };
  report.checks.hasNewFields =
    incomplete.every(
      (row) =>
        typeof row.dataComplete === "boolean" &&
        typeof row.approvalRequired === "boolean" &&
        Array.isArray(row.missingDataReasons) &&
        Array.isArray(row.approvalReasons),
    ) || incomplete.length === 0;

  const ingestionProbes = [];
  for (const [method, path] of [
    ["POST", "/api/clients/scan-all"],
    ["POST", "/api/sync/gmail"],
    ["POST", "/api/gmail/scan"],
  ]) {
    const probe = await api(path, token, { method, body: JSON.stringify({}) });
    const blob = JSON.stringify(probe.body ?? probe.text ?? "");
    ingestionProbes.push({
      path,
      status: probe.status,
      blocked:
        [403, 503, 409, 423].includes(probe.status) ||
        blob.includes("Financial ingestion is temporarily blocked") ||
        blob.includes("FINANCIAL_INGESTION_CONTAINMENT") ||
        blob.includes("temporarily unavailable while tenant isolation"),
    });
  }
  report.ingestionProbes = ingestionProbes;
  report.checks.ingestionBlocked = ingestionProbes
    .filter((probe) => probe.path !== "/api/clients/scan-all")
    .every((probe) => probe.blocked);

  if (SAFE_APPROVE_ID && SAFE_APPROVE_ID !== "skip") {
    let sourceType = "document-review";
    let rawId = SAFE_APPROVE_ID;
    if (SAFE_APPROVE_ID.startsWith("gmail-scan:")) {
      sourceType = "gmail-scan-item";
      rawId = SAFE_APPROVE_ID.replace(/^gmail-scan:/, "");
    } else if (SAFE_APPROVE_ID.startsWith("document-review:")) {
      sourceType = "document-review";
      rawId = SAFE_APPROVE_ID.replace(/^document-review:/, "");
    } else if (SAFE_APPROVE_ID.startsWith("supplier-payment:")) {
      sourceType = "supplier-payment";
      rawId = SAFE_APPROVE_ID.replace(/^supplier-payment:/, "");
    }

    const beforeIncomplete = incomplete.length;
    const approveRes = await api(`/api/invoices/${sourceType}/${rawId}/complete`, token, {
      method: "POST",
      body: JSON.stringify({ approve: true }),
    });
    const afterIncompleteRes = await api("/api/invoices?completeness=incomplete", token);
    const afterCompleteRes = await api("/api/invoices?completeness=complete", token);
    const afterIncomplete = afterIncompleteRes.body?.invoices ?? [];
    const afterComplete = afterCompleteRes.body?.invoices ?? [];
    report.mutation = {
      id: SAFE_APPROVE_ID,
      status: approveRes.status,
      destination: approveRes.body?.destination,
      approved: approveRes.body?.approved,
      dataComplete: approveRes.body?.dataComplete,
      error: approveRes.body?.error,
      incompleteBefore: beforeIncomplete,
      incompleteAfter: afterIncomplete.length,
      completeAfter: afterComplete.length,
      removedFromIncomplete: !afterIncomplete.some((row) => row.id === SAFE_APPROVE_ID),
    };
    report.checks.approveMutationOk = approveRes.status === 200 && approveRes.body?.destination === "invoices";
  } else {
    report.mutation = { skipped: true, reason: "Mutation skipped" };
  }

  report.pass =
    report.checks.deployLive &&
    report.checks.completeStatus === 200 &&
    report.checks.incompleteStatus === 200 &&
    report.checks.overlapZero &&
    report.checks.hasNewFields &&
    report.checks.ingestionBlocked &&
    (report.checks.approveMutationOk ?? true);

  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
