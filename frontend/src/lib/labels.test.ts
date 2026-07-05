import test from "node:test";
import assert from "node:assert/strict";
import { labelFor } from "./labels.js";

test("paymentStatus needs_review renders Hebrew label", () => {
  assert.equal(labelFor("paymentStatus", "needs_review"), "דורש בדיקה");
});
