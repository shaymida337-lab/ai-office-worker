import assert from "node:assert/strict";
import test from "node:test";
import { resolveHeroTrustState } from "./heroTrust";

test("resolveHeroTrustState shows disconnected guidance when Gmail is not connected", () => {
  const state = resolveHeroTrustState({
    gmailStatusKnown: true,
    gmailConnected: false,
    scanRunning: false,
    hasSyncIssue: false,
  });
  assert.equal(state.statusTone, "warn");
  assert.match(state.statusLabel, /חבר Gmail/);
  assert.equal(state.ctaLabel, "חבר Gmail");
  assert.equal(state.ctaAction, "connect_gmail");
});

test("resolveHeroTrustState shows connected working message", () => {
  const state = resolveHeroTrustState({
    gmailStatusKnown: true,
    gmailConnected: true,
    scanRunning: false,
    hasSyncIssue: false,
  });
  assert.equal(state.statusTone, "success");
  assert.equal(state.ctaLabel, "שאל את נטלי");
  assert.equal(state.ctaAction, "ask_natalie");
});

test("resolveHeroTrustState prioritizes scanning state", () => {
  const state = resolveHeroTrustState({
    gmailStatusKnown: true,
    gmailConnected: true,
    scanRunning: true,
    hasSyncIssue: false,
  });
  assert.equal(state.ctaLabel, "הצג התקדמות");
  assert.equal(state.ctaAction, "show_scan_progress");
});

test("resolveHeroTrustState shows sync issue when connected with problems", () => {
  const state = resolveHeroTrustState({
    gmailStatusKnown: true,
    gmailConnected: true,
    scanRunning: false,
    hasSyncIssue: true,
  });
  assert.equal(state.statusTone, "danger");
  assert.equal(state.ctaAction, "retry_sync");
});
