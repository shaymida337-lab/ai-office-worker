/**
 * Laptop → Neon (PROD_DATABASE_URL) latency probe. Metadata only.
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const root = join(process.cwd(), "..");
if (existsSync(join(root, ".env.prod.local"))) {
  loadEnv({ path: join(root, ".env.prod.local"), override: true });
}

const raw = process.env.PROD_DATABASE_URL;
if (!raw) {
  console.log(JSON.stringify({ error: "PROD_DATABASE_URL missing" }));
  process.exit(2);
}

const host = new URL(raw).hostname.toLowerCase();
const neonRegion =
  host.split(".").find((p) => /^(us|eu|ap|sa|ca|af|me)-[a-z0-9-]+-\d+$/i.test(p)) ||
  host.split(".").find((p) => /^(us|eu|ap|sa|ca|af|me)-[a-z]+-\d+$/i.test(p)) ||
  null;
const pooled = host.includes("-pooler");

console.log(
  JSON.stringify({
    renderRegion: "oregon",
    neonRegion,
    pooled,
    hasPoolerInHost: pooled,
    measureNote: "laptop->Neon (not Render colocated)",
  })
);

function pct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
async function timed(fn) {
  const t0 = performance.now();
  await fn();
  return Math.round(performance.now() - t0);
}

const u = new URL(raw);
u.searchParams.set("pgbouncer", "true");
u.searchParams.set("connection_limit", "5");
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  const select1 = [];
  for (let i = 0; i < 5; i++) select1.push(await timed(() => prisma.$queryRaw`SELECT 1`));
  const org = [];
  for (let i = 0; i < 5; i++) {
    org.push(
      await timed(() =>
        prisma.organization.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } })
      )
    );
  }
  const cnt = [];
  for (let i = 0; i < 5; i++) cnt.push(await timed(() => prisma.organization.count()));
  const all = [...select1, ...org, ...cnt].sort((a, b) => a - b);
  const p50 = pct(all, 50);
  const p95 = pct(all, 95);
  const regionMismatch = Boolean(neonRegion && !String(neonRegion).startsWith("us-west"));
  console.log(
    JSON.stringify(
      {
        measurementsMs: {
          select1_hot: select1,
          select1_p50: pct([...select1].sort((a, b) => a - b), 50),
          orgLookup_hot: org,
          orgLookup_p50: pct([...org].sort((a, b) => a - b), 50),
          countBasic_hot: cnt,
          count_p50: pct([...cnt].sort((a, b) => a - b), 50),
          combined_p50: p50,
          combined_p95: p95,
        },
        gate: {
          pooled: true,
          renderRegion: "oregon",
          neonRegion,
          regionMismatchLikely: regionMismatch,
          p50Over100ms: p50 > 100,
          stopBeforeBootstrap: regionMismatch || p50 > 100,
          caveat: "Measured from developer laptop to Neon, not from Render oregon process",
        },
      },
      null,
      2
    )
  );
} finally {
  await prisma.$disconnect();
}
