import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/auth.js";
import { config, hasGoogleOAuth } from "../lib/config.js";
import { isPlatformAdmin } from "../services/marketingLeads/leadAdminService.js";
import { ensureGmailAccessToken, getOAuth2Client, GMAIL_SCOPES, googleOAuthMetadata } from "../services/google.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { sendAuthSuccess } from "../lib/auth-response.js";
import { errorDetails, publicErrorMessage } from "../lib/errors.js";
import { markOrganizationNeedsOnboarding } from "../services/businessTemplates.js";
import { recordPlatformAudit, userAuditContext } from "../services/auditLog/index.js";
import { ensureOwnerMembership } from "../services/rbac/index.js";
import {
  assertRefreshTokenCanBindToOrganization,
  GmailIntegrationIsolationError,
} from "../services/gmailIntegrationIsolation.js";

export const authRouter = Router();

const emailSchema = z.string().email("Invalid email").max(255);
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128);

function runPostConnectionGmailScan(organizationId: string) {
  void import("../services/gmail-sync.js")
    .then(({ syncGmailForOrganization }) =>
      syncGmailForOrganization(organizationId, { isFirstTime: true, forceReprocess: false })
    )
    .then((result) => {
      console.log(
        `[auth/google] post-connection scan finished org=${organizationId} emails=${result.emailsProcessed} relevant=${result.relevantEmailsFound ?? result.invoiceEmails ?? 0} records=${result.recordsSaved ?? 0} duplicates=${result.duplicatesSkipped ?? 0} errors=${result.errorsCount ?? 0}`
      );
    })
    .catch((err) => {
      console.error(`[auth/google] post-connection scan failed org=${organizationId}`, err);
    });
}

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1).max(120).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password required"),
});

/** POST /auth/register — email + password signup */
authRouter.post("/register", async (req, res) => {
  try {
    if (config.security.blockNewRegistrations) {
      res.status(503).json({ error: "Registration is temporarily disabled" });
      return;
    }

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.errors[0]?.message ?? "Invalid input",
      });
      return;
    }

    const { email, password, name } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: name?.trim() ?? null,
        passwordHash,
        organization: {
          create: { name: name?.trim() || "My Business" },
        },
      },
      include: { organization: true },
    });
    if (user.organization) {
      await markOrganizationNeedsOnboarding(user.organization.id);
      await ensureOwnerMembership(user.organization.id, user.id);
    }

    const organizationIntegrity = await prisma.organization.findUnique({
      where: { id: user.organization!.id },
      select: { id: true, userId: true },
    });
    if (!organizationIntegrity || organizationIntegrity.userId !== user.id) {
      console.error(
        `[auth/register] organization integrity failure userId=${user.id} organizationId=${user.organization?.id ?? "missing"} ownerUserId=${organizationIntegrity?.userId ?? "missing"}`,
      );
      res.status(500).json({ error: "Registration failed" });
      return;
    }

    recordPlatformAudit({
      ...userAuditContext(user.id, "auth", "POST /auth/register"),
      organizationId: user.organization!.id,
      entityType: "organization",
      entityId: user.organization!.id,
      action: "organization_created",
      afterState: { id: user.organization!.id, name: user.organization!.name },
      metadata: { userId: user.id, email: user.email },
    });

    await sendAuthSuccess(res, user);
  } catch (err) {
    console.error("[auth/register]", errorDetails(err));
    res.status(500).json({ error: "Registration failed", detail: publicErrorMessage(err) });
  }
});

