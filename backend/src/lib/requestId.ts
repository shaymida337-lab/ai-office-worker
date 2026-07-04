import type { Request } from "express";

export function readRequestId(req: Pick<Request, "headers">): string | undefined {
  const candidates = [
    req.headers["x-request-id"],
    req.headers["x-render-request-id"],
    req.headers["request-id"],
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}
