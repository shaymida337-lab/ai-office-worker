import { PrismaClient } from "@prisma/client";
import fs from "fs";
import { execSync } from "child_process";

const url = fs.readFileSync(".env.prod.local", "utf8").match(/PROD_DATABASE_URL=(.+)/)?.[1]?.trim()!;
const ORG = "cmqxujfuj034ndy2czu9tjoko";
const prisma = new PrismaClient({ datasources: { db: { url } } });

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function snapshot() {
  const active = await prisma.syncLog.findMany({
    where: {
      organizationId: ORG,
      type: "gmail_scan",
      status: { in: ["queued", "running"] },
      finishedAt: null,
    },
    orderBy: { startedAt: "desc" },
  });
  const latestManual = await prisma.syncLog.findFirst({
    where: { organizationId: ORG, type: "gmail_scan", scanMode: "manual" },
    orderBy: { startedAt: "desc" },
  });
  return { activeCount: active.length, active, latestManual };
}

async function main() {
  let scan = (await snapshot()).latestManual;
  if (!scan || scan.scanMode !== "manual") {
    console.log("NO_MANUAL_SCAN");
    return;
  }
  const deadline = new Date(scan.startedAt.getTime() + 30 * 60 * 1000 + 90_000);
  console.log("MONITORING", scan.id, "startedAt", scan.startedAt.toISOString(), "deadlineCheckAfter", deadline.toISOString());

  while (Date.now() < deadline.getTime()) {
    const row = await prisma.syncLog.findUnique({ where: { id: scan.id } });
    if (!row) break;
    const ageSec = Math.round((Date.now() - row.startedAt.getTime()) / 1000);
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        ageSec,
        status: row.status,
        emailsProcessed: row.emailsProcessed,
        emailsSaved: row.emailsSaved,
        finishedAt: row.finishedAt,
        windowTruncated: row.windowTruncated,
      })
    );
    if (row.finishedAt || row.status === "paused" || row.status === "stale" || row.status === "completed") {
      break;
    }
    await sleep(60_000);
  }

  await sleep(20_000);
  const final = await prisma.syncLog.findUnique({ where: { id: scan.id } });
  const activeCount = await prisma.syncLog.count({
    where: {
      organizationId: ORG,
      type: "gmail_scan",
      status: { in: ["queued", "running"] },
      finishedAt: null,
    },
  });

  let telemetry = false;
  try {
    const key = fs.readFileSync(".env.prod.local", "utf8").match(/RENDER_API_KEY=(.+)/)?.[1]?.trim();
    const start = new Date(scan.startedAt.getTime() - 60_000).toISOString();
    const end = new Date().toISOString();
    const apiUrl =
      `https://api.render.com/v1/logs?ownerId=tea-d86903gg4nts73abte2g` +
      `&resource=srv-d898po77f7vs73bu01v0&limit=100&direction=backward` +
      `&startTime=${start}&endTime=${end}`;
    const raw = execSync(`curl.exe -s -H "Authorization: Bearer ${key}" "${apiUrl}"`, { encoding: "utf8" });
    const logs = JSON.parse(raw).logs ?? [];
    telemetry = logs.some(
      (l: { message?: string }) =>
        (l.message ?? "").includes("scan_paused_deadline") && (l.message ?? "").includes(scan.id)
    );
  } catch {
    telemetry = false;
  }

  console.log(
    "FINAL",
    JSON.stringify(
      {
        scanId: final?.id,
        status: final?.status,
        emailsProcessed: final?.emailsProcessed,
        emailsSaved: final?.emailsSaved,
        finishedAt: final?.finishedAt,
        windowTruncated: final?.windowTruncated,
        activeScansCount: activeCount,
        becamePausedNotStale: final?.status === "paused",
        telemetryScanPausedDeadline: telemetry,
      },
      null,
      2
    )
  );
}

main()
  .finally(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
