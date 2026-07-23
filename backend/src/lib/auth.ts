import { createHash, timingSafeEqual } from "crypto";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";
import { isAppointmentsTimingPath } from "./appointmentsEndpointTiming.js";
import { isDashboardBootstrapTimingPath } from "./dashboardBootstrapServerTiming.js";

export type JwtPayload = {
  userId: string;
  organizationId: string;
  email: string;
};

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "30d" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const timingAppointments = isAppointmentsTimingPath(req.path);
  const timingBootstrap = isDashboardBootstrapTimingPath(req.path);
  const timing = timingAppointments || timingBootstrap;
  const authT0 = timing ? performance.now() : 0;
  if (timingAppointments) {
    res.locals.appointmentsWallStart = res.locals.appointmentsWallStart ?? authT0;
    res.locals.appointmentsAuthStart = authT0;
  }
  if (timingBootstrap) {
    res.locals.dashboardBootstrapWallStart = res.locals.dashboardBootstrapWallStart ?? authT0;
    res.locals.dashboardBootstrapAuthStart = authT0;
  }
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    req.auth = verifyToken(token);
    if (timingAppointments) {
      const authEnd = performance.now();
      res.locals.appointmentsAuthEnd = authEnd;
      res.locals.appointmentsAuthMs = Math.round(authEnd - authT0);
      res.locals.appointmentsRequestReceivedAt = res.locals.appointmentsWallStart ?? authT0;
    }
    if (timingBootstrap) {
      const authEnd = performance.now();
      res.locals.dashboardBootstrapAuthEnd = authEnd;
      res.locals.dashboardBootstrapAuthMs = Math.round(authEnd - authT0);
    }
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

export function cronMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const secret = req.headers["x-cron-secret"];
  const receivedSecret = Array.isArray(secret) ? secret[0] : secret;
  const expectedConfigured = Boolean(config.cronSecret);
  const receivedConfigured = Boolean(receivedSecret);
  const expectedFingerprint = secretFingerprint(config.cronSecret);
  const receivedFingerprint = secretFingerprint(receivedSecret);
  const valid =
    typeof receivedSecret === "string" &&
    expectedConfigured &&
    safeSecretEquals(receivedSecret, config.cronSecret);

  console.log(
    `[cron-auth] path=${req.path} expectedSource=process.env.CRON_SECRET expectedExists=${expectedConfigured} expectedHash=${expectedFingerprint} receivedHeaderExists=${receivedConfigured} receivedHash=${receivedFingerprint} valid=${valid}`
  );

  if (!valid) {
    console.warn(
      `[cron-auth] forbidden path=${req.path} reason="${!expectedConfigured ? "missing_expected_cron_secret" : !receivedConfigured ? "missing_x_cron_secret_header" : "x_cron_secret_mismatch"}"`
    );
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

function secretFingerprint(value: unknown) {
  if (typeof value !== "string" || !value) return "none";
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function safeSecretEquals(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

declare global {
  namespace Express {
    interface Request {
      auth?: JwtPayload;
      /** Set only by validateTenantMiddleware after DB verification. Request-scoped. */
      verifiedTenant?: import("../services/tenant/verifiedTenant.js").RequestVerifiedTenant;
    }
    interface Locals {
      appointmentsWallStart?: number;
      appointmentsRequestReceivedAt?: number;
      appointmentsAuthStart?: number;
      appointmentsAuthEnd?: number;
      appointmentsAuthMs?: number;
      appointmentsTenantStart?: number;
      appointmentsTenantEnd?: number;
      appointmentsTenantMs?: number;
      appointmentsTenantCacheSource?: string;
      appointmentsTenantCacheAgeMs?: number | null;
      appointmentsTenantDbMs?: number;
      appointmentsOrgStart?: number;
      appointmentsOrgEnd?: number;
      appointmentsOrgMs?: number;
      appointmentsOrgRoleSource?: string;
      dashboardBootstrapWallStart?: number;
      dashboardBootstrapAuthStart?: number;
      dashboardBootstrapAuthEnd?: number;
      dashboardBootstrapAuthMs?: number;
      dashboardBootstrapTenantStart?: number;
      dashboardBootstrapTenantEnd?: number;
      dashboardBootstrapTenantMs?: number;
      dashboardBootstrapTenantCacheSource?: string;
      dashboardBootstrapTenantCacheAgeMs?: number | null;
      dashboardBootstrapTenantDbMs?: number;
    }
  }
}