/** POST /auth/login — email + password */
authRouter.post("/login", async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.errors[0]?.message ?? "Invalid input",
      });
      return;
    }

    const { email, password } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { organization: true },
    });

    if (!user?.passwordHash) {
      res.status(401).json({
        error: user
          ? "This account uses Google sign-in. Use Google or set a password."
          : "Invalid email or password",
      });
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    if (!user.organization) {
      const organization = await prisma.organization.create({
        data: { userId: user.id, name: user.name ?? "My Business" },
      });
      await markOrganizationNeedsOnboarding(organization.id);
      await ensureOwnerMembership(organization.id, user.id);
      const refreshed = await prisma.user.findUnique({
        where: { id: user.id },
        include: { organization: true },
      });
      if (!refreshed?.organization) {
        res.status(500).json({ error: "Organization missing" });
        return;
      }
      recordPlatformAudit({
        ...userAuditContext(refreshed.id, "auth", "POST /auth/login"),
        organizationId: refreshed.organization.id,
        entityType: "user",
        entityId: refreshed.id,
        action: "user_login",
        metadata: { email: refreshed.email, organizationCreatedOnLogin: true },
      });
      await sendAuthSuccess(res, refreshed);
      return;
    }

    recordPlatformAudit({
      ...userAuditContext(user.id, "auth", "POST /auth/login"),
      organizationId: user.organization.id,
      entityType: "user",
      entityId: user.id,
      action: "user_login",
      metadata: { email: user.email },
    });

    await sendAuthSuccess(res, user);
  } catch (err) {
    console.error("[auth/login]", errorDetails(err));
    res.status(500).json({ error: "Login failed", detail: publicErrorMessage(err) });
  }
});

async function buildGoogleAuthUrl() {
  if (!hasGoogleOAuth()) {
    return null;
  }
  const oauth2 = await getOAuth2Client();
  const state = jwt.sign(
    {
      purpose: "google_login",
      nonce: crypto.randomBytes(16).toString("hex"),
      timestamp: Date.now(),
    },
    config.jwtSecret,
    { expiresIn: "10m" }
  );
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: GMAIL_SCOPES,
    state,
  });
  return url;
}

authRouter.get("/google/url", async (_req, res) => {
  const url = await buildGoogleAuthUrl();
  if (!url) {
    res.status(503).json({ error: "Google OAuth not configured" });
    return;
  }
  res.json({ url });
});

authRouter.get("/google", async (_req, res) => {
  const url = await buildGoogleAuthUrl();
  if (!url) {
    res.status(503).json({ error: "Google OAuth not configured" });
    return;
  }
  res.redirect(url);
});

