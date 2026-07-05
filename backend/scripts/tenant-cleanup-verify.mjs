import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const CANONICAL_ORG = "cmpjd7j7e0001bl5tzv049rxb";
const EMAIL = "shaymida337@gmail.com";

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

const org = await prisma.organization.findUnique({
  where: { id: CANONICAL_ORG },
  select: { id: true, name: true, businessName: true },
});

const integrations = await prisma.integration.findMany({
  where: { organizationId: CANONICAL_ORG },
  select: { id: true, provider: true, refreshToken: true, metadata: true, connectedAt: true },
  orderBy: { provider: "asc" },
});

const gmail = integrations.find((i) => i.provider === "gmail") ?? null;

const duplicateGmail = await prisma.integration.findMany({
  where: { provider: "gmail", refreshToken: { not: null } },
  select: { organizationId: true, metadata: true, id: true },
});

const emailElsewhere = duplicateGmail.filter((row) => {
  if (row.organizationId === CANONICAL_ORG) return false;
  const email = parseMeta(row.metadata).googleAccountEmail;
  return typeof email === "string" && email.toLowerCase() === EMAIL;
});

const assistant = await prisma.$queryRawUnsafe(
  'SELECT "organizationId","ownerPhone","isActive" FROM "WhatsAppAssistant" WHERE "ownerPhone" = $1 LIMIT 1',
  "whatsapp:+972544427244"
);

console.log(JSON.stringify({
  organization: org,
  integrations: integrations.map((i) => ({
    id: i.id,
    provider: i.provider,
    refreshTokenExists: Boolean(i.refreshToken),
    providerAccountEmail: i.provider === "gmail" ? parseMeta(i.metadata).googleAccountEmail ?? null : undefined,
    connectedAt: i.connectedAt,
  })),
  gmailOnCanonical: Boolean(gmail),
  gmailEmail: gmail ? parseMeta(gmail.metadata).googleAccountEmail ?? null : null,
  gmailRefreshTokenExists: Boolean(gmail?.refreshToken),
  duplicateEmailElsewhere: emailElsewhere.map((r) => ({ id: r.id, organizationId: r.organizationId })),
  whatsappAssistant: assistant,
}, null, 2));

await prisma.$disconnect();
