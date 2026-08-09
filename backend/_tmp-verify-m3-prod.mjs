/**
 * Prod verify M3 document-reviews summary (read-only).
 * Never prints tokens/secrets.
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const API = process.env.PROD_API_URL ?? "https://ai-office-worker-backend.onrender.com";
const FRONT = process.env.PROD_FRONT_URL ?? "https://ai-office-worker-frontend.onrender.com";
const BACKEND_SERVICE = "srv-d898po77f7vs73bu01v0";
const ORG_ID = process.env.VERIFY_ORG_ID ?? "cmpjd7j7e0001bl5tzv049rxb";

async function renderJwtSecret() {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) throw new Error("RENDER_API_KEY missing");
  let url = `https://api.render.com/v1/services/${BACKEND_SERVICE}/env-vars?limit=100`;
  for (let i = 0; i < 10; i++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Render env-vars ${res.status}`);
    const data = await res.json();
    for (const item of data) {
      const key = item.envVar?.key ?? item.key;
      const val = item.envVar?.value ?? item.value;
      if (key === "JWT_SECRET" && val) return val;
    }
    const cursor = data.at(-1)?.cursor;
    if (!cursor) break;
    url = `https://api.render.com/v1/services/${BACKEND_SERVICE}/env-vars?limit=100&cursor=${cursor}`;
  }
  throw new Error("JWT_SECRET not found on Render");
}

async function timedJson(path, token) {
  const url = `${API}${path}`;
  const t0 = performance.now();
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Cache-Control": "no-cache",
    },
    cache: "no-store",
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try {
    json = JSON.parse(buf.toString("utf8"));
  } catch {
    json = null;
  }
  return { path, status: res.status, ms, bytes: buf.byteLength, json };
}

async function main() {
  const prodUrl = process.env.PROD_DATABASE_URL ?? "";
  if (!prodUrl || /localhost|127\.0\.0\.1/.test(prodUrl)) throw new Error("PROD_DATABASE_URL required");
  if (process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") throw new Error("ALLOW_REMOTE_READONLY_REPORT=1 required");

  const prisma = new PrismaClient({ datasources: { db: { url: prodUrl } } });
  const org = await prisma.organization.findUnique({
    where: { id: ORG_ID },
    select: { id: true, name: true, user: { select: { id: true, email: true } } },
  });
  await prisma.$disconnect();
  if (!org?.user) throw new Error("org missing");

  const secret = await renderJwtSecret();
  const token = jwt.sign(
    { userId: org.user.id, organizationId: org.id, email: org.user.email },
    secret,
    { expiresIn: "30m" },
  );

  const summaryCold = await timedJson("/api/document-reviews?status=needs_review&view=summary", token);
  const summaryWarm1 = await timedJson("/api/document-reviews?status=needs_review&view=summary", token);
  const summaryWarm2 = await timedJson("/api/document-reviews?status=needs_review&view=summary", token);
  const full = await timedJson("/api/document-reviews?status=needs_review", token);
  const metrics = await timedJson("/api/dashboard/home-metrics", token);

  // Background-ish burst: summary + a few other home BG endpoints
  const burstPaths = [
    "/api/stats",
    "/api/document-reviews?status=needs_review&view=summary",
    "/api/alerts",
    "/api/automation/scan-status",
  ];
  const burstT0 = performance.now();
  const burstResults = await Promise.all(burstPaths.map((p) => timedJson(p, token)));
  const burstTotalMs = Math.round(performance.now() - burstT0);

  const summary = summaryWarm2.json;
  const fullList = Array.isArray(full.json) ? full.json : [];
  const summaryCount = summary && typeof summary.count === "number" ? summary.count : null;
  const summaryItems = Array.isArray(summary?.items) ? summary.items : null;
  const fullLength = fullList.length;
  const pendingDocs = metrics.json?.metrics?.pending_docs ?? null;
  const topFullIds = fullList.slice(0, 5).map((r) => r.id);
  const summaryIds = summaryItems ? summaryItems.map((r) => r.id) : [];

  const criteria = {
    summaryHttp200: summaryWarm2.status === 200,
    payloadUnder50kb: summaryWarm2.bytes < 50_000,
    warmUnder2s: summaryWarm2.ms < 2000 && summaryWarm1.ms < 2000,
    itemsAtMost5: summaryItems ? summaryItems.length <= 5 : false,
    countMatchesMetrics:
      summaryCount != null && pendingDocs != null ? summaryCount === pendingDocs : null,
    countVsFullLength:
      summaryCount != null
        ? {
            summaryCount,
            fullLength,
            equalWhenUncapped: fullLength < 200 ? summaryCount === fullLength : null,
            note: fullLength < 200 ? "full length is exact when <200" : "full capped at 200; compare metrics",
          }
        : null,
    sortParityTop5: JSON.stringify(summaryIds) === JSON.stringify(topFullIds),
    noDecisionOnSummaryItems: summaryItems
      ? summaryItems.every((i) => !("decision" in i) && !("rawAnalysis" in i))
      : false,
    fullPathStillArray: Array.isArray(full.json) && full.status === 200,
    summaryInBurstUnder2s: (burstResults.find((r) => r.path.includes("view=summary"))?.ms ?? 99999) < 2000,
  };

  const allMustPass =
    criteria.summaryHttp200 &&
    criteria.payloadUnder50kb &&
    criteria.warmUnder2s &&
    criteria.itemsAtMost5 &&
    criteria.sortParityTop5 &&
    criteria.noDecisionOnSummaryItems &&
    criteria.fullPathStillArray &&
    (criteria.countMatchesMetrics === true || criteria.countVsFullLength?.equalWhenUncapped === true);

  console.log(
    JSON.stringify(
      {
        front: FRONT,
        api: API,
        org: { id: org.id, name: org.name },
        summaryCold: { status: summaryCold.status, ms: summaryCold.ms, bytes: summaryCold.bytes },
        summaryWarm1: { status: summaryWarm1.status, ms: summaryWarm1.ms, bytes: summaryWarm1.bytes },
        summaryWarm2: {
          status: summaryWarm2.status,
          ms: summaryWarm2.ms,
          bytes: summaryWarm2.bytes,
          count: summaryCount,
          items: summaryItems?.length ?? null,
          itemIds: summaryIds,
          keysSample: summaryItems?.[0] ? Object.keys(summaryItems[0]) : [],
        },
        fullPath: {
          status: full.status,
          ms: full.ms,
          bytes: full.bytes,
          length: fullLength,
          topIds: topFullIds,
        },
        homeMetricsPendingDocs: pendingDocs,
        backgroundBurst: {
          totalMs: burstTotalMs,
          results: burstResults.map((r) => ({ path: r.path, status: r.status, ms: r.ms, bytes: r.bytes })),
        },
        criteria,
        allMustPass,
      },
      null,
      2,
    ),
  );

  process.exit(allMustPass ? 0 : 1);
}

main().catch((err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});
