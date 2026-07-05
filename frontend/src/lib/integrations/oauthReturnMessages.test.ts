import test from "node:test";
import assert from "node:assert/strict";
import { oauthReturnMessage } from "./oauthReturnMessages";

test("oauthReturnMessage: token_already_bound shows a Hebrew danger message (the swallowed-error regression)", () => {
  const result = oauthReturnMessage("?gmail=error&reason=token_already_bound");
  assert.equal(result?.tone, "error");
  assert.equal(result?.provider, "gmail");
  assert.match(result!.text, /כבר מחובר לארגון אחר/);
  assert.match(result!.text, /נתק/);
});

test("oauthReturnMessage: connected stays a success message", () => {
  const gmail = oauthReturnMessage("?gmail=connected");
  assert.equal(gmail?.tone, "success");
  assert.match(gmail!.text, /חובר בהצלחה/);
  const calendar = oauthReturnMessage("?calendar=connected");
  assert.equal(calendar?.provider, "calendar");
  assert.equal(calendar?.tone, "success");
});

test("oauthReturnMessage: invalid_state explains expiry", () => {
  const result = oauthReturnMessage("?gmail=invalid_state");
  assert.equal(result?.tone, "error");
  assert.match(result!.text, /פג תוקף/);
});

test("oauthReturnMessage: unknown reason is surfaced, never swallowed", () => {
  const result = oauthReturnMessage("?gmail=error&reason=some_backend_failure");
  assert.equal(result?.tone, "error");
  assert.match(result!.text, /some_backend_failure/);
  // reason ארוך נחתך — לא שופך stack למסך
  const long = oauthReturnMessage(`?gmail=error&reason=${"x".repeat(500)}`);
  assert.ok(long!.text.length < 220);
});

test("oauthReturnMessage: no oauth params -> null (no message noise)", () => {
  assert.equal(oauthReturnMessage(""), null);
  assert.equal(oauthReturnMessage("?tab=integrations"), null);
  assert.equal(oauthReturnMessage("?gmail=weird_status"), null);
});
