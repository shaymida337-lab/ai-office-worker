import type { Request, Response, NextFunction } from "express";

const DEBUG_TOKEN_HEADER = "x-sentry-debug-token";

/**
 * Allows /debug-sentry in non-production, or in production only when
 * SENTRY_DEBUG_TOKEN is set and the request carries a matching header.
 * Otherwise responds 404 so the route is not discoverable.
 */
export function allowSentryDebugRoute(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== "production") {
    next();
    return;
  }

  const expected = process.env.SENTRY_DEBUG_TOKEN?.trim();
  if (!expected) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const provided = req.get(DEBUG_TOKEN_HEADER)?.trim();
  if (provided && provided === expected) {
    next();
    return;
  }

  res.status(404).json({ error: "Not found" });
}
