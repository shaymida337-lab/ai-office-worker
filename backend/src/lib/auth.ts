import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";

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
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    req.auth = verifyToken(token);
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
  if (secret !== config.cronSecret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

declare global {
  namespace Express {
    interface Request {
      auth?: JwtPayload;
    }
  }
}
