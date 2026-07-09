import assert from "node:assert/strict";
import test from "node:test";
import { interpretReminderReply } from "./responseInterpreter.js";

test("interpreter handles button payloads", () => {
  assert.equal(interpretReminderReply({ buttonPayload: "confirm" }), "confirm");
  assert.equal(interpretReminderReply({ buttonPayload: "decline" }), "decline");
  assert.equal(interpretReminderReply({ buttonPayload: "reschedule" }), "reschedule_request");
});

test("interpreter handles Hebrew and English free text", () => {
  assert.equal(interpretReminderReply({ text: "אני מאשר" }), "confirm");
  assert.equal(interpretReminderReply({ text: "I confirm" }), "confirm");
  assert.equal(interpretReminderReply({ text: "אני מבטל" }), "decline");
  assert.equal(interpretReminderReply({ text: "אפשר לדחות?" }), "reschedule_request");
  assert.equal(interpretReminderReply({ text: "סבבה" }), "unknown");
});
