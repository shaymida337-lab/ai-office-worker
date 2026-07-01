import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { hashGmailRefreshToken } from "./gmailIntegrationIsolation.js";

function parseIntegrationMetadata(metadata: string | null | undefined): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function redirectUriCandidates(): string[] {
  return [
    config.google.integrationRedirectUri,
    config.google.redirectUri,
    "https://ai-office-worker-backend.onrender.com/api/integrations/gmail/callback",
    "https://ai-office-worker-backend.onrender.com/auth/google/callback",
  ].filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);
}

export type GmailMailboxVerificationRow = {
  organizationId: string;
  organizationName: string;
  loginEmail: string;
  loginName: string | null;
  integrationId: string;
  connectedAt: Date;
  metadataGoogleAccountEmail: string | null;
  actualConnectedGmailMailbox: string | null;
  googleUserId: string | null;
  profileName: string | null;
  verifiedEmailFlag: boolean | null;
  evidenceSource: string;
  redirectUriUsed: string | null;
  profileFetchOk: boolean;
  profileFetchError: string | null;
  refreshTokenHash: string;
  loginMatchesMailbox: boolean;
  metadataMatchesLiveProfile: boolean | null;
};

async function fetchMailboxProfileReadOnly(refreshToken: string) {
  const { google } = await import("googleapis");
  let lastError = "no redirect URI succeeded";

  for (const redirectUri of redirectUriCandidates()) {
    const oauth2 = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      redirectUri
    );
    oauth2.setCredentials({ refresh_token: refreshToken });

    try {
      const { credentials } = await oauth2.refreshAccessToken();
      oauth2.setCredentials(credentials);
      const oauth2api = google.oauth2({ version: "v2", auth: oauth2 });
      const profile = await oauth2api.userinfo.get();
      return {
        ok: true as const,
        mailboxEmail: profile.data.email?.trim().toLowerCase() ?? null,
        googleUserId: profile.data.id ?? null,
        verifiedEmail: profile.data.verified_email ?? null,
        profileName: profile.data.name ?? null,
        evidenceSource: `google.oauth2.userinfo.get via redirect=${redirectUri}`,
        redirectUriUsed: redirectUri,
        error: null,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    ok: false as const,
    mailboxEmail: null,
    googleUserId: null,
    verifiedEmail: null,
    profileName: null,
    evidenceSource: "google.oauth2.userinfo.get (all redirect URIs failed)",
    redirectUriUsed: null,
    error: lastError,
  };
}

export async function verifyAllGmailMailboxesReadOnly(): Promise<{
  rows: GmailMailboxVerificationRow[];
  sharedRefreshTokenHashes: Array<{ refreshTokenHash: string; organizationIds: string[] }>;
  sharedMailboxEmails: Array<{ mailboxEmail: string; organizationIds: string[] }>;
}> {
  const integrations = await prisma.integration.findMany({
    where: { provider: "gmail", refreshToken: { not: null } },
    select: {
      id: true,
      organizationId: true,
      refreshToken: true,
      connectedAt: true,
      metadata: true,
      organization: {
        select: {
          name: true,
          businessName: true,
          user: { select: { email: true, name: true } },
        },
      },
    },
    orderBy: { connectedAt: "asc" },
  });

  const rows: GmailMailboxVerificationRow[] = [];
  const hashGroups = new Map<string, string[]>();
  const mailboxGroups = new Map<string, string[]>();

  for (const integration of integrations) {
    if (!integration.refreshToken) continue;

    const meta = parseIntegrationMetadata(integration.metadata);
    const refreshTokenHash = hashGmailRefreshToken(integration.refreshToken);
    const profile = await fetchMailboxProfileReadOnly(integration.refreshToken);
    const loginEmail = integration.organization.user.email.trim().toLowerCase();
    const metadataEmail =
      typeof meta.googleAccountEmail === "string" ? meta.googleAccountEmail.toLowerCase() : null;

    rows.push({
      organizationId: integration.organizationId,
      organizationName: integration.organization.businessName || integration.organization.name,
      loginEmail: integration.organization.user.email,
      loginName: integration.organization.user.name,
      integrationId: integration.id,
      connectedAt: integration.connectedAt,
      metadataGoogleAccountEmail: metadataEmail,
      actualConnectedGmailMailbox: profile.mailboxEmail,
      googleUserId: profile.googleUserId,
      profileName: profile.profileName,
      verifiedEmailFlag: profile.verifiedEmail ?? null,
      evidenceSource: profile.evidenceSource,
      redirectUriUsed: profile.redirectUriUsed,
      profileFetchOk: profile.ok,
      profileFetchError: profile.error,
      refreshTokenHash,
      loginMatchesMailbox: profile.mailboxEmail != null && profile.mailboxEmail === loginEmail,
      metadataMatchesLiveProfile:
        profile.mailboxEmail != null && metadataEmail != null ? metadataEmail === profile.mailboxEmail : null,
    });

    if (!hashGroups.has(refreshTokenHash)) hashGroups.set(refreshTokenHash, []);
    hashGroups.get(refreshTokenHash)!.push(integration.organizationId);

    if (profile.mailboxEmail) {
      if (!mailboxGroups.has(profile.mailboxEmail)) mailboxGroups.set(profile.mailboxEmail, []);
      mailboxGroups.get(profile.mailboxEmail)!.push(integration.organizationId);
    }
  }

  return {
    rows,
    sharedRefreshTokenHashes: [...hashGroups.entries()]
      .filter(([, orgIds]) => orgIds.length > 1)
      .map(([refreshTokenHash, organizationIds]) => ({ refreshTokenHash, organizationIds })),
    sharedMailboxEmails: [...mailboxGroups.entries()]
      .filter(([, orgIds]) => orgIds.length > 1)
      .map(([mailboxEmail, organizationIds]) => ({ mailboxEmail, organizationIds })),
  };
}

export const CONTAMINATED_CLUSTER_ORG_IDS = [
  "cmpjd7j7e0001bl5tzv049rxb",
  "cmqve9z5j05r1kr29ivi3dyuj",
  "cmqw27e43002bm92bmf9mjy1n",
  "cmqxujfuj034ndy2czu9tjoko",
] as const;

export function proposeCanonicalMailboxMapping(
  verification: Awaited<ReturnType<typeof verifyAllGmailMailboxesReadOnly>>
) {
  const clusterRows = verification.rows.filter((row) =>
    CONTAMINATED_CLUSTER_ORG_IDS.includes(row.organizationId as (typeof CONTAMINATED_CLUSTER_ORG_IDS)[number])
  );

  const unverified = clusterRows.filter((row) => !row.profileFetchOk);
  const proposals: Array<{
    mailboxEmail: string;
    proposedCanonicalOrganizationId: string;
    proposedCanonicalLoginEmail: string;
    organizationsWithMailbox: Array<{
      organizationId: string;
      loginEmail: string;
      connectedAt: Date;
      refreshTokenHash: string;
    }>;
    proposalRule: string;
    approvalStatus: "PENDING_HUMAN_APPROVAL";
  }> = [];

  const mailboxToRows = new Map<string, typeof clusterRows>();
  for (const row of clusterRows) {
    if (!row.actualConnectedGmailMailbox) continue;
    const key = row.actualConnectedGmailMailbox;
    if (!mailboxToRows.has(key)) mailboxToRows.set(key, []);
    mailboxToRows.get(key)!.push(row);
  }

  for (const [mailboxEmail, orgRows] of mailboxToRows.entries()) {
    const sorted = [...orgRows].sort(
      (a, b) => new Date(a.connectedAt).getTime() - new Date(b.connectedAt).getTime()
    );
    const recommended = sorted[0]!;
    proposals.push({
      mailboxEmail,
      proposedCanonicalOrganizationId: recommended.organizationId,
      proposedCanonicalLoginEmail: recommended.loginEmail,
      organizationsWithMailbox: sorted.map((row) => ({
        organizationId: row.organizationId,
        loginEmail: row.loginEmail,
        connectedAt: row.connectedAt,
        refreshTokenHash: row.refreshTokenHash,
      })),
      proposalRule:
        sorted.length === 1
          ? "sole verified mailbox binding in contaminated cluster"
          : "earliest connectedAt among orgs sharing verified mailbox in contaminated cluster",
      approvalStatus: "PENDING_HUMAN_APPROVAL",
    });
  }

  return {
    canDesignateCanonical: unverified.length === 0 && proposals.length > 0,
    blockedReason:
      unverified.length > 0
        ? `${unverified.length} contaminated-cluster integration(s) failed live profile fetch`
        : proposals.length === 0
          ? "No verified mailbox mapping available for contaminated cluster"
          : null,
    unverifiedClusterOrganizationIds: unverified.map((row) => row.organizationId),
    proposals,
    prematureCandidateRejected: {
      organizationId: "cmpjd7j7e0001bl5tzv049rxb",
      reason: "Not approved as canonical until all cluster mailboxes are live-verified",
    },
  };
}
