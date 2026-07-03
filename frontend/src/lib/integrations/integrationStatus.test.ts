import assert from "node:assert/strict";
import test from "node:test";
import { buildGmailIntegrationStatus } from "./integrationStatus";

const baseInput = {
  statusStale: false,
  scanRunning: false,
  hasScanWarning: false,
  hasError: false,
  gmailAddress: null as string | null,
  organizationName: "Alpha Org",
  lastSuccessfulScanAt: null as string | null,
  lastSyncAt: null as string | null,
  scannedEmails: null as number | null,
  extractedDocuments: null as number | null,
  scanStatusLabel: "לא פעיל",
  connectedSince: null as string | null,
  scopesSummary: null as string | null,
  lastOauthAt: null as string | null,
  lastScanDurationLabel: null as string | null,
  lastSyncDurationLabel: null as string | null,
};

test("buildGmailIntegrationStatus returns disconnected state with connect guidance", () => {
  const model = buildGmailIntegrationStatus({
    ...baseInput,
    gmailConnectionState: "Disconnected",
  });

  assert.equal(model.connectionState, "disconnected");
  assert.equal(model.metrics.length, 0);
  assert.equal(model.badges.length, 0);
});

test("buildGmailIntegrationStatus returns connecting state and pending status", () => {
  const model = buildGmailIntegrationStatus({
    ...baseInput,
    gmailConnectionState: "Connecting",
  });

  assert.equal(model.connectionState, "connecting");
  assert.equal(model.syncState, "syncing");
  assert.equal(model.title, "מחבר את Gmail...");
});

test("buildGmailIntegrationStatus returns warning when reconnect required", () => {
  const model = buildGmailIntegrationStatus({
    ...baseInput,
    gmailConnectionState: "ReconnectRequired",
    gmailAddress: "user@gmail.com",
    lastSuccessfulScanAt: "2026-07-02T09:00:00.000Z",
    lastSyncAt: "2026-07-02T09:04:00.000Z",
    scannedEmails: 120,
    extractedDocuments: 44,
    scanStatusLabel: "הושלם",
    connectedSince: "2026-06-02T09:00:00.000Z",
    scopesSummary: "gmail.readonly, drive.file",
    lastOauthAt: "2026-06-02T09:00:00.000Z",
    lastScanDurationLabel: "2 דקות",
    lastSyncDurationLabel: "10 שניות",
  });

  assert.equal(model.healthState, "warning");
  assert.equal(model.details.find((item) => item.key === "syncHealth")?.value, "אזהרה");
});

test("buildGmailIntegrationStatus returns scanning state while scan running", () => {
  const model = buildGmailIntegrationStatus({
    ...baseInput,
    gmailConnectionState: "Connected",
    scanRunning: true,
    gmailAddress: "user@gmail.com",
    lastSuccessfulScanAt: "2026-07-02T09:00:00.000Z",
    lastSyncAt: "2026-07-02T09:04:00.000Z",
    scannedEmails: 120,
    extractedDocuments: 44,
    scanStatusLabel: "רץ",
    connectedSince: "2026-06-02T09:00:00.000Z",
    scopesSummary: "gmail.readonly, drive.file",
    lastOauthAt: "2026-06-02T09:00:00.000Z",
    lastScanDurationLabel: "2 דקות",
    lastSyncDurationLabel: "10 שניות",
  });

  assert.equal(model.syncState, "syncing");
  assert.equal(model.description, "סורק מיילים...");
});

test("buildGmailIntegrationStatus returns error state with explicit failure", () => {
  const model = buildGmailIntegrationStatus({
    ...baseInput,
    gmailConnectionState: "Connected",
    hasError: true,
    gmailAddress: "user@gmail.com",
    lastSuccessfulScanAt: "2026-07-02T09:00:00.000Z",
    lastSyncAt: "2026-07-02T09:04:00.000Z",
    scannedEmails: 120,
    extractedDocuments: 44,
    scanStatusLabel: "נכשל",
    connectedSince: "2026-06-02T09:00:00.000Z",
    scopesSummary: "gmail.readonly, drive.file",
    lastOauthAt: "2026-06-02T09:00:00.000Z",
    lastScanDurationLabel: "2 דקות",
    lastSyncDurationLabel: "10 שניות",
  });

  assert.equal(model.healthState, "error");
  assert.equal(model.details.find((item) => item.key === "syncHealth")?.value, "שגיאה");
  assert.equal(model.details.find((item) => item.key === "status")?.value, "החיבור נכשל");
});

test("buildGmailIntegrationStatus returns checking state when status is unknown", () => {
  const model = buildGmailIntegrationStatus({
    ...baseInput,
    gmailConnectionState: "Checking",
    statusStale: true,
    scanStatusLabel: "לא ידוע",
  });

  assert.equal(model.title, "בודק חיבור Gmail...");
  assert.equal(model.connectionState, "connecting");
});

test("buildGmailIntegrationStatus returns checking state during evidence verification", () => {
  const model = buildGmailIntegrationStatus({
    ...baseInput,
    gmailConnectionState: "Checking",
    extractedDocuments: 5,
    scanStatusLabel: "הושלם",
  });

  assert.equal(model.title, "בודק חיבור Gmail...");
  assert.equal(model.connectionState, "connecting");
});
