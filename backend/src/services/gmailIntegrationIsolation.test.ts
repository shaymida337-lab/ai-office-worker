import test from "node:test";
import assert from "node:assert/strict";
import {
  assertIntegrationBelongsToOrganization,
  GmailIntegrationIsolationError,
  hashGmailRefreshToken,
} from "./gmailIntegrationIsolation.js";

test("hashGmailRefreshToken is stable and distinct per token", () => {
  const a = hashGmailRefreshToken("refresh-token-a");
  const b = hashGmailRefreshToken("refresh-token-b");
  const aAgain = hashGmailRefreshToken("refresh-token-a");

  assert.equal(a, aAgain);
  assert.notEqual(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("assertIntegrationBelongsToOrganization passes when org matches", () => {
  assert.doesNotThrow(() =>
    assertIntegrationBelongsToOrganization({ organizationId: "org_a" }, "org_a")
  );
});

test("assertIntegrationBelongsToOrganization throws on org mismatch", () => {
  assert.throws(
    () => assertIntegrationBelongsToOrganization({ organizationId: "org_b" }, "org_a"),
    (err: unknown) => {
      assert.ok(err instanceof GmailIntegrationIsolationError);
      assert.equal(err.organizationId, "org_a");
      assert.equal(err.details.integrationOrganizationId, "org_b");
      return true;
    }
  );
});
