/**
 * Safe infra probe — prints metadata only (no URLs, users, passwords, full hosts).
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";

const backendRoot = process.cwd();
const repoRoot = join(backendRoot, "..");
loadEnv({ path: join(repoRoot, ".env") });
if (existsSync(join(repoRoot, ".env.prod.local"))) {
  loadEnv({ path: join(repoRoot, ".env.prod.local"), override: false });
}
if (existsSync(join(backendRoot, ".env"))) {
  loadEnv({ path: join(backendRoot, ".env"), override: false });
}

function safeDbMeta(raw) {
  if (!raw) return { present: false };
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const hasPooler = host.includes("-pooler") || u.searchParams.get("pgbouncer") === "true";
    let neonRegion = null;
    const neonMatch = host.match(/\.([a-z0-9-]+)\.aws\.neon\.tech$/i);
    if (neonMatch) neonRegion = neonMatch[1];
    else if (host.includes("neon.tech")) neonRegion = "neon-unknown-region";
    const provider = host.includes("neon.tech")
      ? "neon"
      : host.includes("supabase")
        ? "supabase"
        : host.includes("amazonaws")
          ? "aws"
          : "other";
    return {
      present: true,
      provider,
      hasPoolerInHost: host.includes("-pooler"),
      hasPgBouncerParam: u.searchParams.get("pgbouncer") === "true",
      pooled: hasPooler,
      neonRegion,
      hostClass: host.endsWith(".neon.tech")
        ? "*.neon.tech"
        : host.includes(".")
          ? `*.${host.split(".").slice(-2).join(".")}`
          : "opaque",
    };
  } catch {
    return { present: true, parseError: true };
  }
}

const dbMeta = safeDbMeta(process.env.DATABASE_URL);
const directMeta = safeDbMeta(process.env.DIRECT_URL);

console.log(
  JSON.stringify(
    {
      renderYamlBackendRegion: "oregon",
      renderYamlFrontendRegion: "oregon",
      databaseUrl: dbMeta,
      directUrl: directMeta,
    },
    null,
    2
  )
);

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ error: "DATABASE_URL missing — cannot measure DB latency" }));
  process.exit(2);
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: (() => {
        const raw = process.env.DATABASE_URL;
        try {
          const u = new URL(raw);
          u.searchParams.set("pgbouncer", "true");
          u.searchParams.set("connection_limit", "5");
          return u.toString();
        } catch {
          return raw;
        }
      })(),
    },
  },
});

function pct(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function timed(fn) {
  const t0 = performance.now();
  await fn();
  return Math.round(performance.now() - t0);
}

try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;

  const select1 = [];
  for (let i = 0; i < 5; i++) {
    select1.push(await timed(() => prisma.$queryRaw`SELECT 1`));
  }

  const orgLookup = [];
  for (let i = 0; i < 5; i++) {
    orgLookup.push(
      await timed(() =>
        prisma.organization.findFirst({
          select: { id: true, name: true },
          orderBy: { createdAt: "asc" },
        })
      )
    );
  }

  const countBasic = [];
  for (let i = 0; i < 5; i++) {
    countBasic.push(await timed(() => prisma.organization.count()));
  }

  const all = [...select1, ...orgLookup, ...countBasic].sort((a, b) => a - b);
  const selectSorted = [...select1].sort((a, b) => a - b);
  const orgSorted = [...orgLookup].sort((a, b) => a - b);
  const countSorted = [...countBasic].sort((a, b) => a - b);
  const p50 = pct(all, 50);
  const p95 = pct(all, 95);
  const neonRegion = dbMeta.neonRegion ?? null;
  const regionMismatchLikely =
    Boolean(neonRegion) && !String(neonRegion).startsWith("us-west") && neonRegion !== "oregon";

  console.log(
    JSON.stringify(
      {
        prismaSingletonPatternInCode: "globalThis.prisma (yes)",
        measurementsMs: {
          select1_hot: select1,
          select1_p50: pct(selectSorted, 50),
          select1_p95: pct(selectSorted, 95),
          orgLookup_hot: orgLookup,
          orgLookup_p50: pct(orgSorted, 50),
          orgLookup_p95: pct(orgSorted, 95),
          countBasic_hot: countBasic,
          countBasic_p50: pct(countSorted, 50),
          countBasic_p95: pct(countSorted, 95),
          combined_server_to_db_p50: p50,
          combined_server_to_db_p95: p95,
        },
        gate: {
          pooled: Boolean(dbMeta.pooled),
          neonRegion,
          renderRegion: "oregon",
          regionMismatchLikely,
          p50Over100ms: (p50 ?? 0) > 100,
          stopBeforeBootstrap: regionMismatchLikely || (p50 ?? 0) > 100,
        },
      },
      null,
      2
    )
  );
} finally {
  await prisma.$disconnect();
}
