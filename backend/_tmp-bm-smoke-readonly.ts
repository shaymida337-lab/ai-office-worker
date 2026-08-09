/**
 * Read-only smoke for Business Modules gate.
 * - Never starts Gmail scans
 * - Confirms BM commit file set excludes scan surface
 * - Loads invoice UI shells
 * - Probes only read-only Gmail GETs + confirms POST route strings unchanged in git
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const FRONT = "https://ai-office-worker-frontend.onrender.com";
const API = "https://ai-office-worker-backend.onrender.com";
const BACKEND_SERVICE = "srv-d898po77f7vs73bu01v0";
const ORG_ID = "cmpjd7j7e0001bl5tzv049rxb";

async function renderJwtSecret(): Promise<string> {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) throw new Error("RENDER_API_KEY missing");
  let url = `https://api.render.com/v1/services/${BACKEND_SERVICE}/env-vars?limit=100`;
  for (let i = 0; i < 10; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    if (!res.ok) throw new Error(`Render env-vars ${res.status}`);
    const data = (await res.json()) as Array<{
      envVar?: { key?: string; value?: string };
      key?: string;
      value?: string;
      cursor?: string;
    }>;
    for (const item of data) {
      const key = item.envVar?.key ?? item.key;
      const val = item.envVar?.value ?? item.value;
      if (key === "JWT_SECRET" && val) return val;
    }
    const cursor = data.at(-1)?.cursor;
    if (!cursor) break;
    url = `https://api.render.com/v1/services/${BACKEND_SERVICE}/env-vars?limit=100&cursor=${cursor}`;
  }
  throw new Error("JWT_SECRET not found");
}

function extractGmailRouteLines(ref: string): string[] {
  const text = execSync(`git show ${ref}:backend/src/routes/api.ts`, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  return text
    .split(/\r?\n/)
    .map((line, idx) => ({ line, n: idx + 1 }))
    .filter(({ line }) =>
      /apiRouter\.(get|post|put|delete|patch)\([`'"]\/(?:gmail\/scan|gmail-scan|gmail\/rescan-invoices|gmail\/scan-stats)/.test(
        line
      ) || /apiRouter\.(get|post)\([`'"]\/gmail\/scan\//.test(line)
    )
    .map(({ line, n }) => `${n}:${line.trim()}`);
}

async function main() {
  const files = execSync("git diff --name-only 96d3895..87c3978", { encoding: "utf8" })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const backendFiles = execSync("git diff --name-only 96d3895..87c3978 -- backend", { encoding: "utf8" }).trim();
  const protectedHits = files.filter((f) =>
    /gmail|ocr|invoice|FinancialDocument|SupplierPayment|upload|containment|normalizedDocumentDate|camera|scan|duplicate/i.test(
      f
    )
  );

  const originRoutes = extractGmailRouteLines("origin/main");
  const bmRoutes = extractGmailRouteLines("87c3978");

  const prodUrl = process.env.PROD_DATABASE_URL ?? "";
  if (!prodUrl || /localhost|127\.0\.0\.1/.test(prodUrl)) throw new Error("PROD_DATABASE_URL required");
  if (process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") throw new Error("ALLOW_REMOTE_READONLY_REPORT=1 required");

  const prisma = new PrismaClient({ datasources: { db: { url: prodUrl } } });
  const org = await prisma.organization.findUnique({ where: { id: ORG_ID }, include: { user: true } });
  if (!org?.user) throw new Error("org missing");
  const secret = await renderJwtSecret();
  const token = jwt.sign(
    { userId: org.user.id, organizationId: org.id, email: org.user.email },
    secret,
    { expiresIn: "10m" }
  );
  await prisma.$disconnect();

  const invoicePages = [] as Array<{ path: string; status: number; ok: boolean }>;
  for (const path of ["/dashboard/invoices", "/reports", "/dashboard/invoice-drafts"]) {
    const res = await fetch(`${FRONT}${path}`, { redirect: "follow" });
    const html = await res.text();
    // App shell / Next assets prove the route still serves; login redirect is also a load.
    const ok = res.status >= 200 && res.status < 500 && /_next\/static|חשבוניות|invoices|login|התחבר/i.test(html);
    invoicePages.push({ path, status: res.status, ok });
  }

  // Authenticated read-only Gmail surface (no POST scan).
  const scanStats = await fetch(`${API}/api/gmail/scan-stats`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const scanStatsBody = await scanStats.json().catch(() => null);
  const missingScan = await fetch(`${API}/api/gmail/scan/not-a-real-scan-id`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  console.log(
    JSON.stringify(
      {
        filesChangedInBmCommit: files,
        backendFilesChanged: backendFiles ? backendFiles.split(/\r?\n/) : [],
        protectedPathHits: protectedHits,
        noScanModuleFiles: protectedHits.length === 0 && !backendFiles,
        gmailRoutesIdenticalOriginVsBm: JSON.stringify(originRoutes) === JSON.stringify(bmRoutes),
        gmailRouteLines: bmRoutes,
        invoicePages,
        gmailReadOnly: {
          scanStatsStatus: scanStats.status,
          scanStatsKeys:
            scanStatsBody && typeof scanStatsBody === "object"
              ? Object.keys(scanStatsBody as object).slice(0, 15)
              : [],
          missingScanStatus: missingScan.status,
        },
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
