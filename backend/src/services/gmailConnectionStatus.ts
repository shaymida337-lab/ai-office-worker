import { config, hasGoogleOAuth } from "../lib/config.js";
import { errorDetails } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import {
  ensureGmailAccessToken,
  googleOAuthMetadata,
  googleOAuthScopesFromMetadata,
  missingRequiredGoogleDriveScopes,
  parseGoogleIntegrationMetadata,
} from "./google.js";

export const REQUIRED_GMAIL_CONNECTION_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export type GmailConnectionScopeSource = "metadata" | "live" | "unknown";

export type GmailConnectionStatus = {
  googleConfigured: boolean;
  connected: boolean;
  connectedAt: Date | null;
  reconnectRequired: boolean;
  missingDriveScopes: string[];
  grantedScopes: string[];
  scopeSource: GmailConnectionScopeSource;
};

export function missingRequiredGmailConnectionScopes(scopes: readonly string[] | null | undefined): string[] {
  const granted = new Set(scopes ?? []);
  return granted.has(REQUIRED_GMAIL_CONNECTION_SCOPE) ? [] : [REQUIRED_GMAIL_CONNECTION_SCOPE];
}

export function evaluateGmailReconnectRequired(input: {
  hasRefreshToken: boolean;
  refreshInvalidGrant: boolean;
  grantedScopes: readonly string[];
  scopeSource: GmailConnectionScopeSource;
}): boolean {
  if (!input.hasRefreshToken) return false;
  if (input.refreshInvalidGrant) return true;
  if (input.grantedScopes.length === 0) return false;
  return missingRequiredGmailConnectionScopes(input.grantedScopes).length > 0;
}

function isInvalidGrantError(err: unknown): boolean {
  const details = errorDetails(err);
  const haystack = [details.message, details.code, details.statusText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes("invalid_grant") || haystack.includes("invalid credentials");
}

async function resolveLiveGrantedScopes(
  organizationId: string,
  accessToken: string | null | undefined
): Promise<string[]> {
  if (!accessToken) return [];
  try {
    const { google } = await import("googleapis");
    const oauth2 = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      config.google.redirectUri
    );
    oauth2.setCredentials({ access_token: accessToken });
    const tokenInfo = await oauth2.getTokenInfo(accessToken);
    return (tokenInfo.scopes ?? []).filter(Boolean);
  } catch (err) {
    console.warn("[gmail/status] live scope introspection failed", {
      organizationId,
      ...errorDetails(err),
    });
    return [];
  }
}

export async function resolveGmailConnectionStatus(organizationId: string): Promise<GmailConnectionStatus> {
  const integration = await prisma.integration.findUnique({
    where: {
      organizationId_provider: { organizationId, provider: "gmail" },
    },
  });

  const disconnected: GmailConnectionStatus = {
    googleConfigured: hasGoogleOAuth(),
    connected: false,
    connectedAt: integration?.connectedAt ?? null,
    reconnectRequired: false,
    missingDriveScopes: [],
    grantedScopes: [],
    scopeSource: "unknown",
  };

  if (!integration?.refreshToken) {
    return disconnected;
  }

  let grantedScopes = googleOAuthScopesFromMetadata(integration.metadata);
  let scopeSource: GmailConnectionScopeSource = grantedScopes.length > 0 ? "metadata" : "unknown";
  let refreshInvalidGrant = false;
  let activeIntegration = integration;

  try {
    activeIntegration = await ensureGmailAccessToken(organizationId);
    const metadataScopes = googleOAuthScopesFromMetadata(activeIntegration.metadata);
    if (metadataScopes.length > 0) {
      grantedScopes = metadataScopes;
      scopeSource = "metadata";
    }

    if (grantedScopes.length === 0) {
      const liveScopes = await resolveLiveGrantedScopes(organizationId, activeIntegration.accessToken);
      if (liveScopes.length > 0) {
        grantedScopes = liveScopes;
        scopeSource = "live";
        const metadata = googleOAuthMetadata(activeIntegration.metadata, liveScopes.join(" "));
        await prisma.integration.update({
          where: {
            organizationId_provider: { organizationId, provider: "gmail" },
          },
          data: { metadata },
        });
      }
    }
  } catch (err) {
    refreshInvalidGrant = isInvalidGrantError(err);
    console.warn("[gmail/status] token health check failed", {
      organizationId,
      refreshInvalidGrant,
      ...errorDetails(err),
    });
  }

  const reconnectRequired = evaluateGmailReconnectRequired({
    hasRefreshToken: true,
    refreshInvalidGrant,
    grantedScopes,
    scopeSource,
  });

  return {
    googleConfigured: hasGoogleOAuth(),
    connected: true,
    connectedAt: activeIntegration.connectedAt ?? integration.connectedAt ?? null,
    reconnectRequired,
    missingDriveScopes: missingRequiredGoogleDriveScopes(grantedScopes),
    grantedScopes,
    scopeSource,
  };
}

export function googleAccountEmailFromMetadata(metadata: string | null | undefined): string | null {
  const parsed = parseGoogleIntegrationMetadata(metadata);
  const email = parsed.googleAccountEmail;
  return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
}
