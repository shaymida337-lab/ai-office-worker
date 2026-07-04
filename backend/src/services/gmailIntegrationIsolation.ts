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

/**
 * הלוגיקה הטהורה של שער-הטוקן: אילו שורות Integration מתנגשות עם הטוקן הנכנס.
 * ערך נכנס ריק לעולם אינו "משותף" (הקשחה); שורות עם טוקן ריק לעולם אינן חוסמות.
 * מחולץ כפונקציה טהורה כדי ש-fix-gmail-connection.ts יסמלץ את השער בדיוק.
 */
export function collectRefreshTokenConflicts(
  rows: Array<{ id: string; organizationId: string; refreshToken: string | null }>,
  refreshToken: string | null | undefined,
  options: { excludeOrganizationId?: string } = {}
): Array<{ organizationId: string; integrationId: string }> {
  if (!refreshToken || !refreshToken.trim()) return [];
  const hash = hashGmailRefreshToken(refreshToken);
  return rows
    .filter(
      (row) =>
        (!options.excludeOrganizationId || row.organizationId !== options.excludeOrganizationId) &&
        Boolean(row.refreshToken) &&
        hashGmailRefreshToken(row.refreshToken!) === hash
    )
    .map((row) => ({ organizationId: row.organizationId, integrationId: row.id }));
}

/**
 * הלוגיקה הטהורה של שער-התיבה: אילו שורות מחזיקות את אותו חשבון Gmail.
 * אימייל נכנס ריק או אימייל שמור ריק — לעולם לא חוסמים (זהה להתנהגות המקורית).
 */
export function collectMailboxConflicts(
  rows: Array<{ organizationId: string; metadata: string | null; refreshToken?: string | null }>,
  googleAccountEmail: string | null | undefined,
  excludeOrganizationId?: string
): string[] {
  const normalized = (googleAccountEmail ?? "").trim().toLowerCase();
  if (!normalized) return [];
  return rows
    .filter((row) => {
      if (excludeOrganizationId && row.organizationId === excludeOrganizationId) return false;
      if (row.refreshToken !== undefined && !row.refreshToken) return false;
      const storedEmail = parseIntegrationMetadata(row.metadata).googleAccountEmail;
      return typeof storedEmail === "string" && storedEmail.toLowerCase() === normalized;
    })
    .map((row) => row.organizationId);
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

  return collectRefreshTokenConflicts(integrations, refreshToken, options);
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

  const otherOrganizationIds = collectMailboxConflicts(integrations, normalized);

  if (otherOrganizationIds.length === 0) {
    return;
  }
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
