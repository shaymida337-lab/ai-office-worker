import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../lib/config.js";
import { assertOutboundEmailAllowed, GMAIL_SCOPES } from "./google.js";

test("GMAIL_SCOPES do not request Gmail send permissions", () => {
  assert.ok(GMAIL_SCOPES.includes("https://www.googleapis.com/auth/gmail.readonly"));
  assert.ok(GMAIL_SCOPES.includes("https://www.googleapis.com/auth/gmail.labels"));
  assert.ok(GMAIL_SCOPES.includes("https://www.googleapis.com/auth/drive.file"));
  assert.ok(GMAIL_SCOPES.includes("https://www.googleapis.com/auth/spreadsheets"));
  assert.equal(GMAIL_SCOPES.includes("https://www.googleapis.com/auth/gmail.send"), false);
  assert.equal(GMAIL_SCOPES.includes("https://www.googleapis.com/auth/gmail.compose"), false);
  assert.equal(GMAIL_SCOPES.includes("https://mail.google.com/"), false);
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
