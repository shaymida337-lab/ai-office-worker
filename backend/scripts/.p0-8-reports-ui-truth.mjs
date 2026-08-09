/**
 * Reports UI production truth check — readonly probe.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { existsSync } from "fs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const backendDir = join(root, "backend");
const frontendDir = join(root, "frontend");

config({ path: join(backendDir, ".env") });
if (existsSync(join(backendDir, ".env.prod.local"))) {
  config({ path: join(backendDir, ".env.prod.local"), override: true });
}

const FRONT = "https://ai-office-worker-frontend.onrender.com";
const API = "https://ai-office-worker-backend.onrender.com";
const ORG = "cmpjd7j7e0001bl5tzv049rxb";

// Inline minimal copy of getInvoiceCompletionAction logic for probe (matches source)
const MISSING_FIELD_MARKERS = ["חסר סכום", "ספק לא זוהה", "חסר תאריך", "מטבע חסר", "סוג מסמך חסר"];

function resolveSourceType(invoice) {
  if (invoice.id?.startsWith("gmail-scan:") || invoice.source === "gmail_scan_item") return "gmail-scan-item";
  if (invoice.id?.startsWith("document-review:") || invoice.source === "financial_document_review") return "document-review";
  if (invoice.id?.startsWith("supplier-payment:") || invoice.source === "supplier_payment") return "supplier-payment";
  return null;
}

function inferFlags(invoice) {
  if (typeof invoice.dataComplete === "boolean" && typeof invoice.approvalRequired === "boolean") {
    return { dataComplete: invoice.dataComplete, approvalRequired: invoice.approvalRequired };
  }
  const missing =
    invoice.missingDataReasons ??
    (invoice.completionReasons ?? []).filter((r) => MISSING_FIELD_MARKERS.some((m) => r.includes(m)));
  const approval =
    invoice.approvalReasons ??
    (invoice.completionReasons ?? []).filter((r) => r.includes("ממתין לאישור") || r.includes("רמת ביטחון") || r.includes("כמה סכומים"));
  return {
    dataComplete: missing.length === 0,
    approvalRequired: approval.length > 0 || invoice.reviewStatus === "needs_review",
  };
}

function getInvoiceCompletionAction(invoice) {
  if (invoice.source === "invoice" || !resolveSourceType(invoice)) {
    return { kind: "none", primaryLabel: "" };
  }
  const { dataComplete, approvalRequired } = inferFlags(invoice);
  if (invoice.approvalBlockReason === "blocked_outcome") {
    return { kind: "blocked", primaryLabel: "חסום" };
  }
  if (invoice.supplierNeedsConfirmation || invoice.approvalBlockReason === "supplier.needs_confirmation") {
    return { kind: "edit_supplier", primaryLabel: "ערוך ספק" };
  }
  if (dataComplete && approvalRequired && invoice.canApproveDirectly === true) {
    return { kind: "approve_only", primaryLabel: "אשר" };
  }
  if (dataComplete && approvalRequired) {
    return { kind: "complete_details", primaryLabel: "השלם פרטים" };
  }
  if (!dataComplete && approvalRequired) {
    return { kind: "complete_and_approve", primaryLabel: "השלם ואשר" };
  }
  if (!dataComplete) {
    return { kind: "complete_details", primaryLabel: "השלם פרטים" };
  }
  return { kind: "none", primaryLabel: "" };
}

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

async function scanProdBundle() {
  const html = await fetch(`${FRONT}/reports`).then((r) => r.text());
  const scriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  const linkHrefs = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]);
  const needles = ["אשר והשלם", "ערוך ספק", "השלם פרטים", "חסום", "השלם ואשר", "canApproveDirectly", "getInvoiceCompletionAction"];
  const htmlHits = Object.fromEntries(needles.map((n) => [n, html.includes(n)]));
  const chunkHits = {};
  const allUrls = [...new Set([...scriptSrcs, ...linkHrefs].filter((u) => u.includes("/_next/static/")))];
  for (const rel of allUrls) {
    const url = rel.startsWith("http") ? rel : `${FRONT}${rel}`;
    const text = await fetch(url).then((r) => r.text()).catch(() => "");
    for (const n of needles) {
      if (text.includes(n)) {
        chunkHits[n] = chunkHits[n] || [];
        chunkHits[n].push(url.split("/").pop());
      }
    }
  }
  // Also fetch reports page chunk specifically
  const reportsChunkCandidates = allUrls.filter((u) => u.includes("reports") || u.includes("ReportsClient"));
  return { htmlHits, chunkHits, totalChunks: allUrls.length, reportsChunkCandidates };
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

  const apiRes = await fetch(`${API}/api/invoices?completeness=incomplete`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const apiData = await apiRes.json();
  const rows = (apiData.invoices ?? []).slice(0, 10).map((r) => {
    const action = getInvoiceCompletionAction(r);
    return {
      id: r.id,
      sourceType: resolveSourceType(r),
      canApproveDirectly: r.canApproveDirectly,
      supplierNeedsConfirmation: r.supplierNeedsConfirmation,
      approvalBlockReason: r.approvalBlockReason,
      dataComplete: r.dataComplete,
      approvalRequired: r.approvalRequired,
      missingDataReasons: r.missingDataReasons ?? [],
      approvalReasons: r.approvalReasons ?? [],
      expectedButton: action.primaryLabel,
      expectedKind: action.kind,
    };
  });

  const fixtures = [
    { name: "A", invoice: { id: "gmail-scan:t", source: "gmail_scan_item", reviewStatus: "needs_review", dataComplete: true, approvalRequired: true, canApproveDirectly: true }, expected: "אשר" },
    { name: "B", invoice: { id: "gmail-scan:t", source: "gmail_scan_item", reviewStatus: "needs_review", dataComplete: true, approvalRequired: true, supplierNeedsConfirmation: true, approvalBlockReason: "supplier.needs_confirmation" }, expected: "ערוך ספק" },
    { name: "C", invoice: { id: "gmail-scan:t", source: "gmail_scan_item", reviewStatus: "needs_review", dataComplete: false, approvalRequired: false, missingDataReasons: ["חסר סכום"] }, expected: "השלם פרטים" },
    { name: "D", invoice: { id: "gmail-scan:t", source: "gmail_scan_item", reviewStatus: "needs_review", dataComplete: true, approvalRequired: true, approvalBlockReason: "blocked_outcome" }, expected: "חסום" },
  ].map((f) => {
    const a = getInvoiceCompletionAction(f.invoice);
    return { ...f, actual: a.primaryLabel, kind: a.kind, pass: a.primaryLabel === f.expected };
  });

  const bundle = await scanProdBundle();

  const localSource = readFileSync(join(frontendDir, "src/lib/invoices/completionActions.ts"), "utf8");
  const localReports = readFileSync(join(frontendDir, "src/app/reports/ReportsClient.tsx"), "utf8");

  const labelCounts = {};
  for (const r of apiData.invoices ?? []) {
    const label = getInvoiceCompletionAction(r).primaryLabel;
    labelCounts[label] = (labelCounts[label] ?? 0) + 1;
  }

  console.log(
    JSON.stringify(
      {
        localCode: {
          reportsComponent: "frontend/src/app/reports/ReportsClient.tsx",
          pageComponent: "frontend/src/app/reports/page.tsx -> dynamic(ReportsClient)",
          hasAsherVeHashlemInReportsClient: localReports.includes("אשר והשלם"),
          hasAsherVeHashlemInCompletionActions: localSource.includes("אשר והשלם"),
          hasNewLabels: {
            asher: localSource.includes('primaryLabel: "אשר"'),
            editSupplier: localSource.includes('primaryLabel: "ערוך ספק"'),
            completeDetails: localSource.includes('primaryLabel: "השלם פרטים"'),
            blocked: localSource.includes('primaryLabel: "חסום"'),
            completeVeAsher: localSource.includes('primaryLabel: "השלם ואשר"'),
          },
        },
        fixtures,
        apiFirst10: rows,
        allIncompleteLabelDistribution: labelCounts,
        prodBundle: bundle,
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
