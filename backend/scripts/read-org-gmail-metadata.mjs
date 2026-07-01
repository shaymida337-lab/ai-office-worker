/** SELECT-only: read Gmail integration metadata for one org from prod. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const orgId = process.argv[2] ?? "cmqxujfuj034ndy2czu9tjoko";
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL } },
});

function parseMetadata(metadata) {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  }
  catch {
    return {};
  }
}

const org = await prisma.organization.findUnique({
  where: { id: orgId },
  select: {
    id: true,
    name: true,
    businessName: true,
    user: { select: { email: true, name: true } },
  },
});

const integration = await prisma.integration.findUnique({
  where: { organizationId_provider: { organizationId: orgId, provider: "gmail" } },
  select: {
    id: true,
    connectedAt: true,
    updatedAt: true,
    metadata: true,
    refreshToken: true,
    accessToken: true,
    expiresAt: true,
  },
});

const meta = parseMetadata(integration?.metadata ?? null);
const mailbox = typeof meta.googleAccountEmail === "string" ? meta.googleAccountEmail.toLowerCase() : null;

console.log(
  JSON.stringify(
    {
      source: "PROD_DATABASE_URL SELECT only",
      organizationId: org?.id ?? orgId,
      organizationName: org?.businessName || org?.name || null,
      loginEmail: org?.user.email ?? null,
      integration: integration
        ? {
            id: integration.id,
            connectedAt: integration.connectedAt,
            updatedAt: integration.updatedAt,
            expiresAt: integration.expiresAt,
            hasRefreshToken: Boolean(integration.refreshToken),
            hasAccessToken: Boolean(integration.accessToken),
            metadataGoogleAccountEmail: mailbox,
            metadataEvidenceSource: mailbox
              ? "integration.metadata.googleAccountEmail (written at Gmail OAuth callback)"
              : "metadata missing googleAccountEmail — live cron verification still required",
            isShaymida337Mailbox: mailbox === "shaymida337@gmail.com",
            isLaperlaclinic120Login: org?.user.email?.toLowerCase() === "laperlaclinic120@gmail.com",
          }
        : null,
    },
    null,
    2
  )
);

await prisma.$disconnect();
