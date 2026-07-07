import test from "node:test";
import assert from "node:assert/strict";
import { getChannelAdapter } from "./conversationAdapters.js";

test("whatsapp adapter does not double-append confirmation when answer already asks", () => {
  const adapter = getChannelAdapter("whatsapp");
  const answer = "מצאתי תור לשרית ביום חמישי בשעה 16:00. לבטל אותו?";
  const rendered = adapter.renderDisplay(
    { answer },
    {
      required: true,
      confirmationType: "hard",
      riskLevel: "destructive",
      spokenPrompt: "זו פעולה רגישה. לאשר במפורש?",
      uiPrompt: "פעולה רגישה — לאשר?",
      allowed: true,
    }
  );
  assert.equal(rendered, answer);
  assert.doesNotMatch(rendered, /פעולה רגישה/);
});

test("whatsapp adapter still appends soft prompt when answer has no question", () => {
  const adapter = getChannelAdapter("whatsapp");
  const answer = "הנה הפרטים.";
  const rendered = adapter.renderDisplay(
    { answer },
    {
      required: true,
      confirmationType: "soft",
      riskLevel: "reversible",
      spokenPrompt: "לאשר את הפעולה?",
      uiPrompt: "לאשר?",
      allowed: true,
    }
  );
  assert.equal(rendered, "הנה הפרטים. לאשר?");
});
