import { Router, type Response } from "express";
import jwt from "jsonwebtoken";
import { authMiddleware, verifyToken } from "../lib/auth.js";
import { config, hasGoogleOAuth } from "../lib/config.js";
import { errorDetails, publicErrorMessage } from "../lib/errors.js";
import {
  normalizeOAuthReturnTo,
  oauthIntegrationRedirect,
  type OAuthReturnTarget,
} from "../lib/oauthReturn.js";
import { prisma } from "../lib/prisma.js";
import {
  CALENDAR_SCOPES,
  getOAuth2Client,
  GMAIL_SCOPES,
  googleOAuthMetadata,
  googleOAuthScopesFromMetadata,
  missingRequiredGoogleDriveScopes,
} from "../services/google.js";

export const integrationsRouter = Router();
const GMAIL_OAUTH_STATE_COOKIE = "gmail_oauth_state";
const CALENDAR_OAUTH_STATE_COOKIE = "calendar_oauth_state";
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

function tokenFromRequest(req: {
  headers: { authorization?: string };
  query?: Record<string, unknown>;
}): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return typeof req.query?.token === "string" ? req.query.token : null;
}

function gmailAuthUrl(state?: string) {
  return getOAuth2Client(config.google.integrationRedirectUri).then((oauth2) =>
    oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: GMAIL_SCOPES,
      state,
    })
  );
}

function calendarAuthUrl(state?: string) {
  return getOAuth2Client(config.google.calendarRedirectUri).then((oauth2) =>
    oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: CALENDAR_SCOPES,
      state,
    })
  );
}

function cookieValue(header: string | undefined, name: string) {
  if (!header) return null;
  const cookies = header.split(";").map((entry) => entry.trim());
  const match = cookies.find((entry) => entry.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function setGmailStateCookie(res: Response, state: string) {
  res.cookie(GMAIL_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    maxAge: OAUTH_STATE_MAX_AGE_MS,
    path: "/api/integrations/gmail",
  });
}

function clearGmailStateCookie(res: Response) {
  res.clearCookie(GMAIL_OAUTH_STATE_COOKIE, {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    path: "/api/integrations/gmail",
  });
}

function setCalendarStateCookie(res: Response, state: string) {
  res.cookie(CALENDAR_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    maxAge: OAUTH_STATE_MAX_AGE_MS,
    path: "/api/integrations/calendar",
  });
}

function clearCalendarStateCookie(res: Response) {
  res.clearCookie(CALENDAR_OAUTH_STATE_COOKIE, {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    path: "/api/integrations/calendar",
  });
}

function gmailCallbackErrorRedirect(err: unknown, returnTo?: unknown) {
  const reason = publicErrorMessage(err).slice(0, 500);
  return oauthIntegrationRedirect("gmail", "error", returnTo, reason);
}

function calendarCallbackErrorRedirect(err: unknown, returnTo?: unknown) {
  const reason = publicErrorMessage(err).slice(0, 500);
  return oauthIntegrationRedirect("calendar", "error", returnTo, reason);
}

function shortValue(value: string | undefined | null) {
  if (!value) return "none";
  return `${value.slice(0, 12)}...len=${value.length}`;
}

function tokenTrace(tokens: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  token_type?: string | null;
  scope?: string | null;
  id_token?: string | null;
}) {
  return {
    hasAccessToken: Boolean(tokens.access_token),
    accessToken: shortValue(tokens.access_token),
    hasRefreshToken: Boolean(tokens.refresh_token),
    refreshToken: shortValue(tokens.refresh_token),
    expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    tokenType: tokens.token_type ?? null,
    scope: tokens.scope ?? null,
    hasIdToken: Boolean(tokens.id_token),
  };
}

type GmailIntegrationState = {
  purpose: "gmail_integration";
  userId: string;
  organizationId: string;
  email: string;
  timestamp: number;
  returnTo?: OAuthReturnTarget;
};

