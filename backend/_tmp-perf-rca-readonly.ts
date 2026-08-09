/**
 * READ-ONLY production performance RCA measurements.
 * - No writes, no scans, no commits
 * - Prints timings + payload sizes only (never secrets/tokens)
 */
import { config as loadEnv } from "dotenv";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const FRONT = process.env.PROD_FRONT_URL ?? "https://ai-office-worker-frontend.onrender.com";
const API = process.env.PROD_API_URL ?? "https://ai-office-worker-backend.onrender.com";
const BACKEND_SERVICE = "srv-d898po77f7vs73bu01v0";
const ORG_ID = process.env.VERIFY_ORG_ID ?? "cmpjd7j7e0001bl5tzv049rxb";
const OUT_DIR = join(process.cwd(), "..", ".evidence-perf-rca");

type Timed = {
  path: string;
  status: number;
  ms: number;
  bytes: number;
  cacheControl: string | null;
  age: string | null;
  xCache: string | null;
  error?: string;
};

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
  throw new Error("JWT_SECRET not found on Render");
}

async function timeGet(url: string, token?: string, label?: string): Promise<Timed> {
  const t0 = performance.now();
  const path = label ?? url;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json,text/html,*/*",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Cache-Control": "no-cache",
      },
      cache: "no-store",
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const ms = Math.round(performance.now() - t0);
    return {
      path,
      status: res.status,
      ms,
      bytes: buf.byteLength,
      cacheControl: res.headers.get("cache-control"),
      age: res.headers.get("age"),
      xCache: res.headers.get("x-cache") ?? res.headers.get("cf-cache-status"),
    };
  } catch (err) {
    return {
      path,
      status: 0,
      ms: Math.round(performance.now() - t0),
      bytes: 0,
      cacheControl: null,
      age: null,
      xCache: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function timeApi(path: string, token: string): Promise<Timed> {
  return timeGet(`${API}${path}`, token, path);
}

async function parallelBurst(paths: string[], token: string): Promise<{ totalMs: number; results: Timed[] }> {
  const t0 = performance.now();
  const results = await Promise.all(paths.map((p) => timeApi(p, token)));
  return { totalMs: Math.round(performance.now() - t0), results };
}

async function main() {
  const prodUrl = process.env.PROD_DATABASE_URL ?? "";
  if (!prodUrl || /localhost|127\.0\.0\.1/.test(prodUrl)) throw new Error("PROD_DATABASE_URL required");
  if (process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") throw new Error("ALLOW_REMOTE_READONLY_REPORT=1 required");

  mkdirSync(OUT_DIR, { recursive: true });

  const prisma = new PrismaClient({ datasources: { db: { url: prodUrl } } });
  const org = await prisma.organization.findUnique({
    where: { id: ORG_ID },
    select: {
      id: true,
      name: true,
      user: { select: { id: true, email: true } },
      _count: {
        select: {
          clients: true,
          invoices: true,
          supplierPayments: true,
          documentReviews: true,
          tasks: true,
          appointments: true,
          leads: true,
        },
      },
    },
  });
  if (!org?.user) throw new Error("org missing");

  // ---- Experiment: health cold vs warm (no auth) ----
  const healthCold = await timeGet(`${API}/health`);
  // wait briefly then warm
  const healthWarm1 = await timeGet(`${API}/health`);
  const healthWarm2 = await timeGet(`${API}/health`);
  const frontCold = await timeGet(`${FRONT}/login`);
  const frontWarm = await timeGet(`${FRONT}/login`);

  const secret = await renderJwtSecret();
  const token = jwt.sign(
    { userId: org.user.id, organizationId: org.id, email: org.user.email },
    secret,
    { expiresIn: "30m" }
  );

  const endpoints = [
    "/api/organization/settings",
    "/api/stats",
    "/api/dashboard/home-metrics",
    "/api/integrations/gmail/status",
    "/api/document-reviews?status=needs_review",
    "/api/document-reviews?status=approved",
    "/api/scheduling/briefing?from=" +
      encodeURIComponent(new Date(Date.now() - 7 * 864e5).toISOString()) +
      "&to=" +
      encodeURIComponent(new Date(Date.now() + 7 * 864e5).toISOString()),
    "/api/tasks",
    "/api/clients",
    "/api/leads",
    "/api/payments",
    "/api/invoices?completeness=incomplete",
    "/api/invoices?completeness=complete",
    "/api/summary/daily",
    "/api/alerts",
    "/api/accountant/summary",
    "/api/system/health",
    "/api/automation/scan-status",
    "/api/appointments?from=" +
      encodeURIComponent(new Date().toISOString().slice(0, 10)) +
      "&to=" +
      encodeURIComponent(new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10)),
    "/api/services",
    "/api/employees",
    "/api/integrations/calendar/status",
    "/api/scheduling/capabilities",
    "/api/invoices/months",
    "/api/natalie/session",
    "/api/accountant/settings",
    "/api/settings/business-profile",
    "/api/whatsapp-assistant/settings",
    "/api/whatsapp/status",
    "/api/social/status",
    "/api/green-invoice/status",
  ];

  // Cold-ish: first hit each endpoint sequentially after health already warmed process
  const coldSeq: Timed[] = [];
  for (const path of endpoints) {
    coldSeq.push(await timeApi(path, token));
  }

  // Warm: hit again sequentially
  const warmSeq: Timed[] = [];
  for (const path of endpoints) {
    warmSeq.push(await timeApi(path, token));
  }

  // Dashboard critical burst (mirrors useDashboardHome critical Promise.allSettled)
  const criticalPaths = [
    "/api/stats",
    "/api/integrations/gmail/status",
    "/api/organization/settings",
    "/api/document-reviews?status=needs_review",
    "/api/scheduling/briefing?from=" +
      encodeURIComponent(new Date(Date.now() - 7 * 864e5).toISOString()) +
      "&to=" +
      encodeURIComponent(new Date(Date.now() + 7 * 864e5).toISOString()),
    "/api/tasks",
  ];
  const criticalAlone = await parallelBurst(criticalPaths, token);
  // Add home-metrics in parallel like FE
  const criticalPlusHome = await parallelBurst([...criticalPaths, "/api/dashboard/home-metrics"], token);

  // Full dashboard mount burst (critical + deferred approx)
  const fullMountPaths = [
    ...criticalPaths,
    "/api/dashboard/home-metrics",
    "/api/summary/daily",
    "/api/clients",
    "/api/automation/scan-status",
    "/api/payments",
    "/api/invoices?completeness=incomplete",
    "/api/invoices?completeness=complete",
    "/api/alerts",
    "/api/system/health",
    "/api/accountant/summary",
  ];
  const fullMountBurst = await parallelBurst(fullMountPaths, token);

  // Solo vs contended: re-time /api/stats alone after burst
  const statsSolo = await timeApi("/api/stats", token);
  const documentReviewsSolo = await timeApi("/api/document-reviews?status=needs_review", token);
  const invoicesIncompleteSolo = await timeApi("/api/invoices?completeness=incomplete", token);

  // Resource competition: same 3 endpoints alone then together
  const aloneStats = await timeApi("/api/stats", token);
  const aloneDocs = await timeApi("/api/document-reviews?status=needs_review", token);
  const aloneInv = await timeApi("/api/invoices?completeness=incomplete", token);
  const together = await parallelBurst(
    ["/api/stats", "/api/document-reviews?status=needs_review", "/api/invoices?completeness=incomplete"],
    token
  );

  // Org settings duplicated cost: 5 parallel identical
  const orgDup = await parallelBurst(Array(5).fill("/api/organization/settings") as string[], token);

  await prisma.$disconnect();

  const report = {
    measuredAt: new Date().toISOString(),
    org: { id: org.id, name: org.name, counts: org._count },
    infra: {
      healthCold,
      healthWarm1,
      healthWarm2,
      frontCold,
      frontWarm,
    },
    endpointsCold: coldSeq,
    endpointsWarm: warmSeq,
    experiments: {
      criticalAlone,
      criticalPlusHome,
      fullMountBurst,
      statsSoloAfterBurst: statsSolo,
      documentReviewsSoloAfterBurst: documentReviewsSolo,
      invoicesIncompleteSoloAfterBurst: invoicesIncompleteSolo,
      resourceCompetition: {
        alone: { stats: aloneStats, docs: aloneDocs, invoices: aloneInv },
        together,
      },
      orgSettingsDuplicate5: orgDup,
    },
  };

  const outPath = join(OUT_DIR, `api-timings-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outPath, summary: summarize(report) }, null, 2));
}

function summarize(report: {
  endpointsCold: Timed[];
  endpointsWarm: Timed[];
  experiments: {
    criticalAlone: { totalMs: number; results: Timed[] };
    fullMountBurst: { totalMs: number; results: Timed[] };
    resourceCompetition: {
      alone: { stats: Timed; docs: Timed; invoices: Timed };
      together: { totalMs: number; results: Timed[] };
    };
  };
  infra: { healthCold: Timed; healthWarm2: Timed; frontCold: Timed; frontWarm: Timed };
}) {
  const topCold = [...report.endpointsCold].sort((a, b) => b.ms - a.ms).slice(0, 15);
  const topWarm = [...report.endpointsWarm].sort((a, b) => b.ms - a.ms).slice(0, 15);
  return {
    healthColdMs: report.infra.healthCold.ms,
    healthWarmMs: report.infra.healthWarm2.ms,
    frontColdMs: report.infra.frontCold.ms,
    frontWarmMs: report.infra.frontWarm.ms,
    criticalBurstMs: report.experiments.criticalAlone.totalMs,
    fullMountBurstMs: report.experiments.fullMountBurst.totalMs,
    competition: {
      aloneSumMs:
        report.experiments.resourceCompetition.alone.stats.ms +
        report.experiments.resourceCompetition.alone.docs.ms +
        report.experiments.resourceCompetition.alone.invoices.ms,
      togetherWallMs: report.experiments.resourceCompetition.together.totalMs,
      togetherEach: report.experiments.resourceCompetition.together.results.map((r) => ({
        path: r.path,
        ms: r.ms,
      })),
    },
    top15Cold: topCold.map((r) => ({ path: r.path, ms: r.ms, bytes: r.bytes, status: r.status })),
    top15Warm: topWarm.map((r) => ({ path: r.path, ms: r.ms, bytes: r.bytes, status: r.status })),
  };
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