authRouter.get("/status", authMiddleware, async (req, res) => {
  try {
    const integration = await ensureGmailAccessToken(req.auth!.organizationId);
    res.json({
      gmail: {
        connected: true,
        hasAccessToken: Boolean(integration.accessToken),
        expiresAt: integration.expiresAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth status failed";
    if (message === "Gmail not connected") {
      res.json({ gmail: { connected: false, hasAccessToken: false, expiresAt: null } });
      return;
    }
    res.status(500).json({ error: message });
  }
});

authRouter.get("/google/callback", async (req, res) => {
  try {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    if (!code) {
      res.status(400).send("Missing code");
      return;
    }
    if (!state) {
      res.status(400).send("Missing state");
      return;
    }
    const decoded = jwt.verify(state, config.jwtSecret) as {
      purpose?: string;
      userId?: string;
      organizationId?: string;
      email?: string;
    };
    const oauth2 = await getOAuth2Client();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    if (decoded.purpose === "gmail_integration") {
      if (!decoded.organizationId || !decoded.userId || !decoded.email) {
        res.redirect(`${config.frontendUrl}/dashboard/settings?gmail=invalid_state`);
        return;
      }
      const existingIntegration = await prisma.integration.findUnique({
        where: {
          organizationId_provider: {
            organizationId: decoded.organizationId,
            provider: "gmail",
          },
        },
      });
      const refreshToken = tokens.refresh_token ?? existingIntegration?.refreshToken;
      if (!refreshToken) {
        res.status(400).send("Google did not return a refresh token. Reconnect and approve access.");
        return;
      }
      const metadata = googleOAuthMetadata(existingIntegration?.metadata, tokens.scope ?? null);
      const savedIntegration = await prisma.integration.upsert({
        where: {
          organizationId_provider: {
            organizationId: decoded.organizationId,
            provider: "gmail",
          },
        },
        create: {
          organizationId: decoded.organizationId,
          provider: "gmail",
          accessToken: tokens.access_token ?? null,
          refreshToken,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          metadata,
        },
        update: {
          accessToken: tokens.access_token ?? null,
          refreshToken,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          metadata,
        },
      });
      console.log(
        `[auth/google/callback] Gmail connected org=${decoded.organizationId} hasAccessToken=${Boolean(savedIntegration.accessToken)} hasRefreshToken=${Boolean(savedIntegration.refreshToken)} expiresAt=${savedIntegration.expiresAt?.toISOString() ?? "none"}`
      );
      runPostConnectionGmailScan(decoded.organizationId);
      res.redirect(`${config.frontendUrl}/dashboard/settings?gmail=connected`);
      return;
    }

    if (decoded.purpose !== "google_login") {
      res.status(400).send("Invalid state");
      return;
    }

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

    let isNewUser = false;
    let user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { organization: true },
    });
    if (!user) {
      isNewUser = true;
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
      if (user.organization) {
        await markOrganizationNeedsOnboarding(user.organization.id);
        await ensureOwnerMembership(user.organization.id, user.id);
      }
    } else if (!user.organization) {
      const organization = await prisma.organization.create({
        data: { userId: user.id, name: me.data.name ?? "My Business" },
      });
      await markOrganizationNeedsOnboarding(organization.id);
      await ensureOwnerMembership(organization.id, user.id);
      user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        include: { organization: true },
      });
    }

    const org = user?.organization;
    if (!user || !org) {
      res.status(500).send("Organization missing");
      return;
    }

    const existingLoginIntegration = await prisma.integration.findUnique({
      where: {
        organizationId_provider: { organizationId: org.id, provider: "gmail" },
      },
      select: { metadata: true, refreshToken: true },
    });
    const metadata = googleOAuthMetadata(existingLoginIntegration?.metadata, tokens.scope ?? null);
    const refreshToken = tokens.refresh_token ?? existingLoginIntegration?.refreshToken ?? null;
    if (refreshToken) {
      await assertRefreshTokenCanBindToOrganization(org.id, refreshToken);
    }
    const savedIntegration = await prisma.integration.upsert({
      where: {
        organizationId_provider: { organizationId: org.id, provider: "gmail" },
      },
      create: {
        organizationId: org.id,
        provider: "gmail",
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        metadata,
      },
      update: {
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token ?? undefined,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        metadata,
      },
    });
    console.log(
      `[auth/google/callback] Google login saved Gmail integration org=${org.id} hasAccessToken=${Boolean(savedIntegration.accessToken)} hasRefreshToken=${Boolean(savedIntegration.refreshToken)} expiresAt=${savedIntegration.expiresAt?.toISOString() ?? "none"}`
    );

    const token = signToken({
      userId: user.id,
      organizationId: org.id,
      email: user.email,
    });

    if (isNewUser && tokens.refresh_token) {
      const { scheduler } = await import("../services/scheduler.js");
      scheduler.runFirstTimeScan(org.id).catch((scanErr) => {
        console.error("[auth] first-time scan failed", scanErr);
      });
    }

    res.redirect(`${config.frontendUrl}/auth/callback#token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error("[auth/google/callback]", err);
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      res.redirect(`${config.frontendUrl}/login?error=invalid_state`);
      return;
    }
    res.status(500).send("Auth failed");
  }
});

authRouter.get("/me", async (req, res) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const { verifyToken } = await import("../lib/auth.js");
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { organization: true },
    });
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    res.json({ user, organization: user.organization });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

/** Soft flag for UI gating — always 200 for authenticated users; does not change marketing-leads ACLs. */
authRouter.get("/platform-admin", authMiddleware, (req, res) => {
  const email = req.auth?.email;
  res.json({ isPlatformAdmin: isPlatformAdmin(email, config.platformAdminEmails) });
});
