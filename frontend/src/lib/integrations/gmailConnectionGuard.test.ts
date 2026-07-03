import assert from "node:assert/strict";
import test from "node:test";
import type { GmailConnectionStateModel } from "./gmailConnectionState";
import { resolveHeroTrustState } from "../dashboard/heroTrust";
import {
  GMAIL_CONNECTION_CANONICAL_STATES,
  gmailConnectionUiAllowsConnectCta,
  gmailConnectionUiShowsReconnectWarning,
  guardGmailConnectionModel,
  isKnownGmailConnectionState,
} from "./gmailConnectionGuard";
import { resolveGmailConnectionState } from "./gmailConnectionState";

test("isKnownGmailConnectionState accepts only canonical values", () => {
  for (const state of GMAIL_CONNECTION_CANONICAL_STATES) {
    assert.equal(isKnownGmailConnectionState(state), true);
  }
  assert.equal(isKnownGmailConnectionState("connected"), false);
  assert.equal(isKnownGmailConnectionState(null), false);
});

test("guardGmailConnectionModel falls back unknown state to Checking", () => {
  const result = guardGmailConnectionModel({
    state: "Broken",
    showConnectCta: true,
    showReconnectWarning: true,
    treatAsConnectedForUi: true,
  });
  assert.equal(result.model.state, "Checking");
  assert.equal(result.model.showConnectCta, false);
  assert.equal(result.model.showReconnectWarning, false);
  assert.equal(result.model.treatAsConnectedForUi, false);
  assert.equal(result.recovered, true);
  assert.ok(result.violations.length > 0);
});

test("guardGmailConnectionModel enforces showConnectCta only for Disconnected", () => {
  const result = guardGmailConnectionModel({
    state: "Connected",
    showConnectCta: true,
    showReconnectWarning: false,
    treatAsConnectedForUi: true,
  });
  assert.equal(result.model.state, "Connected");
  assert.equal(result.model.showConnectCta, false);
  assert.equal(result.recovered, true);
});

test("guardGmailConnectionModel enforces reconnect warning only for ReconnectRequired", () => {
  const result = guardGmailConnectionModel({
    state: "Connected",
    showConnectCta: false,
    showReconnectWarning: true,
    treatAsConnectedForUi: true,
  });
  assert.equal(result.model.showReconnectWarning, false);
  assert.equal(result.recovered, true);
});

test("guardGmailConnectionModel recovers ReconnectRequired with connect CTA", () => {
  const result = guardGmailConnectionModel({
    state: "ReconnectRequired",
    showConnectCta: true,
    showReconnectWarning: true,
    treatAsConnectedForUi: true,
  });
  assert.equal(result.model.showConnectCta, false);
  assert.equal(result.model.showReconnectWarning, true);
  assert.equal(result.recovered, true);
});

test("guardGmailConnectionModel preserves valid Checking connected hint", () => {
  const result = guardGmailConnectionModel({
    state: "Checking",
    showConnectCta: false,
    showReconnectWarning: false,
    treatAsConnectedForUi: true,
  });
  assert.equal(result.recovered, false);
  assert.equal(result.model.treatAsConnectedForUi, true);
});

test("guardGmailConnectionModel never throws on malformed input", () => {
  assert.doesNotThrow(() => guardGmailConnectionModel({} as GmailConnectionStateModel));
  assert.doesNotThrow(() => guardGmailConnectionModel(undefined as unknown as GmailConnectionStateModel));
});

test("resolveGmailConnectionState output always passes guard invariants", () => {
  const cases = [
    { loading: true, connecting: false, connected: false, reconnectRequired: false },
    { loading: true, connecting: false, connected: true, reconnectRequired: false },
    { loading: false, connecting: true, connected: false, reconnectRequired: false },
    { loading: false, connecting: false, connected: false, reconnectRequired: false },
    { loading: false, connecting: false, connected: true, reconnectRequired: false },
    { loading: false, connecting: false, connected: true, reconnectRequired: true },
  ];
  for (const input of cases) {
    const model = resolveGmailConnectionState(input);
    const guarded = guardGmailConnectionModel(model);
    assert.equal(guarded.recovered, false, JSON.stringify(input));
  }
});

test("UI mapping: ReconnectRequired never exposes connect CTA", () => {
  const model = guardGmailConnectionModel({
    state: "ReconnectRequired",
    showConnectCta: true,
    showReconnectWarning: true,
    treatAsConnectedForUi: true,
  }).model;
  assert.equal(gmailConnectionUiAllowsConnectCta(model), false);
  const hero = resolveHeroTrustState({
    gmailConnectionState: model.state,
    scanStatusKnown: true,
    scanRunning: false,
  });
  assert.notEqual(hero.ctaAction, "connect_gmail");
  assert.equal(hero.ctaAction, "retry_sync");
});

test("UI mapping: Connected has no reconnect warning", () => {
  const model = guardGmailConnectionModel({
    state: "Connected",
    showConnectCta: false,
    showReconnectWarning: false,
    treatAsConnectedForUi: true,
  }).model;
  assert.equal(gmailConnectionUiShowsReconnectWarning(model), false);
});

test("UI mapping: Checking has neutral hero without connect CTA", () => {
  const model = guardGmailConnectionModel({
    state: "Checking",
    showConnectCta: false,
    showReconnectWarning: false,
    treatAsConnectedForUi: false,
  }).model;
  const hero = resolveHeroTrustState({
    gmailConnectionState: model.state,
    scanRunning: false,
  });
  assert.match(hero.statusLabel, /בודקת את מצב החיבור/);
  assert.notEqual(hero.ctaAction, "connect_gmail");
});
