import test from "node:test";
import assert from "node:assert/strict";

import { buildLegacyDuplicateHashForGmailLookup } from "./fingerprintMigration.js";

test("buildLegacyDuplicateHashForGmailLookup avoids zero-amount hash collisions", () => {
  const withAmount = buildLegacyDuplicateHashForGmailLookup({
    organizationId: "org-1",
    supplier: "Acme",
    totalAmount: 120,
    dateIso: "2026-06-01T00:00:00.000Z",
    subject: "invoice",
    gmailMessageId: "abc123",
  });
  const withoutAmountA = buildLegacyDuplicateHashForGmailLookup({
    organizationId: "org-1",
    supplier: "Acme",
    totalAmount: null,
    dateIso: "2026-06-01T00:00:00.000Z",
    subject: "invoice",
    gmailMessageId: "abc123",
  });
  const withoutAmountB = buildLegacyDuplicateHashForGmailLookup({
    organizationId: "org-1",
    supplier: "Acme",
    totalAmount: null,
    dateIso: "2026-06-01T00:00:00.000Z",
    subject: "invoice",
    gmailMessageId: "xyz789",
  });
  assert.notEqual(withAmount, withoutAmountA);
  assert.notEqual(withoutAmountA, withoutAmountB);
});
