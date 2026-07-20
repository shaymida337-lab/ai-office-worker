import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../lib/config.js";
import {
  assertOutboundEmailAllowed,
  CALENDAR_SCOPES,
  GMAIL_SCOPES,
  googleOAuthMetadata,
  hasGoogleCalendarReadScopes,
} from "./google.js";

test("GMAIL_SCOPES do not request Gmail send permissions", () => {
  assert.ok(GMAIL_SCOPES.includes("https://www.googleapis.com/auth/gmail.readonly"));
  assert.ok(GMAIL_SCOPES.includes("https://www.googleapis.com/auth/drive.file"));
  assert.equal(GMAIL_SCOPES.includes("https://www.googleapis.com/auth/gmail.labels"), false);
  assert.equal(GMAIL_SCOPES.includes("https://www.googleapis.com/auth/spreadsheets"), false);
  assert.equal(GMAIL_SCOPES.includes("https://www.googleapis.com/auth/gmail.send"), false);
  assert.equal(GMAIL_SCOPES.includes("https://www.googleapis.com/auth/gmail.compose"), false);
  assert.equal(GMAIL_SCOPES.includes("https://mail.google.com/"), false);
});

test("CALENDAR_SCOPES already include Google Calendar event read/write", () => {
  assert.ok(CALENDAR_SCOPES.includes("https://www.googleapis.com/auth/calendar.events"));
  assert.ok(CALENDAR_SCOPES.includes("https://www.googleapis.com/auth/calendar"));
  assert.equal(hasGoogleCalendarReadScopes(CALENDAR_SCOPES), true);
});

test("hasGoogleCalendarReadScopes accepts readonly scopes", () => {
  assert.equal(
    hasGoogleCalendarReadScopes(["https://www.googleapis.com/auth/calendar.readonly"]),
    true
  );
  assert.equal(hasGoogleCalendarReadScopes(["openid"]), false);
});

test("listGoogleCalendarEventsInRange soft-fails on hung Google client (timeout)", async () => {
  const { listGoogleCalendarEventsInRange } = await import("./google.js");
  const { prisma } = await import("../lib/prisma.js");

  const originalFind = prisma.integration.findUnique.bind(prisma.integration);
  prisma.integration.findUnique = (async () => ({
    refreshToken: "rt",
    metadata: JSON.stringify({
      googleOAuthScopes: ["https://www.googleapis.com/auth/calendar"],
      calendarId: "primary",
    }),
  })) as typeof prisma.integration.findUnique;

  // Force getCalendarClientForOrganization path to hang via a never-resolving dynamic import proxy:
  // stub by making findUnique for the full client also hang when code path hits decrypt/load.
  // Simpler: hang at first integration lookup used by unbounded path after public API race starts.
  // Replace with a hung get by delaying the initial findUnique beyond the race.
  prisma.integration.findUnique = (async () =>
    new Promise(() => {
      /* never resolves — exercise GOOGLE_CALENDAR_READ_TIMEOUT */
    })) as typeof prisma.integration.findUnique;

  try {
    const started = Date.now();
    const result = await listGoogleCalendarEventsInRange("org-timeout", {
      start: new Date("2026-07-08T00:00:00.000Z"),
      end: new Date("2026-07-09T00:00:00.000Z"),
    });
    const elapsed = Date.now() - started;
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "timeout");
      assert.match(result.messageHe, /Google/);
    }
    assert.ok(elapsed < 8_000, `timeout too slow: ${elapsed}ms`);
  } finally {
    prisma.integration.findUnique = originalFind;
  }
});

test("outbound email sends are blocked unless explicitly enabled", () => {
  const originalAllowSend = config.outboundEmail.allowSend;
  const originalWarn = console.warn;
  const warnings: string[] = [];

  try {
    config.outboundEmail.allowSend = false;
    console.warn = (message?: unknown, ...optionalParams: unknown[]) => {
      warnings.push([message, ...optionalParams].map(String).join(" "));
    };

    assert.throws(
      () =>
        assertOutboundEmailAllowed({
          provider: "gmail",
          feature: "test",
          organizationId: "org_123",
          recipientDomain: "example.com",
        }),
      /Outbound email sending is disabled/
    );
    assert.ok(warnings.some((warning) => warning.includes("SECURITY_EMAIL_SEND_ATTEMPT_BLOCKED")));
    assert.ok(warnings.some((warning) => warning.includes('"recipientDomain":"example.com"')));
  } finally {
    config.outboundEmail.allowSend = originalAllowSend;
    console.warn = originalWarn;
  }
});

test("googleOAuthMetadata: null/empty scope response preserves existing scopes (reconnect bug)", () => {
  const existing = googleOAuthMetadata(null, "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.file");

  // גוגל לא החזירה scope בתשובת הטוקן — ה-scopes הקיימים חייבים להישמר,
  // אחרת reconnectRequired נדלק לצמיתות אחרי חיבור-מחדש מוצלח.
  for (const emptyInput of [null, undefined, "", "   "]) {
    const merged = JSON.parse(googleOAuthMetadata(existing, emptyInput as string | null | undefined));
    assert.deepEqual(
      merged.googleOAuthScopes,
      ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/drive.file"],
      `empty scope input (${JSON.stringify(emptyInput)}) must preserve existing scopes`
    );
  }
});

test("googleOAuthMetadata: real scope response still fully overwrites (incl. narrowing)", () => {
  const existing = googleOAuthMetadata(null, "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.file");

  const updated = JSON.parse(googleOAuthMetadata(existing, "https://www.googleapis.com/auth/gmail.readonly"));
  assert.deepEqual(updated.googleOAuthScopes, ["https://www.googleapis.com/auth/gmail.readonly"]);
});

test("googleOAuthMetadata: no existing scopes + empty input stays empty (no invented grants)", () => {
  const result = JSON.parse(googleOAuthMetadata(null, null));
  assert.deepEqual(result.googleOAuthScopes, []);
});

test("googleOAuthMetadata: calendar delegation pattern — merge protects both callers", () => {
  // googleCalendarIntegrationMetadata (integrations.ts) מאציל לפונקציה הזו —
  // התיקון בנקודה האחת מגן גם על מסלול ה-Calendar callback שמעביר tokens.scope ?? null.
  const existing = JSON.stringify({
    ...JSON.parse(googleOAuthMetadata(null, "openid email https://www.googleapis.com/auth/calendar")),
    calendarId: "primary",
  });
  const merged = JSON.parse(googleOAuthMetadata(existing, null));
  assert.deepEqual(merged.googleOAuthScopes, ["openid", "email", "https://www.googleapis.com/auth/calendar"]);
  assert.equal(merged.calendarId, "primary");
});
