import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const CANONICAL_ORG = "cmpjd7j7e0001bl5tzv049rxb";
const SOURCE_ORG = "cmqve9z5j05r1kr29ivi3dyuj";
const TARGET_EMAIL = "shaymida337@gmail.com";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL } } });

function parseMeta(metadata) {
  if (!metadata) return {};
  try {
    const p = typeof metadata === "string" ? JSON.parse(metadata) : metadata;
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

const canonicalGmail = await prisma.integration.findUnique({
  where: { organizationId_provider: { organizationId: CANONICAL_ORG, provider: "gmail" } },
});
if (canonicalGmail) {
  console.log(JSON.stringify({
    status: "conflict",
    message: "Canonical org already has gmail integration row",
    integrationId: canonicalGmail.id,
  }, null, 2));
  await prisma.$disconnect();
  process.exit(2);
}

const sourceGmail = await prisma.integration.findUnique({
  where: { organizationId_provider: { organizationId: SOURCE_ORG, provider: "gmail" } },
});
if (!sourceGmail) {
  console.log(JSON.stringify({ status: "error", message: "Source org has no gmail row" }, null, 2));
  await prisma.$disconnect();
  process.exit(1);
}

const sourceEmail = parseMeta(sourceGmail.metadata).googleAccountEmail;
if (typeof sourceEmail !== "string" || sourceEmail.toLowerCase() !== TARGET_EMAIL) {
  console.log(JSON.stringify({
    status: "error",
    message: "Source gmail row email mismatch",
    expected: TARGET_EMAIL,
    actual: sourceEmail ?? null,
    integrationId: sourceGmail.id,
  }, null, 2));
  await prisma.$disconnect();
  process.exit(1);
}

const before = {
  id: sourceGmail.id,
  organizationId: sourceGmail.organizationId,
  provider: sourceGmail.provider,
  providerAccountEmail: sourceEmail,
  refreshTokenExists: Boolean(sourceGmail.refreshToken),
  connectedAt: sourceGmail.connectedAt,
  updatedAt: sourceGmail.updatedAt,
};

const updated = await prisma.integration.update({
  where: { id: sourceGmail.id },
  data: { organizationId: CANONICAL_ORG },
});

const after = {
  id: updated.id,
  organizationId: updated.organizationId,
  provider: updated.provider,
  providerAccountEmail: parseMeta(updated.metadata).googleAccountEmail ?? null,
  refreshTokenExists: Boolean(updated.refreshToken),
  connectedAt: updated.connectedAt,
  updatedAt: updated.updatedAt,
};

const duplicateMailbox = await prisma.integration.findMany({
  where: {
    provider: "gmail",
    refreshToken: { not: null },
    organizationId: { not: CANONICAL_ORG },
  },
  select: { organizationId: true, metadata: true, id: true },
});

const stillBoundElsewhere = duplicateMailbox.filter((row) => {
  const email = parseMeta(row.metadata).googleAccountEmail;
  return typeof email === "string" && email.toLowerCase() === TARGET_EMAIL;
});

console.log(JSON.stringify({
  status: "rebound",
  before,
  after,
  stillBoundElsewhere: stillBoundElsewhere.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    providerAccountEmail: parseMeta(r.metadata).googleAccountEmail ?? null,
  })),
}, null, 2));

await prisma.$disconnect();
