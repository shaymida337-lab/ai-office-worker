import assert from "node:assert/strict";
import test from "node:test";
import { resolveHeroTrustState } from "./heroTrust";

test("resolveHeroTrustState shows disconnected error when Gmail is not connected", () => {
  const state = resolveHeroTrustState({
    gmailConnectionState: "Disconnected",
    scanRunning: false,
  });
  assert.equal(state.statusTone, "danger");
  assert.match(state.statusLabel, /Gmail לא מחובר/);
  assert.equal(state.ctaLabel, "חבר Gmail");
  assert.equal(state.ctaAction, "connect_gmail");
});

test("resolveHeroTrustState shows connected working message", () => {
  const state = resolveHeroTrustState({
    gmailConnectionState: "Connected",
    scanStatusKnown: true,
    scanRunning: false,
  });
  assert.equal(state.statusTone, "success");
  assert.match(state.statusLabel, /מחוברת, סורקת ועובדת עבורך/);
  assert.equal(state.ctaAction, "ask_natalie");
});

test("resolveHeroTrustState prioritizes scanning state", () => {
  const state = resolveHeroTrustState({
    gmailConnectionState: "Connected",
    scanStatusKnown: true,
    scanRunning: true,
  });
  assert.equal(state.ctaLabel, "הצג התקדמות");
  assert.equal(state.ctaAction, "show_scan_progress");
});

test("resolveHeroTrustState shows explicit reconnect error for ReconnectRequired", () => {
  const state = resolveHeroTrustState({
    gmailConnectionState: "ReconnectRequired",
    scanStatusKnown: true,
    scanRunning: false,
  });
  assert.equal(state.statusTone, "danger");
  assert.equal(state.ctaAction, "retry_sync");
  assert.equal(state.ctaLabel, "נסה שוב");
  assert.match(state.statusLabel, /OAuth|Gmail/);
  assert.doesNotMatch(state.statusLabel, /יש בעיית סנכרון$/);
});

test("resolveHeroTrustState shows checking state without connect CTA", () => {
  const state = resolveHeroTrustState({
    gmailConnectionState: "Checking",
    scanRunning: false,
  });
  assert.match(state.statusLabel, /בודקת את מצב החיבור/);
  assert.equal(state.statusTone, "neutral");
  assert.notEqual(state.ctaAction, "connect_gmail");
});

test("resolveHeroTrustState shows warning when scan status is stale", () => {
  const state = resolveHeroTrustState({
    gmailConnectionState: "Connected",
    scanStatusKnown: true,
    scanStatusStale: true,
    scanRunning: false,
  });
  assert.equal(state.statusTone, "warn");
  assert.match(state.statusLabel, /מציגים את המצב האחרון/);
});

test("resolveHeroTrustState does not show sync issue when scan status is unknown", () => {
  const state = resolveHeroTrustState({
    gmailConnectionState: "Connected",
    scanStatusKnown: false,
    scanRunning: false,
  });
  assert.match(state.statusLabel, /בודקת את מצב החיבור/);
});

test("resolveHeroTrustState shows connecting sync state without connect CTA", () => {
  const state = resolveHeroTrustState({
    gmailConnectionState: "Connecting",
    scanRunning: false,
  });
  assert.match(state.statusLabel, /מחבר ל-Gmail/);
  assert.notEqual(state.ctaAction, "connect_gmail");
});

test("resolveHeroTrustState keeps checking for evidence verification not disconnected", () => {
  const state = resolveHeroTrustState({
    gmailConnectionState: "Checking",
    scanRunning: false,
  });
  assert.match(state.statusLabel, /בודקת את מצב החיבור/);
  assert.equal(state.ctaAction, "ask_natalie");
  assert.notEqual(state.ctaAction, "connect_gmail");
});
