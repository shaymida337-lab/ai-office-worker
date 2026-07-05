import test from "node:test";
import assert from "node:assert/strict";

import { getClientDeliverableEmail } from "./clientContact.js";

test("green invoice payload omits placeholder client email", () => {
  const deliverable = getClientDeliverableEmail({
    email: "natalie-test@scheduling.local",
    emailIsPlaceholder: true,
  });
  assert.equal(deliverable, null);
});

test("notification helpers skip clients without deliverable email", () => {
  assert.equal(getClientDeliverableEmail({ email: null }), null);
  assert.equal(getClientDeliverableEmail({ email: "david@example.com", emailIsPlaceholder: false }), "david@example.com");
});
