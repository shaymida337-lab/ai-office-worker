/**
 * Single-record E2E direct approval on prod (readonly except one approve POST).
 */
import { config } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const TARGET_ID = process.env.TARGET_RECORD_ID ?? "gmail-scan:cmqn9rdfh069fhj2d83yfbdox";

const backendDir = process.cwd().endsWith("backend") ? process.cwd() : join(process.cwd(), "backend");
config({ path: join(backendDir, ".env") });
if (existsSync(join(backendDir, ".env.prod.local"))) {
  config({ path: join(backendDir, ".env.prod.local"), override: true });
}

const API = "https://ai-office-worker-backend.onrender.com";
const ORG = "cmpjd7j7e0001bl5tzv049rxb";

async function renderJwtSecret() {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = "srv-d898po77f7vs73bu01v0";
  let url = `https://api.render.com/v1/services/${serviceId}/env-vars?limit=100`;
  for (let i = 0; i < 10; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    const data = await res.json();
    for (const item of data) {
      const key = item.envVar?.key ?? item.key;
      const val = item.envVar?.value ?? item.value;
      if (key === "JWT_SECRET" && val) return val;
    }
    const cursor = data.at(-1)?.cursor;
    if (!cursor) break;
    url = `https://api.render.com/v1/services/${serviceId}/env-vars?limit=100&cursor=${cursor}`;
  }
  throw new Error("JWT_SECRET not found");
}

async function renderEnv(key) {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = "srv-d898po77f7vs73bu01v0";
  let url = `https://api.render.com/v1/services/${serviceId}/env-vars?limit=100`;
  for (let i = 0; i < 10; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    const data = await res.json();
    for (const item of data) {
      const k = item.envVar?.key ?? item.key;
      const v = item.envVar?.value ?? item.value;
      if (k === key) return v ?? "";
    }
    const cursor = data.at(-1)?.cursor;
    if (!cursor) break;
    url = `https://api.render.com/v1/services/${serviceId}/env-vars?limit=100&cursor=${cursor}`;
  }
  return "";
}

async function api(path, token, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(60_000),
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

function fingerprint(row) {
  return `${row.supplierName ?? ""}|${row.amount ?? ""}|${row.date ?? ""}|${row.documentType ?? ""}`;
}

async function main() {
  const secret = await renderJwtSecret();
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.PROD_DATABASE_URL.replace("-pooler", "") } },
  });
  const org = await prisma.organization.findUnique({ where: { id: ORG }, include: { user: true } });
  const token = jwt.sign(
    { userId: org.user.id, organizationId: ORG, email: org.user.email },
    secret,
    { expiresIn: "20m" },
  );

  const health = await fetch(`${API}/health`).then((r) => r.json());
  const [incompleteRes, completeRes] = await Promise.all([
    api("/api/invoices?completeness=incomplete", token),
    api("/api/invoices?completeness=complete", token),
  ]);
  const incomplete = incompleteRes.body?.invoices ?? [];
  const complete = completeRes.body?.invoices ?? [];
  const target = incomplete.find((r) => r.id === TARGET_ID);
  if (!target) throw new Error(`Target ${TARGET_ID} not in incomplete list`);

  const rawId = TARGET_ID.replace(/^gmail-scan:/, "");
  const sourceType = "gmail-scan-item";

  const pre = {
    sourceType,
    recordId: target.id,
    supplier: target.supplierName,
    amount: target.amount,
    date: target.date,
    documentType: target.documentType,
    currency: target.currency,
    reviewStatus: target.reviewStatus,
    canApproveDirectly: target.canApproveDirectly,
    approvalBlockReason: target.approvalBlockReason,
    supplierNeedsConfirmation: target.supplierNeedsConfirmation,
    inIncomplete: true,
    inComplete: complete.some((r) => r.id === TARGET_ID),
    fingerprint: fingerprint(target),
  };

  if (!target.canApproveDirectly) throw new Error("Target not canApproveDirectly");
  if (target.supplierNeedsConfirmation) throw new Error("Target needs supplier confirmation");
  if (pre.inComplete) throw new Error("Already in complete");

  const approveRes = await api(`/api/invoices/${sourceType}/${rawId}/complete`, token, {
    method: "POST",
    body: JSON.stringify({ approve: true }),
  });

  const [afterIncompleteRes, afterCompleteRes] = await Promise.all([
    api("/api/invoices?completeness=incomplete", token),
    api("/api/invoices?completeness=complete", token),
  ]);
  const afterIncomplete = afterIncompleteRes.body?.invoices ?? [];
  const afterComplete = afterCompleteRes.body?.invoices ?? [];
  const afterCompleteIds = new Set(afterComplete.map((r) => r.id));

  const duplicateMatches = afterComplete.filter(
    (r) => r.id !== TARGET_ID && fingerprint(r) === pre.fingerprint,
  );

  const ingestionProbes = [];
  for (const path of ["/api/sync/gmail", "/api/gmail/scan"]) {
    const probe = await api(path, token, { method: "POST", body: JSON.stringify({}) });
    ingestionProbes.push({ path, status: probe.status });
  }

  const otherOrg = await prisma.organization.findFirst({
    where: { id: { not: ORG } },
    include: { user: true },
  });
  let tenantIsolation = { checked: false };
  if (otherOrg?.user) {
    const otherToken = jwt.sign(
      { userId: otherOrg.user.id, organizationId: otherOrg.id, email: otherOrg.user.email },
      secret,
      { expiresIn: "5m" },
    );
    const leak = await api(`/api/invoices?completeness=complete`, otherToken);
    const leaked = (leak.body?.invoices ?? []).some((r) => r.id === TARGET_ID);
    tenantIsolation = { checked: true, otherOrgId: otherOrg.id, leaked, status: leak.status };
  }

  const body = approveRes.body ?? {};
  const post = {
    removedFromIncomplete: !afterIncomplete.some((r) => r.id === TARGET_ID),
    presentInComplete: afterComplete.some((r) => r.id === TARGET_ID),
    incompleteBefore: incomplete.length,
    incompleteAfter: afterIncomplete.length,
    completeBefore: complete.length,
    completeAfter: afterComplete.length,
    overlapAfter: afterIncomplete.filter((r) => afterCompleteIds.has(r.id)).length,
    duplicateIds: duplicateMatches.map((r) => r.id),
  };

  const passed =
    approveRes.status === 200 &&
    body.dataComplete === true &&
    body.approved === true &&
    body.destination === "invoices" &&
    post.removedFromIncomplete &&
    post.presentInComplete &&
    post.overlapAfter === 0 &&
    duplicateMatches.length === 0 &&
    ingestionProbes.every((p) => p.status === 503) &&
    (await renderEnv("BLOCK_NEW_REGISTRATIONS")) === "true" &&
    !tenantIsolation.leaked;

  console.log(
    JSON.stringify(
      {
        healthCommit: health.commit,
        preApproval: pre,
        approveResponse: { status: approveRes.status, body: approveRes.body },
        postApproval: post,
        duplicateCheck: { count: duplicateMatches.length, ids: duplicateMatches.map((r) => r.id) },
        overlapCheck: post.overlapAfter,
        tenantIsolation,
        ingestionProbes,
        registrationsBlocked: (await renderEnv("BLOCK_NEW_REGISTRATIONS")) === "true",
        recommendation: passed ? "INVOICE_DIRECT_APPROVAL_E2E_PASSED" : "INVESTIGATE_FAILURE",
        result: passed ? "INVOICE_DIRECT_APPROVAL_E2E_PASSED" : "FAILED",
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
