/**
 * Find safe canApproveDirectly=true records and optionally run single E2E approve.
 * Usage:
 *   node scripts/.p0-8-direct-approval-e2e.mjs           # find only
 *   node scripts/.p0-8-direct-approval-e2e.mjs --approve # find + approve one
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
const DO_APPROVE = process.argv.includes("--approve");

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
  throw new Error("JWT_SECRET not found");
}

async function renderEnv(key) {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID ?? "srv-d898po77f7vs73bu01v0";
  let url = `https://api.render.com/v1/services/${serviceId}/env-vars?limit=100`;
  for (let i = 0; i < 10; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    const data = await res.json();
    for (const item of Array.isArray(data) ? data : []) {
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
      ...(init.headers ?? {}),
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

function resolveSourceType(row) {
  if (row.id.startsWith("gmail-scan:") || row.source === "gmail_scan_item") return "gmail-scan-item";
  if (row.id.startsWith("document-review:") || row.source === "financial_document_review") return "document-review";
  if (row.id.startsWith("supplier-payment:") || row.source === "supplier_payment") return "supplier-payment";
  return null;
}

function resolveRawId(row) {
  return row.id
    .replace(/^gmail-scan:/, "")
    .replace(/^document-review:/, "")
    .replace(/^supplier-payment:/, "");
}

function isSafeCandidate(row) {
  if (row.canApproveDirectly !== true) return false;
  if (!row.dataComplete) return false;
  if (row.supplierNeedsConfirmation === true) return false;
  if (row.approvalBlockReason === "blocked_outcome" || row.approvalBlockReason?.includes("block")) return false;
  if ((row.missingDataReasons ?? []).length > 0) return false;
  if (!resolveSourceType(row)) return false;
  return true;
}

function fingerprint(row) {
  return `${row.supplierName ?? ""}|${row.amount ?? ""}|${row.date ?? ""}|${row.documentType ?? ""}`;
}

async function loadContaminatedGmailIds(prisma) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT "gmailMessageId" AS id
    FROM "CrossOrgGmailContaminationMarker"
    WHERE "organizationId" = $1 AND "gmailMessageId" IS NOT NULL
  `, ORG).catch(() => []);
  return new Set((rows ?? []).map((r) => r.id).filter(Boolean));
}

async function isContaminated(prisma, row, contaminatedIds) {
  if (row.gmailMessageId && contaminatedIds.has(row.gmailMessageId)) return true;
  const rawId = resolveRawId(row);
  const sourceType = resolveSourceType(row);
  if (sourceType === "document-review") {
    const review = await prisma.financialDocumentReview.findFirst({ where: { id: rawId, organizationId: ORG }, select: { gmailMessageId: true } });
    if (review?.gmailMessageId && contaminatedIds.has(review.gmailMessageId)) return true;
  }
  if (sourceType === "gmail-scan-item") {
    const gsi = await prisma.gmailScanItem.findFirst({ where: { id: rawId, organizationId: ORG }, select: { gmailMessageId: true } });
    if (gsi?.gmailMessageId && contaminatedIds.has(gsi.gmailMessageId)) return true;
  }
  return false;
}

async function main() {
  const secret = await renderJwtSecret();
  const dbUrl = (process.env.PROD_DATABASE_URL || "").replace("-pooler", "");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const org = await prisma.organization.findUnique({ where: { id: ORG }, include: { user: true } });
  if (!org?.user) throw new Error(`Org ${ORG} not found`);

  const token = jwt.sign(
    { userId: org.user.id, organizationId: ORG, email: org.user.email },
    secret,
    { expiresIn: "20m" },
  );

  const health = await fetch(`${API}/health`, { signal: AbortSignal.timeout(20_000) }).then((r) => r.json());
  const [incompleteRes, completeRes] = await Promise.all([
    api("/api/invoices?completeness=incomplete", token),
    api("/api/invoices?completeness=complete", token),
  ]);

  const incomplete = incompleteRes.body?.invoices ?? [];
  const complete = completeRes.body?.invoices ?? [];
  const completeIds = new Set(complete.map((r) => r.id));

  const directReady = incomplete.filter((r) => r.canApproveDirectly === true);
  const safeCandidates = [];
  const contaminatedIds = await loadContaminatedGmailIds(prisma);

  for (const row of incomplete) {
    if (!isSafeCandidate(row)) continue;
    if (await isContaminated(prisma, row, contaminatedIds)) continue;
    safeCandidates.push(row);
  }

  const blockReasonCounts = {};
  for (const row of incomplete) {
    const key = row.approvalBlockReason ?? (row.canApproveDirectly ? "can_approve" : "unknown");
    blockReasonCounts[key] = (blockReasonCounts[key] ?? 0) + 1;
  }

  const report = {
    timestamp: new Date().toISOString(),
    healthCommit: health.commit,
    org: ORG,
    counts: {
      incomplete: incomplete.length,
      complete: complete.length,
      overlap: incomplete.filter((r) => completeIds.has(r.id)).length,
      canApproveDirectlyTrue: directReady.length,
      safeCandidates: safeCandidates.length,
    },
    blockReasonCounts,
    safeCandidatesPreview: safeCandidates.slice(0, 5).map((r) => ({
      id: r.id,
      supplier: r.supplierName,
      amount: r.amount,
      canApproveDirectly: r.canApproveDirectly,
      approvalBlockReason: r.approvalBlockReason,
    })),
  };

  if (safeCandidates.length === 0) {
    report.result = "NO_SAFE_DIRECT_APPROVAL_CANDIDATE";
    report.recommendation = "STOP — count=0";
    console.log(JSON.stringify(report, null, 2));
    await prisma.$disconnect();
    process.exit(0);
  }

  // Prefer smallest amount test-like record among safe candidates
  const target = [...safeCandidates].sort((a, b) => (a.amount ?? 0) - (b.amount ?? 0))[0];
  const sourceType = resolveSourceType(target);
  const rawId = resolveRawId(target);

  const pre = {
    sourceType,
    recordId: target.id,
    rawId,
    supplier: target.supplierName,
    amount: target.amount,
    date: target.date,
    documentType: target.documentType,
    currency: target.currency,
    reviewStatus: target.reviewStatus,
    rawReviewStatus: target.rawReviewStatus,
    canApproveDirectly: target.canApproveDirectly,
    approvalBlockReason: target.approvalBlockReason,
    supplierNeedsConfirmation: target.supplierNeedsConfirmation,
    dataComplete: target.dataComplete,
    inIncomplete: true,
    inComplete: completeIds.has(target.id),
    fingerprint: fingerprint(target),
  };
  report.preApproval = pre;

  if (!DO_APPROVE) {
    report.result = "CANDIDATE_FOUND_APPROVE_NOT_REQUESTED";
    report.hint = "Re-run with --approve to execute single E2E approval";
    console.log(JSON.stringify(report, null, 2));
    await prisma.$disconnect();
    return;
  }

  if (pre.inComplete) {
    report.result = "ABORT_ALREADY_IN_COMPLETE";
    console.log(JSON.stringify(report, null, 2));
    await prisma.$disconnect();
    process.exit(1);
  }

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
    (r) => r.id !== target.id && fingerprint(r) === pre.fingerprint,
  );

  const ingestionProbes = [];
  for (const path of ["/api/sync/gmail", "/api/gmail/scan"]) {
    const probe = await api(path, token, { method: "POST", body: JSON.stringify({}) });
    ingestionProbes.push({ path, status: probe.status, blocked: probe.status === 503 });
  }

  const registrationsBlocked = (await renderEnv("BLOCK_NEW_REGISTRATIONS")) === "true";

  report.approveResponse = {
    status: approveRes.status,
    body: approveRes.body,
  };
  report.postApproval = {
    removedFromIncomplete: !afterIncomplete.some((r) => r.id === target.id),
    presentInComplete: afterComplete.some((r) => r.id === target.id),
    incompleteCountBefore: incomplete.length,
    incompleteCountAfter: afterIncomplete.length,
    completeCountBefore: complete.length,
    completeCountAfter: afterComplete.length,
    overlapAfter: afterIncomplete.filter((r) => afterCompleteIds.has(r.id)).length,
    duplicateMatches: duplicateMatches.map((r) => r.id),
  };
  report.ingestionProbes = ingestionProbes;
  report.registrationsBlocked = registrationsBlocked;

  const body = approveRes.body ?? {};
  const passed =
    approveRes.status === 200 &&
    body.dataComplete === true &&
    body.approved === true &&
    body.destination === "invoices" &&
    report.postApproval.removedFromIncomplete &&
    report.postApproval.presentInComplete &&
    report.postApproval.overlapAfter === 0 &&
    duplicateMatches.length === 0 &&
    ingestionProbes.every((p) => p.blocked) &&
    registrationsBlocked;

  report.result = passed ? "INVOICE_DIRECT_APPROVAL_E2E_PASSED" : "INVOICE_DIRECT_APPROVAL_E2E_FAILED";
  report.recommendation = passed ? "INVOICE_DIRECT_APPROVAL_E2E_PASSED" : "INVESTIGATE_FAILURE";

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
  process.exit(passed ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
