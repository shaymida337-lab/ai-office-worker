import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGmailConnectionContext,
  resolveGmailConnectionState,
} from "./gmailConnectionState";

test("resolveGmailConnectionState returns Checking when loading", () => {
  const model = resolveGmailConnectionState({
    loading: true,
    connecting: false,
    connected: false,
    reconnectRequired: false,
  });
  assert.equal(model.state, "Checking");
  assert.equal(model.showConnectCta, false);
  assert.equal(model.showReconnectWarning, false);
});

test("resolveGmailConnectionState returns Disconnected when not connected", () => {
  const model = resolveGmailConnectionState({
    loading: false,
    connecting: false,
    connected: false,
    reconnectRequired: false,
  });
  assert.equal(model.state, "Disconnected");
  assert.equal(model.showConnectCta, true);
  assert.equal(model.showReconnectWarning, false);
});

test("resolveGmailConnectionState returns Connected when connected without reconnect", () => {
  const model = resolveGmailConnectionState({
    loading: false,
    connecting: false,
    connected: true,
    reconnectRequired: false,
  });
  assert.equal(model.state, "Connected");
  assert.equal(model.showConnectCta, false);
  assert.equal(model.showReconnectWarning, false);
});

test("resolveGmailConnectionState returns ReconnectRequired when connected with reconnect flag", () => {
  const model = resolveGmailConnectionState({
    loading: false,
    connecting: false,
    connected: true,
    reconnectRequired: true,
  });
  assert.equal(model.state, "ReconnectRequired");
  assert.equal(model.showConnectCta, false);
  assert.equal(model.showReconnectWarning, true);
});

test("resolveGmailConnectionState returns Connecting when connecting", () => {
  const model = resolveGmailConnectionState({
    loading: false,
    connecting: true,
    connected: false,
    reconnectRequired: false,
  });
  assert.equal(model.state, "Connecting");
  assert.equal(model.showConnectCta, false);
});

test("buildGmailConnectionContext maps API connected=true reconnectRequired=false to Connected", () => {
  const model = buildGmailConnectionContext({
    statusKnown: true,
    statusStale: false,
    connecting: false,
    status: {
      connected: true,
      reconnectRequired: false,
    },
  });
  assert.equal(model.state, "Connected");
});

test("buildGmailConnectionContext maps API connected=true reconnectRequired=true to ReconnectRequired", () => {
  const model = buildGmailConnectionContext({
    statusKnown: true,
    statusStale: false,
    connecting: false,
    status: {
      connected: true,
      reconnectRequired: true,
    },
  });
  assert.equal(model.state, "ReconnectRequired");
  assert.equal(model.showConnectCta, false);
});

test("buildGmailConnectionContext maps API connected=false to Disconnected", () => {
  const model = buildGmailConnectionContext({
    statusKnown: true,
    statusStale: false,
    connecting: false,
    status: {
      connected: false,
      reconnectRequired: false,
    },
  });
  assert.equal(model.state, "Disconnected");
  assert.equal(model.showConnectCta, true);
});

test("buildGmailConnectionContext returns Checking before API resolves", () => {
  const model = buildGmailConnectionContext({
    statusKnown: false,
    statusStale: true,
    connecting: false,
    status: null,
  });
  assert.equal(model.state, "Checking");
  assert.equal(model.showConnectCta, false);
});

test("buildGmailConnectionContext keeps evidence verification in Checking not Disconnected", () => {
  const model = buildGmailConnectionContext({
    statusKnown: true,
    statusStale: false,
    connecting: false,
    status: { connected: false, reconnectRequired: false },
    hasGmailActivityEvidence: true,
  });
  assert.equal(model.state, "Checking");
  assert.equal(model.showConnectCta, false);
});
