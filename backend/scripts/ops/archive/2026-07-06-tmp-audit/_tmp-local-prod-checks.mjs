import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;
const org = "cmqxujfuj034ndy2czu9tjoko";

const { runIntegrityWatchForOrganization } = await import("../src/services/dataIntegrityWatch/integrityRunner.js");
const { prisma } = await import("../src/lib/prisma.js");

const report = await runIntegrityWatchForOrganization(prisma, org, { dryRun: true, mode: "manual" });
const warnings = report.organizationReports[0].findings.filter((f) => f.severity === "warning" && f.status === "fail");
console.log(JSON.stringify(warnings.map((f) => ({ checkId: f.checkId, root: f.probableRootCause, entity: f.entityId })), null, 2));

await prisma.$disconnect();
