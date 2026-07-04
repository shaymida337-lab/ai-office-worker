import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGmailConnectionFromStatus } from "./gmailConnection.js";
import { buildGmailIntegrationStatus } from "./integrationStatus.js";
import { resolveDashboardSyncState } from "../dashboard/dashboardSyncState.js";

describe("gmail connection status regression", () => {
  it("connected API without reconnect maps to Connected canonical state", () => {
    const model = buildGmailConnectionFromStatus(
      {
        googleConfigured: true,
        connected: true,
        connectedAt: new Date().toISOString(),
        reconnectRequired: false,
        missingDriveScopes: [],
      },
      { statusKnown: true, statusStale: false, connecting: false }
    );
    assert.equal(model.state, "Connected");
    assert.equal(model.showReconnectWarning, false);
  });

  it("connected with missing drive scopes only stays Connected (not reconnect required)", () => {
    const status = {
      googleConfigured: true,
      connected: true,
      connectedAt: new Date().toISOString(),
      reconnectRequired: false,
      missingDriveScopes: ["https://www.googleapis.com/auth/drive.file"],
    };
    const model = buildGmailConnectionFromStatus(status, {
      statusKnown: true,
      statusStale: false,
      connecting: false,
    });
    assert.equal(model.state, "Connected");

    const integration = buildGmailIntegrationStatus({
      statusKnown: true,
      statusStale: false,
      connected: true,
      connecting: false,
      scanRunning: false,
      hasWarning: false,
      hasError: false,
      reconnectRequired: false,
      missingDriveScopes: status.missingDriveScopes,
      gmailAddress: "user@gmail.com",
      organizationName: "Test Org",
      lastSuccessfulScanAt: null,
      lastSyncAt: null,
      scannedEmails: null,
      extractedDocuments: null,
      scanStatusLabel: "success",
      connectedSince: status.connectedAt,
      scopesSummary: null,
      lastOauthAt: status.connectedAt,
      lastScanDurationLabel: null,
      lastSyncDurationLabel: null,
    });
    assert.equal(integration.healthState, "warning");
    assert.equal(integration.connectionState, "connected");

    const dashboard = resolveDashboardSyncState({
      gmailConnectionState: "Connected",
      gmailStatusKnown: true,
      scanStatusKnown: true,
      scanRunning: false,
      scanBanner: { status: "success", found: 1, scanned: 1, errors: 0 },
      scanBacklog: false,
      gmailConnected: true,
      missingDriveScopes: status.missingDriveScopes,
    });
    assert.equal(dashboard.status, "WARNING");
    assert.notEqual(dashboard.status, "ERROR");
  });

  it("reconnectRequired maps to ReconnectRequired and dashboard error", () => {
    const model = buildGmailConnectionFromStatus(
      {
        googleConfigured: true,
        connected: true,
        connectedAt: new Date().toISOString(),
        reconnectRequired: true,
      },
      { statusKnown: true, statusStale: false, connecting: false }
    );
    assert.equal(model.state, "ReconnectRequired");
    assert.equal(model.showReconnectWarning, true);

    const dashboard = resolveDashboardSyncState({
      gmailConnectionState: "ReconnectRequired",
      gmailStatusKnown: true,
      scanStatusKnown: true,
      scanRunning: false,
      scanBanner: null,
      scanBacklog: false,
      gmailConnected: true,
    });
    assert.equal(dashboard.status, "ERROR");
  });

  it("disconnected maps to Disconnected", () => {
    const model = buildGmailConnectionFromStatus(
      {
        googleConfigured: true,
        connected: false,
        connectedAt: null,
        reconnectRequired: false,
      },
      { statusKnown: true, statusStale: false, connecting: false }
    );
    assert.equal(model.state, "Disconnected");
    assert.equal(model.showConnectCta, true);
  });

  it("checking while status unknown stays non-error", () => {
    const model = buildGmailConnectionFromStatus(null, {
      statusKnown: false,
      statusStale: false,
      connecting: false,
    });
    assert.equal(model.state, "Checking");
    const dashboard = resolveDashboardSyncState({
      gmailConnectionState: "Checking",
      scanRunning: false,
      scanBanner: null,
      scanBacklog: false,
      gmailConnected: false,
    });
    assert.equal(dashboard.status, "CHECKING");
  });

  it("sync in progress shows syncing dashboard state", () => {
    const dashboard = resolveDashboardSyncState({
      gmailConnectionState: "Connected",
      gmailStatusKnown: true,
      scanStatusKnown: true,
      scanRunning: true,
      scanBanner: { status: "running", found: 2, scanned: 5, errors: 0 },
      scanBacklog: false,
      gmailConnected: true,
    });
    assert.equal(dashboard.status, "SYNCING");
  });
});
