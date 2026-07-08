import test from "node:test";
import assert from "node:assert/strict";
import { parseVoiceConfirmationIntent } from "./voiceConfirmation.js";

test("confirmation parser accepts richer affirmative Hebrew variants", () => {
  assert.equal(parseVoiceConfirmationIntent("כן"), "accept");
  assert.equal(parseVoiceConfirmationIntent("כן בבקשה"), "accept");
  assert.equal(parseVoiceConfirmationIntent("תאשר"), "accept");
  assert.equal(parseVoiceConfirmationIntent("בדיוק"), "accept");
  assert.equal(parseVoiceConfirmationIntent("מעולה"), "accept");
});

test("confirmation parser keeps correction phrases out of hard reject", () => {
  assert.equal(parseVoiceConfirmationIntent("לא"), "reject");
  assert.equal(parseVoiceConfirmationIntent("לא, ביום שישי"), "none");
  assert.equal(parseVoiceConfirmationIntent("לא רון, נועם"), "none");
});
