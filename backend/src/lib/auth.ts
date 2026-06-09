import { createHash, timingSafeEqual } from "crypto";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";
import { prisma } from "./prisma.js";

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

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = verifyToken(token);
    req.authTokenPayload = payload;
    console.log(
      `[auth] decoded userId=${payload.userId} organizationId=${payload.organizationId} email=${payload.email} path=${req.path}`
    );
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { organization: true },
    });
    if (!user?.organization) {
      console.warn(`[auth] user/org not found userId=${payload.userId} tokenOrg=${payload.organizationId} path=${req.path}`);
      res.status(401).json({ error: "User or organization not found" });
      return;
    }
    if (user.organization.id !== payload.organizationId || user.email !== payload.email) {
      console.warn(
        `[auth] token payload mismatch userId=${payload.userId} tokenOrg=${payload.organizationId} dbOrg=${user.organization.id} tokenEmail=${payload.email} dbEmail=${user.email} path=${req.path}`
      );
    }
    req.auth = {
      userId: user.id,
      organizationId: user.organization.id,
      email: user.email,
    };
    console.log(`[auth] ok userId=${req.auth.userId} organizationId=${req.auth.organizationId} path=${req.path}`);
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
      authTokenPayload?: JwtPayload;
    }
  }
}
