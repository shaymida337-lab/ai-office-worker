import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import { config } from "../lib/config.js";
import {
  assertOAuthStateCookie,
  OAuthStateError,
  resetOAuthStateReplayStoreForTests,
  signOAuthState,
  verifyOAuthState,
} from "../lib/oauthState.js";
import { encryptSecret, decryptSecret, isEncryptedSecret } from "../lib/secretsCrypto.js";
import { redactSecrets, maskEmail, maskPhone } from "../lib/safeLog.js";
import { stripClientGoogleTokens } from "../lib/integrationSecrets.js";
import { bodyPreview, sanitizeMetadataJson } from "../services/communication/communicationService.js";
import { normalizeOAuthReturnTo } from "../lib/oauthReturn.js";
import { isProduction } from "../lib/productionGuard.js";

test("OAuth state rejects replay and enforces cookie CSRF", () => {
  resetOAuthStateReplayStoreForTests();
  const state = signOAuthState({ purpose: "gmail_integration", organizationId: "org-1" });
  verifyOAuthState(state, "gmail_integration");
  assert.throws(() => verifyOAuthState(state, "gmail_integration"), (err: unknown) => err instanceof OAuthStateError && err.code === "replay");
  assert.throws(() => assertOAuthStateCookie(state, "wrong"), (err: unknown) => err instanceof OAuthStateError && err.code === "csrf");
  assert.doesNotThrow(() => assertOAuthStateCookie(state, state));
});

test("OAuth state rejects expired tokens", () => {
  resetOAuthStateReplayStoreForTests();
  const expired = jwt.sign({ purpose: "gmail_integration", nonce: "abc" }, config.jwtSecret, { expiresIn: -1 });
  assert.throws(() => verifyOAuthState(expired, "gmail_integration"), (err: unknown) => err instanceof OAuthStateError);
});

test("OAuth redirect allowlist rejects external URLs", () => {
  assert.equal(normalizeOAuthReturnTo("https://evil.example/phish"), null);
  assert.equal(normalizeOAuthReturnTo("/dashboard/settings"), "/dashboard/settings");
});

test("secrets crypto round-trips when key configured", () => {
  const previous = process.env.SECRETS_ENCRYPTION_KEY;
  process.env.SECRETS_ENCRYPTION_KEY = "test-encryption-key-for-foundation-p0";
  try {
    const encrypted = encryptSecret("refresh-token-value");
    assert.equal(isEncryptedSecret(encrypted), true);
    assert.equal(decryptSecret(encrypted), "refresh-token-value");
  } finally {
    process.env.SECRETS_ENCRYPTION_KEY = previous;
  }
});

test("client API strips google oauth tokens from responses", () => {
  const safe = stripClientGoogleTokens({
    id: "c1",
    name: "Client",
    googleAccessToken: "access",
    googleRefreshToken: "refresh",
  });
  assert.equal("googleAccessToken" in safe, false);
  assert.equal("googleRefreshToken" in safe, false);
});

test("safeLog redacts emails phones and jwt-like values", () => {
  const output = redactSecrets({
    email: "owner@example.com",
    phone: "+972544427244",
    token: "secret-value",
    note: "contact owner@example.com",
  }) as Record<string, string>;
  assert.match(String(output.note), /\*\*\*@example\.com/);
  assert.equal(output.token, "[redacted]");
  assert.equal(maskEmail("owner@example.com"), "ow***@example.com");
  assert.match(maskPhone("+972544427244"), /\*\*\*7244$/);
});

test("communication metadata sanitizes sensitive keys and limits preview", () => {
  const sanitized = sanitizeMetadataJson({
    accessToken: "abc",
    note: "x".repeat(600),
    stage: "created",
  }) as Record<string, string>;
  assert.equal(sanitized.accessToken, "[redacted]");
  assert.ok(sanitized.note.length <= 501);
  const preview = bodyPreview("a".repeat(400));
  assert.ok(preview && preview.length <= 281);
});

test("production guard detects production mode", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal(isProduction(), true);
  } finally {
    process.env.NODE_ENV = previous;
  }
});
