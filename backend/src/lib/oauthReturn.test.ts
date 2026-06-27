import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOAuthReturnTo,
  oauthIntegrationRedirect,
  OAUTH_RETURN_ALLOWLIST,
} from "./oauthReturn.js";

test("normalizeOAuthReturnTo accepts allowlisted paths", () => {
  for (const path of OAUTH_RETURN_ALLOWLIST) {
    assert.equal(normalizeOAuthReturnTo(path), path);
    assert.equal(normalizeOAuthReturnTo(`${path}?foo=bar`), path);
  }
});

test("normalizeOAuthReturnTo rejects open redirects", () => {
  assert.equal(normalizeOAuthReturnTo("https://evil.example"), null);
  assert.equal(normalizeOAuthReturnTo("//evil.example"), null);
  assert.equal(normalizeOAuthReturnTo("/admin"), null);
  assert.equal(normalizeOAuthReturnTo("/dashboard/evil"), null);
  assert.equal(normalizeOAuthReturnTo(""), null);
  assert.equal(normalizeOAuthReturnTo(undefined), null);
});

test("oauthIntegrationRedirect uses returnTo when valid", () => {
  const url = oauthIntegrationRedirect("gmail", "connected", "/onboarding");
  assert.match(url, /\/onboarding\?gmail=connected$/);
});

test("oauthIntegrationRedirect falls back to provider default", () => {
  const gmailUrl = oauthIntegrationRedirect("gmail", "connected", "/evil");
  assert.match(gmailUrl, /\/dashboard\/settings\?gmail=connected$/);

  const calendarUrl = oauthIntegrationRedirect("calendar", "connected", null);
  assert.match(calendarUrl, /\/dashboard\/calendar\?calendar=connected$/);
});
