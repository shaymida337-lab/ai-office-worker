/**
 * READ-ONLY: is Rnet/Bezeq FDR hidden by cross-org read isolation?
 */
import { existsSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const IDS = {
  rnetFdr: "cmqw3n5hx020dm92bp1joi8wu",
  bezeqFdr: "cmqw3onmp0227m92bemcb1bkm",
  rnetOldGmail: "19ee12f8ab9f4579",
  bezeqOldGmail: "19ed663d168fc8dc",
  rnetNewGmail: "19f9e3d9101ed94d",
  bezeqNewGmail: "19f9e3d4a3621e8d",
};

async function main() {
  const prodUrl = process.env.PROD_DATABASE_URL ?? "";
  const u = new URL(prodUrl);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    const {
      loadCrossOrgContaminatedGmailIdsForReads,
      buildFinancialDocumentReviewReadIsolationWhere,
    } = await import("./src/services/p0/financialReadIsolation.ts");

    const contaminatedRaw = await loadCrossOrgContaminatedGmailIdsForReads();
    console.log(
      JSON.stringify({
        contaminatedType: typeof contaminatedRaw,
        isArray: Array.isArray(contaminatedRaw),
        ctor: (contaminatedRaw as any)?.constructor?.name,
        sample: Array.isArray(contaminatedRaw) ? contaminatedRaw.slice(0, 3) : String(contaminatedRaw).slice(0, 100),
      }),
    );
    const list: string[] = Array.isArray(contaminatedRaw)
      ? contaminatedRaw
      : contaminatedRaw instanceof Set
        ? [...contaminatedRaw]
        : typeof contaminatedRaw === "object" && contaminatedRaw
          ? Object.values(contaminatedRaw as any).filter((x) => typeof x === "string")
          : [];
    const set = new Set(list);

    const isolationWhere = buildFinancialDocumentReviewReadIsolationWhere(ORG, list);
    const rnetVisible = await prisma.financialDocumentReview.findFirst({
      where: { AND: [{ id: IDS.rnetFdr }, isolationWhere] },
      select: { id: true, gmailMessageId: true, reviewStatus: true, uncertaintyReason: true },
    });
    const bezeqVisible = await prisma.financialDocumentReview.findFirst({
      where: { AND: [{ id: IDS.bezeqFdr }, isolationWhere] },
      select: { id: true, gmailMessageId: true, reviewStatus: true, uncertaintyReason: true },
    });

    console.log(
      JSON.stringify(
        {
          contaminatedCount: set.size,
          oldRnetContaminated: set.has(IDS.rnetOldGmail),
          oldBezeqContaminated: set.has(IDS.bezeqOldGmail),
          newRnetContaminated: set.has(IDS.rnetNewGmail),
          newBezeqContaminated: set.has(IDS.bezeqNewGmail),
          rnetVisibleAfterIsolation: rnetVisible,
          bezeqVisibleAfterIsolation: bezeqVisible,
          isolationWhereKeys: isolationWhere ? Object.keys(isolationWhere) : null,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e), stack: String((e as any).stack || "").slice(0, 500) }));
  process.exit(1);
});
