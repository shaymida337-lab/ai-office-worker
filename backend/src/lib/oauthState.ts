import { randomBytes, timingSafeEqual } from "crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { config } from "./config.js";

const NONCE_TTL_MS = 15 * 60 * 1000;
const consumedNonces = new Map<string, number>();

export class OAuthStateError extends Error {
  constructor(readonly code: "invalid" | "expired" | "replay" | "csrf" | "purpose") {
    super(`OAuth state error: ${code}`);
    this.name = "OAuthStateError";
  }
}

function pruneConsumedNonces() {
  const cutoff = Date.now() - NONCE_TTL_MS;
  for (const [nonce, usedAt] of consumedNonces) {
    if (usedAt < cutoff) consumedNonces.delete(nonce);
  }
}

export function signOAuthState(payload: Record<string, unknown>, expiresIn: SignOptions["expiresIn"] = "10m"): string {
  const nonce = randomBytes(16).toString("hex");
  return jwt.sign({ ...payload, nonce }, config.jwtSecret, { expiresIn });
}

export function verifyOAuthState<T extends { purpose?: string; nonce?: string }>(
  state: string,
  expectedPurpose: string
): T {
  let decoded: T;
  try {
    decoded = jwt.verify(state, config.jwtSecret) as T;
  } catch {
    throw new OAuthStateError("expired");
  }
  if (decoded.purpose !== expectedPurpose) {
    throw new OAuthStateError("purpose");
  }
  if (!decoded.nonce) {
    throw new OAuthStateError("invalid");
  }
  pruneConsumedNonces();
  if (consumedNonces.has(decoded.nonce)) {
    throw new OAuthStateError("replay");
  }
  consumedNonces.set(decoded.nonce, Date.now());
  return decoded;
}

export function assertOAuthStateCookie(state: string, cookieState: string | null | undefined) {
  if (!cookieState) {
    throw new OAuthStateError("csrf");
  }
  const a = Buffer.from(state);
  const b = Buffer.from(cookieState);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new OAuthStateError("csrf");
  }
}

export function oauthStateTraceId(state: string | undefined): string {
  if (!state) return "none";
  return state.slice(-12);
}

/** Test-only: reset replay store between tests. */
export function resetOAuthStateReplayStoreForTests() {
  consumedNonces.clear();
}
