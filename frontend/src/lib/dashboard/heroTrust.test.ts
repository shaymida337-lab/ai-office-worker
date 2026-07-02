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
    scanStatusKnown: true,
    scanRunning: false,
    hasSyncIssue: false,
  });
  assert.equal(state.statusTone, "success");
  assert.match(state.statusLabel, /מחוברת, סורקת ועובדת עבורך/);
  assert.equal(state.ctaAction, "ask_natalie");
});

test("resolveHeroTrustState prioritizes scanning state", () => {
  const state = resolveHeroTrustState({
    gmailStatusKnown: true,
    gmailConnected: true,
    scanStatusKnown: true,
    scanRunning: true,
    hasSyncIssue: false,
  });
  assert.equal(state.ctaLabel, "הצג התקדמות");
  assert.equal(state.ctaAction, "show_scan_progress");
});

test("resolveHeroTrustState shows sync issue only when confirmed and connected", () => {
  const state = resolveHeroTrustState({
    gmailStatusKnown: true,
    gmailConnected: true,
    scanStatusKnown: true,
    scanRunning: false,
    hasSyncIssue: true,
  });
  assert.equal(state.statusTone, "danger");
  assert.equal(state.ctaAction, "retry_sync");
});

test("resolveHeroTrustState shows checking while page is loading", () => {
  const state = resolveHeroTrustState({
    pageLoading: true,
    gmailStatusKnown: true,
    gmailConnected: true,
    scanRunning: false,
    hasSyncIssue: true,
  });
  assert.match(state.statusLabel, /בודקת את מצב החיבור/);
  assert.equal(state.statusTone, "neutral");
});

test("resolveHeroTrustState does not show sync issue when Gmail status is stale", () => {
  const state = resolveHeroTrustState({
    gmailStatusKnown: true,
    gmailStatusStale: true,
    gmailConnected: true,
    scanStatusKnown: true,
    scanRunning: false,
    hasSyncIssue: true,
  });
  assert.match(state.statusLabel, /בודקת את מצב החיבור/);
});

test("resolveHeroTrustState does not show sync issue when scan status is stale", () => {
  const state = resolveHeroTrustState({
    gmailStatusKnown: true,
    gmailConnected: true,
    scanStatusKnown: true,
    scanStatusStale: true,
    scanRunning: false,
    hasSyncIssue: true,
  });
  assert.match(state.statusLabel, /בודקת את מצב החיבור/);
});

test("resolveHeroTrustState does not show sync issue when scan status is unknown", () => {
  const state = resolveHeroTrustState({
    gmailStatusKnown: true,
    gmailConnected: true,
    scanStatusKnown: false,
    scanRunning: false,
    hasSyncIssue: true,
  });
  assert.match(state.statusLabel, /בודקת את מצב החיבור/);
});

test("resolveHeroTrustState preserves unknown Gmail as checking not disconnected", () => {
  const state = resolveHeroTrustState({
    gmailStatusKnown: false,
    gmailConnected: false,
    scanRunning: false,
    hasSyncIssue: false,
  });
  assert.match(state.statusLabel, /בודקת את מצב החיבור/);
});
