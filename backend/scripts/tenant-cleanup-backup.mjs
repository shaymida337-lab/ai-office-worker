import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG_IDS = [
  "cmpjd7j7e0001bl5tzv049rxb",
  "cmqve9z5j05r1kr29ivi3dyuj",
  "cmqw27e43002bm92bmf9mjy1n",
];

const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL } } });

function parseMeta(metadata) {
  if (!metadata) return null;
  try {
    return typeof metadata === "string" ? JSON.parse(metadata) : metadata;
  } catch {
    return metadata;
  }
}

function redactIntegration(row) {
  const meta = parseMeta(row.metadata);
  return {
    ...row,
    accessToken: row.accessToken ? "[REDACTED]" : null,
    refreshToken: row.refreshToken ? "[REDACTED]" : null,
    metadata: meta,
    providerAccountEmail: meta?.googleAccountEmail ?? null,
  };
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(process.cwd(), "backups", `tenant-cleanup-${stamp}`);
mkdirSync(outDir, { recursive: true });

const organizations = await prisma.organization.findMany({
  where: { id: { in: ORG_IDS } },
  include: { user: { select: { id: true, email: true, name: true } } },
});

const integrations = await prisma.integration.findMany({
  where: { organizationId: { in: ORG_IDS } },
  orderBy: [{ organizationId: "asc" }, { provider: "asc" }],
});

const fullBackup = {
  exportedAt: new Date().toISOString(),
  organizationIds: ORG_IDS,
  organizations,
  integrations,
};

const redactedBackup = {
  exportedAt: fullBackup.exportedAt,
  organizationIds: ORG_IDS,
  organizations,
  integrations: integrations.map(redactIntegration),
};

writeFileSync(join(outDir, "full-backup.json"), JSON.stringify(fullBackup, null, 2));
writeFileSync(join(outDir, "redacted-backup.json"), JSON.stringify(redactedBackup, null, 2));

const sqlLines = [
  "-- Tenant cleanup backup (integrations + organizations)",
  `-- exportedAt: ${fullBackup.exportedAt}`,
  "",
];
for (const org of organizations) {
  sqlLines.push(`-- Organization ${org.id}`);
  sqlLines.push(
    `INSERT INTO "Organization" ("id","name","userId","timezone","currency","locale","businessName","createdAt","updatedAt") VALUES (` +
    `'${org.id}','${org.name.replace(/'/g, "''")}','${org.userId}','${org.timezone}','${org.currency}','${org.locale}',` +
    `${org.businessName ? `'${org.businessName.replace(/'/g, "''")}'` : "NULL"},` +
    `'${org.createdAt.toISOString()}','${org.updatedAt.toISOString()}') ON CONFLICT ("id") DO NOTHING;`
  );
}
for (const row of integrations) {
  const meta = row.metadata ? `'${row.metadata.replace(/'/g, "''")}'` : "NULL";
  sqlLines.push(
    `INSERT INTO "Integration" ("id","organizationId","provider","accessToken","refreshToken","expiresAt","metadata","connectedAt","updatedAt") VALUES (` +
    `'${row.id}','${row.organizationId}','${row.provider}',` +
    `${row.accessToken ? "'[TOKEN]'" : "NULL"},${row.refreshToken ? "'[TOKEN]'" : "NULL"},` +
    `${row.expiresAt ? `'${row.expiresAt.toISOString()}'` : "NULL"},${meta},` +
    `'${row.connectedAt.toISOString()}','${row.updatedAt.toISOString()}') ON CONFLICT ("id") DO NOTHING;`
  );
}
writeFileSync(join(outDir, "restore-reference.sql"), sqlLines.join("\n"));

console.log(JSON.stringify({
  backupDir: outDir,
  organizationCount: organizations.length,
  integrationCount: integrations.length,
  gmailRows: integrations.filter((i) => i.provider === "gmail").map((i) => ({
    id: i.id,
    organizationId: i.organizationId,
    providerAccountEmail: parseMeta(i.metadata)?.googleAccountEmail ?? null,
    refreshTokenExists: Boolean(i.refreshToken),
  })),
}, null, 2));

await prisma.$disconnect();
