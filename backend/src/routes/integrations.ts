import { Router } from "express";
import jwt from "jsonwebtoken";
import { authMiddleware, signToken, verifyToken } from "../lib/auth.js";
import { config, hasGoogleOAuth } from "../lib/config.js";
import { errorDetails, publicErrorMessage } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { getOAuth2Client, GMAIL_SCOPES } from "../services/google.js";

export const integrationsRouter = Router();

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

function gmailCallbackErrorRedirect(err: unknown) {
  const reason = encodeURIComponent(publicErrorMessage(err).slice(0, 500));
  return `${config.frontendUrl}/dashboard/settings?gmail=error&reason=${reason}`;
}

type GmailIntegrationState = {
  purpose: "gmail_integration";
  userId: string;
  organizationId: string;
  email: string;
  timestamp: number;
};

function signGmailIntegrationState(auth: {
  userId: string;
  organizationId: string;
  email: string;
}) {
  return jwt.sign({
    purpose: "gmail_integration",
    userId: auth.userId,
    organizationId: auth.organizationId,
    email: auth.email,
    timestamp: Date.now(),
  } satisfies GmailIntegrationState, config.jwtSecret, { expiresIn: "10m" });
}

function runPostConnectionGmailScan(organizationId: string) {
  void import("../services/gmail-sync.js")
    .then(({ syncGmailForOrganization }) =>
      syncGmailForOrganization(organizationId, { daysBack: 90, forceReprocess: false })
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
  const integration = await prisma.integration.findUnique({
    where: {
      organizationId_provider: {
        organizationId: req.auth!.organizationId,
        provider: "gmail",
      },
    },
  });

  res.json({
    googleConfigured: hasGoogleOAuth(),
    connected: Boolean(integration?.refreshToken),
    connectedAt: integration?.connectedAt ?? null,
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

    const state = signGmailIntegrationState(req.auth!);
    const url = await gmailAuthUrl(state);
    console.log(
      `[gmail/connect-url] user=${req.auth!.userId} org=${req.auth!.organizationId} clientConfigured=${Boolean(config.google.clientId)} secretConfigured=${Boolean(config.google.clientSecret)} redirectUri=${config.google.integrationRedirectUri}`
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
    const state = signGmailIntegrationState(auth);
    res.redirect(await gmailAuthUrl(state));
  } catch {
    res.status(401).send("Invalid user token");
    return;
  }
});

integrationsRouter.get("/gmail/callback", async (req, res) => {
  const hasCode = Boolean(req.query.code);
  const hasState = Boolean(req.query.state);
  try {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    console.log(
      `[gmail/callback] start hasCode=${hasCode} hasState=${hasState} redirectUri=${config.google.integrationRedirectUri} clientConfigured=${Boolean(config.google.clientId)} secretConfigured=${Boolean(config.google.clientSecret)}`
    );

    if (!code) {
      res.status(400).send("Missing Google OAuth code");
      return;
    }

    const oauth2 = await getOAuth2Client(config.google.integrationRedirectUri);
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    if (!tokens.refresh_token && !state) {
      res
        .status(400)
        .send("Google did not return a refresh token. Reconnect and approve access.");
      return;
    }

    let organizationId: string;
    let frontendToken: string | null = null;
    if (state) {
      const decoded = jwt.verify(state, config.jwtSecret) as Partial<GmailIntegrationState> & { organizationId?: string };
      if (decoded.purpose && decoded.purpose !== "gmail_integration") {
        res.redirect(`${config.frontendUrl}/dashboard/settings?gmail=invalid_state`);
        return;
      }
      if (!decoded.organizationId) {
        res.redirect(`${config.frontendUrl}/dashboard/settings?gmail=invalid_state`);
        return;
      }
      organizationId = decoded.organizationId;
    } else {
      const oauth2api = await import("googleapis").then((g) =>
        g.google.oauth2({ version: "v2", auth: oauth2 })
      );
      const me = await oauth2api.userinfo.get();
      const email = me.data.email;
      if (!email) {
        res.status(400).send("No email from Google");
        return;
      }

      const normalizedEmail = email.trim().toLowerCase();
      let user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        include: { organization: true },
      });
      if (!user) {
        user = await prisma.user.create({
          data: {
            email: normalizedEmail,
            name: me.data.name ?? undefined,
            organization: {
              create: { name: me.data.name ?? "My Business" },
            },
          },
          include: { organization: true },
        });
      } else if (!user.organization) {
        await prisma.organization.create({
          data: { userId: user.id, name: me.data.name ?? "My Business" },
        });
        user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
          include: { organization: true },
        });
      }

      if (!user?.organization) {
        res.status(500).send("Organization missing");
        return;
      }
      organizationId = user.organization.id;
      frontendToken = signToken({
        userId: user.id,
        organizationId,
        email: user.email,
      });
    }

    const existingIntegration = await prisma.integration.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: "gmail",
        },
      },
    });
    const refreshToken = tokens.refresh_token ?? existingIntegration?.refreshToken;
    if (!refreshToken) {
      res
        .status(400)
        .send("Google did not return a refresh token. Reconnect and approve access.");
      return;
    }

    const savedIntegration = await prisma.integration.upsert({
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
      },
      update: {
        accessToken: tokens.access_token ?? null,
        refreshToken,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      },
    });

    console.log(
      `[gmail/callback] connected org=${organizationId} hasAccessToken=${Boolean(savedIntegration.accessToken)} hasRefreshToken=${Boolean(savedIntegration.refreshToken)} expiresAt=${savedIntegration.expiresAt?.toISOString() ?? "none"}`
    );
    runPostConnectionGmailScan(organizationId);

    if (frontendToken) {
      res.redirect(`${config.frontendUrl}/auth/callback#token=${encodeURIComponent(frontendToken)}&gmail=connected`);
      return;
    }

    res.redirect(`${config.frontendUrl}/dashboard/settings?gmail=connected`);
  } catch (err) {
    console.error("[gmail/callback]", errorDetails(err));
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      res.redirect(`${config.frontendUrl}/dashboard/settings?gmail=invalid_state`);
      return;
    }
    res.redirect(gmailCallbackErrorRedirect(err));
  }
});
