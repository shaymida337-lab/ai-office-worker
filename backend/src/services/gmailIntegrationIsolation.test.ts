import test from "node:test";
import assert from "node:assert/strict";
import {
  assertIntegrationBelongsToOrganization,
  collectMailboxConflicts,
  collectRefreshTokenConflicts,
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

// ─── שערי הבידוד כפונקציות טהורות (token_already_bound) ───

const tokenRows = [
  { id: "i1", organizationId: "org-old", refreshToken: "TOKEN-A" },
  { id: "i2", organizationId: "org-empty", refreshToken: "" },
  { id: "i3", organizationId: "org-null", refreshToken: null },
  { id: "i4", organizationId: "org-other", refreshToken: "TOKEN-B" },
];

test("token gate: same token in another org blocks; own org excluded", () => {
  assert.deepEqual(
    collectRefreshTokenConflicts(tokenRows, "TOKEN-A", { excludeOrganizationId: "org-target" }),
    [{ organizationId: "org-old", integrationId: "i1" }]
  );
  assert.deepEqual(collectRefreshTokenConflicts(tokenRows, "TOKEN-A", { excludeOrganizationId: "org-old" }), []);
});

test("token gate: empty values never block (hardening)", () => {
  assert.deepEqual(collectRefreshTokenConflicts(tokenRows, "", {}), []);
  assert.deepEqual(collectRefreshTokenConflicts(tokenRows, "   ", {}), []);
  assert.deepEqual(collectRefreshTokenConflicts(tokenRows, null, {}), []);
  // שורה עם טוקן ריק ב-DB לעולם לא חוסמת
  assert.deepEqual(
    collectRefreshTokenConflicts([{ id: "x", organizationId: "org-x", refreshToken: "" }], "anything", {}),
    []
  );
});

test("mailbox gate: same account in another org blocks; empty emails never block", () => {
  const mailboxRows = [
    { organizationId: "org-old", metadata: JSON.stringify({ googleAccountEmail: "user@gmail.com" }), refreshToken: "t" },
    { organizationId: "org-legacy", metadata: JSON.stringify({}), refreshToken: "t" },
    { organizationId: "org-nometa", metadata: null, refreshToken: "t" },
    { organizationId: "org-inactive", metadata: JSON.stringify({ googleAccountEmail: "user@gmail.com" }), refreshToken: null },
  ];
  assert.deepEqual(collectMailboxConflicts(mailboxRows, "USER@Gmail.com"), ["org-old"]);
  assert.deepEqual(collectMailboxConflicts(mailboxRows, ""), []);
  assert.deepEqual(collectMailboxConflicts(mailboxRows, null), []);
  assert.deepEqual(collectMailboxConflicts(mailboxRows, "user@gmail.com", "org-old"), []);
});
