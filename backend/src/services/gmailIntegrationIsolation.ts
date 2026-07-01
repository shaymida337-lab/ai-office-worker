import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma.js";

function parseIntegrationMetadata(metadata: string | null | undefined): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class GmailIntegrationIsolationError extends Error {
  readonly code = "GMAIL_INTEGRATION_ISOLATION_VIOLATION" as const;
  readonly organizationId: string;
  readonly details: Record<string, unknown>;

  constructor(message: string, organizationId: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "GmailIntegrationIsolationError";
    this.organizationId = organizationId;
    this.details = details;
  }
}

export function hashGmailRefreshToken(refreshToken: string): string {
  return createHash("sha256").update(refreshToken, "utf8").digest("hex");
}

export function assertIntegrationBelongsToOrganization(
  integration: { organizationId: string },
  organizationId: string
): void {
  if (integration.organizationId !== organizationId) {
    throw new GmailIntegrationIsolationError(
      `Gmail integration organization mismatch: expected ${organizationId}, got ${integration.organizationId}`,
      organizationId,
      { integrationOrganizationId: integration.organizationId }
    );
  }
}

export async function findGmailIntegrationForOrganization(organizationId: string) {
  return prisma.integration.findUnique({
    where: {
      organizationId_provider: { organizationId, provider: "gmail" },
    },
  });
}

export async function findOrganizationsSharingRefreshToken(
  refreshToken: string,
  options: { excludeOrganizationId?: string } = {}
): Promise<Array<{ organizationId: string; integrationId: string }>> {
  const hash = hashGmailRefreshToken(refreshToken);
  const integrations = await prisma.integration.findMany({
    where: {
      provider: "gmail",
      refreshToken: { not: null },
      ...(options.excludeOrganizationId
        ? { organizationId: { not: options.excludeOrganizationId } }
        : {}),
    },
    select: { id: true, organizationId: true, refreshToken: true },
  });

  return integrations
    .filter((integration) => integration.refreshToken && hashGmailRefreshToken(integration.refreshToken) === hash)
    .map((integration) => ({
      organizationId: integration.organizationId,
      integrationId: integration.id,
    }));
}

export async function assertGmailRefreshTokenNotShared(
  organizationId: string,
  refreshToken: string
): Promise<void> {
  const hash = hashGmailRefreshToken(refreshToken);
  const integrations = await prisma.integration.findMany({
    where: {
      provider: "gmail",
      refreshToken: { not: null },
    },
    select: { id: true, organizationId: true, refreshToken: true },
  });

  const matching = integrations.filter(
    (integration) => integration.refreshToken && hashGmailRefreshToken(integration.refreshToken) === hash
  );

  if (matching.length <= 1) {
    return;
  }

  const sharedOrganizationIds = matching.map((integration) => integration.organizationId);
  const otherOrganizationIds = sharedOrganizationIds.filter((id) => id !== organizationId);

  console.error(
    `[gmail-isolation] shared refresh token detected org=${organizationId} sharedOrgs=${sharedOrganizationIds.join(",")}`
  );

  throw new GmailIntegrationIsolationError(
    `Gmail refresh token is shared across ${matching.length} organizations; aborting to prevent cross-org ingestion`,
    organizationId,
    { sharedOrganizationIds, otherOrganizationIds }
  );
}

export async function assertGmailIntegrationIsolatedForScan(organizationId: string) {
  const integration = await findGmailIntegrationForOrganization(organizationId);
  if (!integration?.refreshToken) {
    throw new Error("Gmail not connected");
  }

  assertIntegrationBelongsToOrganization(integration, organizationId);
  await assertGmailRefreshTokenNotShared(organizationId, integration.refreshToken);
  return integration;
}

export async function assertGmailConnectedAccountNotShared(
  organizationId: string,
  googleAccountEmail: string
): Promise<void> {
  const normalized = googleAccountEmail.trim().toLowerCase();
  if (!normalized) {
    return;
  }

  const integrations = await prisma.integration.findMany({
    where: {
      provider: "gmail",
      organizationId: { not: organizationId },
      refreshToken: { not: null },
    },
    select: { organizationId: true, metadata: true },
  });

  const conflicts = integrations.filter((integration) => {
    const storedEmail = parseIntegrationMetadata(integration.metadata).googleAccountEmail;
    return typeof storedEmail === "string" && storedEmail.toLowerCase() === normalized;
  });

  if (conflicts.length === 0) {
    return;
  }

  const otherOrganizationIds = conflicts.map((integration) => integration.organizationId);
  console.error(
    `[gmail-isolation] shared Gmail mailbox detected org=${organizationId} mailbox=${normalized} otherOrgs=${otherOrganizationIds.join(",")}`
  );

  throw new GmailIntegrationIsolationError(
    `Gmail mailbox ${normalized} is already connected to another organization`,
    organizationId,
    { googleAccountEmail: normalized, otherOrganizationIds }
  );
}

export async function assertRefreshTokenCanBindToOrganization(
  organizationId: string,
  refreshToken: string
): Promise<void> {
  const duplicates = await findOrganizationsSharingRefreshToken(refreshToken, {
    excludeOrganizationId: organizationId,
  });
  if (duplicates.length === 0) {
    return;
  }

  const otherOrganizationIds = duplicates.map((row) => row.organizationId);
  console.error(
    `[gmail-isolation] OAuth bind rejected org=${organizationId} tokenAlreadyBoundTo=${otherOrganizationIds.join(",")}`
  );

  throw new GmailIntegrationIsolationError(
    "Gmail refresh token is already bound to another organization",
    organizationId,
    { otherOrganizationIds }
  );
}
