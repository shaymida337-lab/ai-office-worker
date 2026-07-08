import test from "node:test";
import assert from "node:assert/strict";
import {
  recoverPendingPrompt,
  toHydratedWidgetMessages,
  type ConversationTurnSnapshot,
} from "./sessionHydration";

test("toHydratedWidgetMessages restores pending confirmation status", () => {
  const turns: ConversationTurnSnapshot[] = [
    {
      id: "t1",
      role: "assistant",
      text: "רצית לקבוע תור?",
      action: "book_appointment",
      proposal: { clientName: "רון", dayReference: "יום חמישי", time: "16:00" },
      confirmationState: "pending",
      at: new Date().toISOString(),
    },
  ];
  const messages = toHydratedWidgetMessages(turns);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.actionStatus, "pending");
  assert.equal(messages[0]?.action, "book_appointment");
});

test("recoverPendingPrompt appends pending confirmation when UI missing it", () => {
  const recovered = recoverPendingPrompt(
    [{ id: "m1", sender: "user", text: "כן" }],
    {
      action: "book_appointment",
      proposal: { clientName: "רון", dayReference: "יום חמישי", time: "16:00" },
      uiPrompt: "רצית לקבוע פגישה עם רון ביום חמישי ב-16:00. האם לאשר?",
    },
    null
  );
  assert.equal(recovered.length, 2);
  assert.equal(recovered[1]?.actionStatus, "pending");
  assert.match(recovered[1]?.text ?? "", /האם לאשר/);
});

test("recoverPendingPrompt appends pending action follow-up question", () => {
  const recovered = recoverPendingPrompt(
    [{ id: "m1", sender: "user", text: "תבטלי תור" }],
    null,
    {
      action: "calendar_intent_continuation",
      proposal: {
        intent: {
          lastAssistantQuestion: "באיזו שעה?",
        },
      },
    }
  );
  assert.equal(recovered.length, 2);
  assert.equal(recovered[1]?.text, "באיזו שעה?");
});
