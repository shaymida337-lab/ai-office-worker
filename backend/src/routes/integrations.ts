import { Router } from "express";
import { authMiddleware, signToken, verifyToken } from "../lib/auth.js";
import { config, hasGoogleOAuth } from "../lib/config.js";
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

integrationsRouter.get("/gmail/connect-url", authMiddleware, async (req, res) => {
  if (!hasGoogleOAuth()) {
    res.status(503).json({
      error:
        "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env.",
    });
    return;
  }

  res.json({ url: await gmailAuthUrl(signToken(req.auth!)) });
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

  verifyToken(token);
  res.redirect(await gmailAuthUrl(token));
});

integrationsRouter.get("/gmail/callback", async (req, res) => {
  try {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;

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
      organizationId = verifyToken(state).organizationId;
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

    await prisma.integration.upsert({
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

    if (frontendToken) {
      res.redirect(`${config.frontendUrl}/auth/callback?token=${frontendToken}&gmail=connected`);
      return;
    }

    res.redirect(`${config.frontendUrl}/dashboard?gmail=connected`);
  } catch (err) {
    console.error("[gmail/callback]", err);
    res.status(500).send("Failed to connect Gmail");
  }
});