type CalendarIntegrationState = {
  purpose: "calendar_integration";
  userId: string;
  organizationId: string;
  email: string;
  timestamp: number;
  returnTo?: OAuthReturnTarget;
};

async function findGmailIntegrationForAuth(auth: {
  userId: string;
  organizationId: string;
  email: string;
}) {
  const current = await prisma.integration.findUnique({
    where: {
      organizationId_provider: {
        organizationId: auth.organizationId,
        provider: "gmail",
      },
    },
  });
  if (current?.refreshToken || current?.accessToken) {
    return current;
  }

  const matchingUserIntegration = await prisma.integration.findFirst({
    where: {
      provider: "gmail",
      OR: [
        { organization: { userId: auth.userId } },
        { organization: { user: { email: auth.email } } },
      ],
      refreshToken: { not: null },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!matchingUserIntegration || matchingUserIntegration.organizationId === auth.organizationId) {
    return current;
  }

  console.warn(
    `[gmail/status] moving Gmail integration from org=${matchingUserIntegration.organizationId} to current org=${auth.organizationId} user=${auth.userId} email=${auth.email}`
  );

  const moved = await prisma.integration.upsert({
    where: {
      organizationId_provider: {
        organizationId: auth.organizationId,
        provider: "gmail",
      },
    },
    create: {
      organizationId: auth.organizationId,
      provider: "gmail",
      accessToken: matchingUserIntegration.accessToken,
      refreshToken: matchingUserIntegration.refreshToken,
      expiresAt: matchingUserIntegration.expiresAt,
      metadata: matchingUserIntegration.metadata,
      connectedAt: matchingUserIntegration.connectedAt,
    },
    update: {
      accessToken: matchingUserIntegration.accessToken,
      refreshToken: matchingUserIntegration.refreshToken,
      expiresAt: matchingUserIntegration.expiresAt,
      metadata: matchingUserIntegration.metadata,
    },
  });

  await prisma.integration.deleteMany({
    where: {
      id: matchingUserIntegration.id,
      organizationId: { not: auth.organizationId },
      provider: "gmail",
    },
  });

  return moved;
}

function signGmailIntegrationState(
  auth: {
    userId: string;
    organizationId: string;
    email: string;
  },
  returnTo?: OAuthReturnTarget | null
) {
  return jwt.sign({
    purpose: "gmail_integration",
    userId: auth.userId,
    organizationId: auth.organizationId,
    email: auth.email,
    timestamp: Date.now(),
    ...(returnTo ? { returnTo } : {}),
  } satisfies GmailIntegrationState, config.jwtSecret, { expiresIn: "10m" });
}

function signCalendarIntegrationState(
  auth: {
    userId: string;
    organizationId: string;
    email: string;
  },
  returnTo?: OAuthReturnTarget | null
) {
  return jwt.sign({
    purpose: "calendar_integration",
    userId: auth.userId,
    organizationId: auth.organizationId,
    email: auth.email,
    timestamp: Date.now(),
    ...(returnTo ? { returnTo } : {}),
  } satisfies CalendarIntegrationState, config.jwtSecret, { expiresIn: "10m" });
}

function googleCalendarIntegrationMetadata(
  existingMetadata: string | null | undefined,
  grantedScopeString: string | null | undefined
) {
  const metadata = JSON.parse(googleOAuthMetadata(existingMetadata, grantedScopeString));
  return JSON.stringify({
    ...metadata,
    calendarId: "primary",
  });
}

function calendarIdFromMetadata(metadata: string | null | undefined) {
  if (!metadata) return undefined;
  try {
    const parsed = JSON.parse(metadata) as { calendarId?: unknown };
    return typeof parsed.calendarId === "string" ? parsed.calendarId : undefined;
  } catch {
    return undefined;
  }
}

function runPostConnectionGmailScan(organizationId: string) {
  void import("../services/gmail-sync.js")
    .then(({ syncGmailForOrganization }) =>
      syncGmailForOrganization(organizationId, { isFirstTime: true, forceReprocess: false })
    )
    .then((result) => {
      console.log(
        `[gmail/connect] post-connection scan finished org=${organizationId} emails=${result.emailsProcessed} relevant=${result.relevantEmailsFound ?? result.invoiceEmails ?? 0} records=${result.recordsSaved ?? 0} duplicates=${result.duplicatesSkipped ?? 0} errors=${result.errorsCount ?? 0}`
      );
    })
    .catch((err) => {
      console.error(`[gmail/connect] post-connection scan failed org=${organizationId}`, err);
    });
}

integrationsRouter.get("/gmail/status", authMiddleware, async (req, res) => {
  const integration = await findGmailIntegrationForAuth(req.auth!);
  const grantedScopes = googleOAuthScopesFromMetadata(integration?.metadata);
  const missingDriveScopes = missingRequiredGoogleDriveScopes(grantedScopes);
  const reconnectRequired = Boolean(integration?.refreshToken) && (grantedScopes.length === 0 || missingDriveScopes.length > 0);
  console.log(
    `[gmail/status] user=${req.auth!.userId} org=${req.auth!.organizationId} connected=${Boolean(integration?.refreshToken)} integrationOrg=${integration?.organizationId ?? "none"} hasAccessToken=${Boolean(integration?.accessToken)} hasRefreshToken=${Boolean(integration?.refreshToken)} connectedAt=${integration?.connectedAt?.toISOString() ?? "none"} reconnectRequired=${reconnectRequired} missingDriveScopes="${missingDriveScopes.join(" ")}"`
  );

  res.json({
    googleConfigured: hasGoogleOAuth(),
    connected: Boolean(integration?.refreshToken),
    connectedAt: integration?.connectedAt ?? null,
    reconnectRequired,
    missingDriveScopes,
  });
});

integrationsRouter.delete("/gmail", authMiddleware, async (req, res) => {
  await prisma.integration.deleteMany({
    where: {
      organizationId: req.auth!.organizationId,
      provider: "gmail",
    },
  });
  res.json({ ok: true });
});

integrationsRouter.get("/gmail/connect-url", authMiddleware, async (req, res) => {
  try {
    if (!hasGoogleOAuth()) {
      const missing = [
        !config.google.clientId && "GOOGLE_CLIENT_ID",
        !config.google.clientSecret && "GOOGLE_CLIENT_SECRET",
      ].filter(Boolean);
      const message = `Google OAuth is not configured. Missing: ${missing.join(", ")}`;
      console.error("Gmail connect error:", message);
      res.status(503).json({ error: message });
      return;
    }

    const returnTo = normalizeOAuthReturnTo(req.query.returnTo);
    const state = signGmailIntegrationState(req.auth!, returnTo);
    const url = await gmailAuthUrl(state);
    setGmailStateCookie(res, state);
    console.log(
      `[gmail/connect-url] user=${req.auth!.userId} org=${req.auth!.organizationId} returnTo=${returnTo ?? "default"} clientId=${config.google.clientId} secretConfigured=${Boolean(config.google.clientSecret)} redirectUri=${config.google.integrationRedirectUri} state=${state}`
    );
    res.json({ url });
  } catch (error) {
    console.error("Gmail connect error:", errorDetails(error));
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

integrationsRouter.get("/gmail/connect", async (req, res) => {
  if (!hasGoogleOAuth()) {
    res.status(503).send("Google OAuth is not configured");
    return;
  }

  const token = tokenFromRequest(req);
  if (!token) {
    res.status(401).send("Missing user token");
    return;
  }

  try {
    const auth = verifyToken(token);
    const returnTo = normalizeOAuthReturnTo(req.query.returnTo);
    const state = signGmailIntegrationState(auth, returnTo);
    setGmailStateCookie(res, state);
    console.log(
      `[gmail/connect] user=${auth.userId} org=${auth.organizationId} returnTo=${returnTo ?? "default"} clientId=${config.google.clientId} secretConfigured=${Boolean(config.google.clientSecret)} redirectUri=${config.google.integrationRedirectUri} state=${state}`
    );
    res.redirect(await gmailAuthUrl(state));
  } catch {
    res.status(401).send("Invalid user token");
    return;
  }
});

integrationsRouter.get("/gmail/callback", async (req, res) => {
  const hasCode = Boolean(req.query.code);
  const hasState = Boolean(req.query.state);
  const traceId = `gmail-callback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const cookieState = cookieValue(req.headers.cookie, GMAIL_OAUTH_STATE_COOKIE);
    console.log(
      `[gmail/callback][${traceId}] start hasCode=${hasCode} code=${shortValue(code)} hasState=${hasState} state=${state ?? "none"} cookieState=${cookieState ?? "none"} cookieMatches=${Boolean(state && cookieState && state === cookieState)} redirectUri=${config.google.integrationRedirectUri} clientId=${config.google.clientId} secretConfigured=${Boolean(config.google.clientSecret)}`
    );

    if (!code) {
      res.status(400).send("Missing Google OAuth code");
      return;
    }

    let organizationId: string;
    let decodedState: (Partial<GmailIntegrationState> & { organizationId?: string }) | null = null;
    if (state) {
      decodedState = jwt.verify(state, config.jwtSecret) as Partial<GmailIntegrationState> & { organizationId?: string };
      console.log(
        `[gmail/callback][${traceId}] decodedState purpose=${decodedState.purpose ?? "none"} userId=${decodedState.userId ?? "none"} email=${decodedState.email ?? "none"} organizationId=${decodedState.organizationId ?? "none"} timestamp=${decodedState.timestamp ?? "none"}`
      );
      if (decodedState.purpose && decodedState.purpose !== "gmail_integration") {
        res.redirect(oauthIntegrationRedirect("gmail", "invalid_state", decodedState.returnTo));
        return;
      }
      if (!decodedState.organizationId) {
        res.redirect(oauthIntegrationRedirect("gmail", "invalid_state", decodedState.returnTo));
        return;
      }
      organizationId = decodedState.organizationId;
    } else {
      res.redirect(oauthIntegrationRedirect("gmail", "invalid_state", null));
      return;
    }

    console.log(`[gmail/callback][${traceId}] resolved userId=${decodedState?.userId ?? "none"} orgId=${organizationId} email=${decodedState?.email ?? "none"}`);
    const existingIntegration = await prisma.integration.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: "gmail",
        },
      },
    });
    console.log(
      `[gmail/callback][${traceId}] integration lookup org=${organizationId} found=${Boolean(existingIntegration)} hasAccessToken=${Boolean(existingIntegration?.accessToken)} hasRefreshToken=${Boolean(existingIntegration?.refreshToken)} connectedAt=${existingIntegration?.connectedAt?.toISOString() ?? "none"}`
    );
    const oauth2 = await getOAuth2Client(config.google.integrationRedirectUri);
    let tokens: {
      access_token?: string | null;
      refresh_token?: string | null;
      expiry_date?: number | null;
      token_type?: string | null;
      scope?: string;
      id_token?: string | null;
    };
    try {
      console.log(`[gmail/callback][${traceId}] exchanging code with Google redirectUri=${config.google.integrationRedirectUri}`);
      const tokenResult = await oauth2.getToken(code);
      tokens = tokenResult.tokens;
      oauth2.setCredentials(tokens);
      console.log(`[gmail/callback][${traceId}] exchanged tokens ${JSON.stringify(tokenTrace(tokens))}`);
    } catch (err) {
      console.error(`[gmail/callback][${traceId}] token exchange failed`, errorDetails(err));
      const isInvalidGrant =
        err instanceof Error && err.message.toLowerCase().includes("invalid_grant");
      if (isInvalidGrant && existingIntegration?.refreshToken) {
        console.log(
          `[gmail/callback][${traceId}] invalid_grant after existing refreshToken org=${organizationId}; likely duplicate callback/code replay, returning connected state=${state ?? "none"}`
        );
        clearGmailStateCookie(res);
        res.redirect(oauthIntegrationRedirect("gmail", "connected", decodedState?.returnTo));
        return;
      }
      throw err;
    }

    try {
      const oauth2api = await import("googleapis").then((g) =>
        g.google.oauth2({ version: "v2", auth: oauth2 })
      );
      const profile = await oauth2api.userinfo.get();
      console.log(
        `[gmail/callback][${traceId}] decoded Google profile id=${profile.data.id ?? "none"} email=${profile.data.email ?? "none"} verified=${profile.data.verified_email ?? "unknown"} name=${profile.data.name ?? "none"}`
      );
    } catch (profileErr) {
      console.error(`[gmail/callback][${traceId}] Google profile fetch failed`, errorDetails(profileErr));
    }

    if (!tokens.refresh_token && !existingIntegration?.refreshToken) {
      console.error(`[gmail/callback][${traceId}] missing refresh token and no existing refresh token org=${organizationId}`);
      res
        .status(400)
        .send("Google did not return a refresh token. Reconnect and approve access.");
      return;
    }

    const refreshToken = tokens.refresh_token ?? existingIntegration?.refreshToken;
    if (!refreshToken) {
      console.error(`[gmail/callback][${traceId}] refreshToken resolved null org=${organizationId}`);
      res
        .status(400)
        .send("Google did not return a refresh token. Reconnect and approve access.");
      return;
    }

    console.log(
      `[gmail/callback][${traceId}] integration upsert start org=${organizationId} provider=gmail hasAccessToken=${Boolean(tokens.access_token)} hasRefreshToken=${Boolean(refreshToken)}`
    );
    const metadata = googleOAuthMetadata(existingIntegration?.metadata, tokens.scope ?? null);
    const savedIntegration = await prisma.$transaction(async (tx) => {
      const saved = await tx.integration.upsert({
        where: {
          organizationId_provider: {
            organizationId,
            provider: "gmail",
          },
        },
        create: {
          organizationId,
          provider: "gmail",
          accessToken: tokens.access_token ?? null,
          refreshToken,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          metadata,
          connectedAt: new Date(),
        },
        update: {
          accessToken: tokens.access_token ?? null,
          refreshToken,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          metadata,
          connectedAt: new Date(),
        },
      });
      const verified = await tx.integration.findUnique({
        where: {
          organizationId_provider: {
            organizationId,
            provider: "gmail",
          },
        },
      });
      console.log(
        `[gmail/callback][${traceId}] integration transaction verify found=${Boolean(verified)} id=${verified?.id ?? "none"} org=${verified?.organizationId ?? "none"} provider=${verified?.provider ?? "none"} hasAccessToken=${Boolean(verified?.accessToken)} hasRefreshToken=${Boolean(verified?.refreshToken)} connectedAt=${verified?.connectedAt?.toISOString() ?? "none"}`
      );
      if (!verified?.refreshToken) {
        throw new Error("Gmail integration verification failed after save: refreshToken missing");
      }
      return saved;
    });

    const persistedIntegration = await prisma.integration.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: "gmail",
        },
      },
    });

    console.log(
      `[gmail/callback][${traceId}] connected stateUser=${decodedState?.userId ?? "none"} stateEmail=${decodedState?.email ?? "none"} stateOrg=${organizationId} savedOrg=${savedIntegration.organizationId} persistedOrg=${persistedIntegration?.organizationId ?? "none"} provider=${savedIntegration.provider} hasAccessToken=${Boolean(persistedIntegration?.accessToken)} hasRefreshToken=${Boolean(persistedIntegration?.refreshToken)} connectedAt=${persistedIntegration?.connectedAt.toISOString() ?? "none"} expiresAt=${persistedIntegration?.expiresAt?.toISOString() ?? "none"}`
    );
    runPostConnectionGmailScan(organizationId);

    clearGmailStateCookie(res);
    console.log(
      `[gmail/callback][${traceId}] redirect returnTo=${decodedState?.returnTo ?? "default"} org=${organizationId}`
    );
    res.redirect(oauthIntegrationRedirect("gmail", "connected", decodedState?.returnTo));
  } catch (err) {
    console.error(`[gmail/callback][${traceId}] failed`, errorDetails(err));
    const failedReturnTo =
      typeof req.query.state === "string"
        ? (jwt.decode(req.query.state) as Partial<GmailIntegrationState> | null)?.returnTo
        : undefined;
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      res.redirect(oauthIntegrationRedirect("gmail", "invalid_state", failedReturnTo));
      return;
    }
    res.redirect(gmailCallbackErrorRedirect(err, failedReturnTo));
  }
});

integrationsRouter.get("/calendar/status", authMiddleware, async (req, res) => {
  const integration = await prisma.integration.findUnique({
    where: {
      organizationId_provider: {
        organizationId: req.auth!.organizationId,
        provider: "google_calendar",
      },
    },
  });
  const connected = Boolean(integration?.refreshToken);
  res.json({
    connected,
    calendarId: connected ? calendarIdFromMetadata(integration?.metadata) ?? "primary" : undefined,
  });
});

integrationsRouter.get("/calendar/connect-url", authMiddleware, async (req, res) => {
  try {
    if (!hasGoogleOAuth()) {
      const missing = [
        !config.google.clientId && "GOOGLE_CLIENT_ID",
        !config.google.clientSecret && "GOOGLE_CLIENT_SECRET",
      ].filter(Boolean);
      const message = `Google OAuth is not configured. Missing: ${missing.join(", ")}`;
      console.error("Calendar connect error:", message);
      res.status(503).json({ error: message });
      return;
    }

    const returnTo = normalizeOAuthReturnTo(req.query.returnTo);
    const state = signCalendarIntegrationState(req.auth!, returnTo);
    const url = await calendarAuthUrl(state);
    setCalendarStateCookie(res, state);
    console.log(
      `[calendar/connect-url] user=${req.auth!.userId} org=${req.auth!.organizationId} returnTo=${returnTo ?? "default"} redirectUri=${config.google.calendarRedirectUri} state=${state}`
    );
    res.json({ url });
  } catch (error) {
    console.error("Calendar connect error:", errorDetails(error));
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

integrationsRouter.get("/calendar/connect", async (req, res) => {
  if (!hasGoogleOAuth()) {
    res.status(503).send("Google OAuth is not configured");
    return;
  }

  const token = tokenFromRequest(req);
  if (!token) {
    res.status(401).send("Missing user token");
    return;
  }

  try {
    const auth = verifyToken(token);
    const returnTo = normalizeOAuthReturnTo(req.query.returnTo);
    const state = signCalendarIntegrationState(auth, returnTo);
    setCalendarStateCookie(res, state);
    console.log(
      `[calendar/connect] user=${auth.userId} org=${auth.organizationId} returnTo=${returnTo ?? "default"} redirectUri=${config.google.calendarRedirectUri} state=${state}`
    );
    res.redirect(await calendarAuthUrl(state));
  } catch {
    res.status(401).send("Invalid user token");
    return;
  }
});

integrationsRouter.get("/calendar/callback", async (req, res) => {
  const hasCode = Boolean(req.query.code);
  const hasState = Boolean(req.query.state);
  const traceId = `calendar-callback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const cookieState = cookieValue(req.headers.cookie, CALENDAR_OAUTH_STATE_COOKIE);
    console.log(
      `[calendar/callback][${traceId}] start hasCode=${hasCode} hasState=${hasState} state=${state ?? "none"} cookieState=${cookieState ?? "none"} redirectUri=${config.google.calendarRedirectUri}`
    );

    if (!code) {
      res.status(400).send("Missing Google OAuth code");
      return;
    }

    let organizationId: string;
    let decodedState: (Partial<CalendarIntegrationState> & { organizationId?: string }) | null = null;
    if (state) {
      decodedState = jwt.verify(state, config.jwtSecret) as Partial<CalendarIntegrationState> & { organizationId?: string };
      if (decodedState.purpose && decodedState.purpose !== "calendar_integration") {
        res.redirect(oauthIntegrationRedirect("calendar", "invalid_state", decodedState.returnTo));
        return;
      }
      if (!decodedState.organizationId) {
        res.redirect(oauthIntegrationRedirect("calendar", "invalid_state", decodedState.returnTo));
        return;
      }
      organizationId = decodedState.organizationId;
    } else {
      res.redirect(oauthIntegrationRedirect("calendar", "invalid_state", null));
      return;
    }

    const existingIntegration = await prisma.integration.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: "google_calendar",
        },
      },
    });

    const oauth2 = await getOAuth2Client(config.google.calendarRedirectUri);
    let tokens: {
      access_token?: string | null;
      refresh_token?: string | null;
      expiry_date?: number | null;
      token_type?: string | null;
      scope?: string;
      id_token?: string | null;
    };
    try {
      const tokenResult = await oauth2.getToken(code);
      tokens = tokenResult.tokens;
      oauth2.setCredentials(tokens);
      console.log(`[calendar/callback][${traceId}] exchanged tokens ${JSON.stringify(tokenTrace(tokens))}`);
    } catch (err) {
      console.error(`[calendar/callback][${traceId}] token exchange failed`, errorDetails(err));
      const isInvalidGrant =
        err instanceof Error && err.message.toLowerCase().includes("invalid_grant");
      if (isInvalidGrant && existingIntegration?.refreshToken) {
        clearCalendarStateCookie(res);
        res.redirect(oauthIntegrationRedirect("calendar", "connected", decodedState?.returnTo));
        return;
      }
      throw err;
    }

    if (!tokens.refresh_token && !existingIntegration?.refreshToken) {
      res
        .status(400)
        .send("Google did not return a refresh token. Reconnect and approve access.");
      return;
    }

    const refreshToken = tokens.refresh_token ?? existingIntegration?.refreshToken;
    if (!refreshToken) {
      res
        .status(400)
        .send("Google did not return a refresh token. Reconnect and approve access.");
      return;
    }

    const metadata = googleCalendarIntegrationMetadata(existingIntegration?.metadata, tokens.scope ?? null);
    await prisma.$transaction(async (tx) => {
      const saved = await tx.integration.upsert({
        where: {
          organizationId_provider: {
            organizationId,
            provider: "google_calendar",
          },
        },
        create: {
          organizationId,
          provider: "google_calendar",
          accessToken: tokens.access_token ?? null,
          refreshToken,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          metadata,
          connectedAt: new Date(),
        },
        update: {
          accessToken: tokens.access_token ?? null,
          refreshToken,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          metadata,
          connectedAt: new Date(),
        },
      });
      const verified = await tx.integration.findUnique({
        where: {
          organizationId_provider: {
            organizationId,
            provider: "google_calendar",
          },
        },
      });
      if (!verified?.refreshToken) {
        throw new Error("Calendar integration verification failed after save: refreshToken missing");
      }
      return saved;
    });

    console.log(
      `[calendar/callback][${traceId}] connected org=${organizationId} provider=google_calendar hasRefreshToken=${Boolean(refreshToken)}`
    );
    clearCalendarStateCookie(res);
    console.log(
      `[calendar/callback][${traceId}] redirect returnTo=${decodedState?.returnTo ?? "default"} org=${organizationId}`
    );
    res.redirect(oauthIntegrationRedirect("calendar", "connected", decodedState?.returnTo));
  } catch (err) {
    console.error(`[calendar/callback][${traceId}] failed`, errorDetails(err));
    const failedReturnTo =
      typeof req.query.state === "string"
        ? (jwt.decode(req.query.state) as Partial<CalendarIntegrationState> | null)?.returnTo
        : undefined;
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      res.redirect(oauthIntegrationRedirect("calendar", "invalid_state", failedReturnTo));
      return;
    }
    res.redirect(calendarCallbackErrorRedirect(err, failedReturnTo));
  }
});
