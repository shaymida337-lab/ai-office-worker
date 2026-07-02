import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeCalendarAuditMetadata } from "./calendarAudit.js";

test("sanitizeCalendarAuditMetadata redacts secrets and keeps safe fields", () => {
  const metadata = sanitizeCalendarAuditMetadata({
    accessToken: "abc",
    refreshToken: "xyz",
    idempotencyKey: "idem-1",
    customerName: "Dana",
  });
  assert.equal(metadata?.accessToken, "[REDACTED]");
  assert.equal(metadata?.refreshToken, "[REDACTED]");
  assert.equal(metadata?.idempotencyKey, "idem-1");
  assert.equal(metadata?.customerName, "Dana");
});

