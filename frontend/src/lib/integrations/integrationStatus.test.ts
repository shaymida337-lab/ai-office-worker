import assert from "node:assert/strict";
import test from "node:test";
import { buildGmailIntegrationStatus } from "./integrationStatus";

test("buildGmailIntegrationStatus returns disconnected state with connect guidance", () => {
  const model = buildGmailIntegrationStatus({
    statusKnown: true,
    statusStale: false,
    connected: false,
    connecting: false,
    scanRunning: false,
    hasWarning: false,
    hasError: false,
    reconnectRequired: false,
    gmailAddress: null,
    organizationName: "Alpha Org",
    lastSuccessfulScanAt: null,
    lastSyncAt: null,
    scannedEmails: null,
    extractedDocuments: null,
    scanStatusLabel: "לא פעיל",
    connectedSince: null,
    scopesSummary: null,
    lastOauthAt: null,
    lastScanDurationLabel: null,
    lastSyncDurationLabel: null,
  });

  assert.equal(model.connectionState, "disconnected");
  assert.equal(model.metrics.length, 0);
  assert.equal(model.badges.length, 0);
});

test("buildGmailIntegrationStatus returns connecting state and pending status", () => {
  const model = buildGmailIntegrationStatus({
    statusKnown: true,
    statusStale: false,
    connected: false,
    connecting: true,
    scanRunning: false,
    hasWarning: false,
    hasError: false,
    reconnectRequired: false,
    gmailAddress: null,
    organizationName: "Alpha Org",
    lastSuccessfulScanAt: null,
    lastSyncAt: null,
    scannedEmails: null,
    extractedDocuments: null,
    scanStatusLabel: "לא פעיל",
    connectedSince: null,
    scopesSummary: null,
    lastOauthAt: null,
    lastScanDurationLabel: null,
    lastSyncDurationLabel: null,
  });

  assert.equal(model.connectionState, "connecting");
  assert.equal(model.syncState, "syncing");
  assert.equal(model.title, "מחבר את Gmail...");
});

test("buildGmailIntegrationStatus returns warning when reconnect required", () => {
  const model = buildGmailIntegrationStatus({
    statusKnown: true,
    statusStale: false,
    connected: true,
    connecting: false,
    scanRunning: false,
    hasWarning: false,
    hasError: false,
    reconnectRequired: true,
    gmailAddress: "user@gmail.com",
    organizationName: "Alpha Org",
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
    statusKnown: true,
    statusStale: false,
    connected: true,
    connecting: false,
    scanRunning: true,
    hasWarning: false,
    hasError: false,
    reconnectRequired: false,
    gmailAddress: "user@gmail.com",
    organizationName: "Alpha Org",
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
    statusKnown: true,
    statusStale: false,
    connected: true,
    connecting: false,
    scanRunning: false,
    hasWarning: false,
    hasError: true,
    reconnectRequired: false,
    gmailAddress: "user@gmail.com",
    organizationName: "Alpha Org",
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
    statusKnown: false,
    statusStale: true,
    connected: false,
    connecting: false,
    scanRunning: false,
    hasWarning: false,
    hasError: false,
    reconnectRequired: false,
    gmailAddress: null,
    organizationName: "Alpha Org",
    lastSuccessfulScanAt: null,
    lastSyncAt: null,
    scannedEmails: null,
    extractedDocuments: null,
    scanStatusLabel: "לא ידוע",
    connectedSince: null,
    scopesSummary: null,
    lastOauthAt: null,
    lastScanDurationLabel: null,
    lastSyncDurationLabel: null,
  });

  assert.equal(model.title, "בודק חיבור Gmail...");
  assert.equal(model.connectionState, "connecting");
});

test("buildGmailIntegrationStatus returns ambiguous checking state when Gmail documents exist", () => {
  const model = buildGmailIntegrationStatus({
    statusKnown: true,
    statusStale: false,
    connected: false,
    connectionAmbiguous: true,
    connecting: false,
    scanRunning: false,
    hasWarning: false,
    hasError: false,
    reconnectRequired: false,
    gmailAddress: null,
    organizationName: "Alpha Org",
    lastSuccessfulScanAt: null,
    lastSyncAt: null,
    scannedEmails: null,
    extractedDocuments: 5,
    scanStatusLabel: "הושלם",
    connectedSince: null,
    scopesSummary: null,
    lastOauthAt: null,
    lastScanDurationLabel: null,
    lastSyncDurationLabel: null,
  });

  assert.equal(model.title, "נמצאו מסמכים מ-Gmail");
  assert.equal(model.connectionState, "connecting");
  assert.equal(model.metrics.find((item) => item.key === "docs")?.value, "5");
});
