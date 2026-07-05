import assert from "node:assert/strict";
import test from "node:test";
import { resolveHeroTrustState } from "../dashboard/heroTrust";
import { resolveGmailConnectionTruth, shouldAutoTriggerGmailConnect } from "./gmailConnectionTruth";
import {
  buildGmailOAuthReturnRefreshPlan,
  buildOptimisticGmailConnectedStatus,
  cleanGmailOAuthReturnUrl,
  gmailOAuthErrorMessage,
  isGmailOAuthConnectedReturn,
  isGmailOAuthErrorReturn,
  parseGmailOAuthReturn,
  shouldHandleGmailOAuthErrorReturn,
  shouldHandleGmailOAuthReturn,
} from "./gmailOAuthReturn";

test("isGmailOAuthConnectedReturn matches gmail=connected only", () => {
  assert.equal(isGmailOAuthConnectedReturn("?gmail=connected"), true);
  assert.equal(isGmailOAuthConnectedReturn("?gmail=error"), false);
  assert.equal(isGmailOAuthConnectedReturn(""), false);
});

test("isGmailOAuthErrorReturn matches error and invalid_state", () => {
  assert.equal(isGmailOAuthErrorReturn("?gmail=error&reason=OAuth"), true);
  assert.equal(isGmailOAuthErrorReturn("?gmail=invalid_state"), true);
  assert.equal(isGmailOAuthErrorReturn("?gmail=connected"), false);
});

test("gmailOAuthErrorMessage prefers reason and falls back to Hebrew defaults", () => {
  assert.equal(gmailOAuthErrorMessage("token expired", "error"), "token expired");
  assert.match(gmailOAuthErrorMessage(null, "invalid_state"), /Gmail/);
  assert.match(gmailOAuthErrorMessage(null, "error"), /נכשל/);
});

test("shouldHandleGmailOAuthErrorReturn runs once per error return", () => {
  assert.equal(
    shouldHandleGmailOAuthErrorReturn({ search: "?gmail=error", alreadyHandled: false }),
    true
  );
  assert.equal(
    shouldHandleGmailOAuthErrorReturn({ search: "?gmail=error", alreadyHandled: true }),
    false
  );
});

test("parseGmailOAuthReturn extracts status and reason", () => {
  assert.deepEqual(parseGmailOAuthReturn("?gmail=error&reason=bad"), {
    status: "error",
    reason: "bad",
  });
  assert.deepEqual(parseGmailOAuthReturn(""), { status: null, reason: null });
});

test("shouldHandleGmailOAuthReturn runs once per return", () => {
  assert.equal(
    shouldHandleGmailOAuthReturn({ search: "?gmail=connected", alreadyHandled: false }),
    true
  );
  assert.equal(
    shouldHandleGmailOAuthReturn({ search: "?gmail=connected", alreadyHandled: true }),
    false
  );
});

test("buildOptimisticGmailConnectedStatus marks connected during callback convergence", () => {
  const status = buildOptimisticGmailConnectedStatus({
    googleConfigured: true,
    connected: false,
    connectedAt: null,
    reconnectRequired: false,
    missingDriveScopes: [],
  });
  assert.equal(status.connected, true);
  assert.ok(status.connectedAt);
});

test("buildGmailOAuthReturnRefreshPlan refreshes before and after load", () => {
  assert.deepEqual(buildGmailOAuthReturnRefreshPlan(), ["refresh", "load", "delay", "refresh-again"]);
});

test("cleanGmailOAuthReturnUrl strips OAuth params by returning dashboard path", () => {
  assert.equal(cleanGmailOAuthReturnUrl(), "/dashboard");
});

test("buildGmailOAuthReturnRefreshPlan runs refresh before load", () => {
  const plan = buildGmailOAuthReturnRefreshPlan();
  assert.equal(plan[0], "refresh");
  assert.ok(plan.indexOf("load") > plan.indexOf("refresh"));
});

test("optimistic connected status avoids connect CTA if refresh temporarily fails", () => {
  const optimistic = buildOptimisticGmailConnectedStatus(null);
  const truth = resolveGmailConnectionTruth({
    pageLoading: false,
    statusKnown: true,
    statusStale: true,
    apiConnected: optimistic.connected,
    hasGmailActivityEvidence: false,
  });
  assert.equal(truth.showConnectCta, false);
  assert.equal(truth.treatAsConnectedForUi, true);
});

test("connected state prevents auto OAuth re-trigger after return", () => {
  assert.equal(
    shouldAutoTriggerGmailConnect({
      connectParam: "gmail",
      pageLoading: false,
      alreadyTriggered: false,
      gmailConnectionState: "Connected",
    }),
    false
  );
});

test("checking state prevents auto OAuth re-trigger after return", () => {
  assert.equal(
    shouldAutoTriggerGmailConnect({
      connectParam: "gmail",
      pageLoading: false,
      alreadyTriggered: false,
      gmailConnectionState: "Checking",
    }),
    false
  );
});

test("reconnectRequired connected state remains warning not disconnected", () => {
  const hero = resolveHeroTrustState({
    gmailConnectionState: "ReconnectRequired",
    scanStatusKnown: true,
    scanRunning: false,
  });
  assert.equal(hero.ctaAction, "retry_sync");
  assert.notEqual(hero.ctaAction, "connect_gmail");
});

test("first post-connect loading state stays neutral when status is stale", () => {
  const hero = resolveHeroTrustState({
    gmailConnectionState: "Checking",
    scanStatusKnown: true,
    scanRunning: false,
  });
  assert.match(hero.statusLabel, /בודקת את מצב החיבור/);
  assert.notEqual(hero.ctaAction, "connect_gmail");
});

test("shouldHandleGmailOAuthReturn requires param before one-time guard is set", () => {
  assert.equal(isGmailOAuthConnectedReturn("?gmail=connected"), true);
  assert.equal(
    shouldHandleGmailOAuthReturn({ search: "?gmail=connected", alreadyHandled: false }),
    true
  );
});
