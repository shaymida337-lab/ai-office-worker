import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationRequestsGmailScan,
  conversationRequestsScanProgress,
  resolveActionMessageTone,
} from "./dashboardActionFeedback.js";

test("payment failure message is danger not success", () => {
  assert.equal(resolveActionMessageTone("עדכון תשלום נכשל"), "danger");
  assert.equal(resolveActionMessageTone("צירוף חשבונית נכשל"), "danger");
});

test("payment success message stays success", () => {
  assert.equal(resolveActionMessageTone("התשלום סומן כשולם"), "success");
  assert.equal(resolveActionMessageTone("החשבונית צורפה לתשלום"), "success");
});

test("סרוק keyword starts a scan (not only סרק stem)", () => {
  assert.equal(conversationRequestsGmailScan("סרוק את המייל"), true);
  assert.equal(conversationRequestsGmailScan("סרקי את Gmail"), true);
  assert.equal(conversationRequestsGmailScan("מה דחוף היום?"), false);
});

test("progress keyword detects scan progress requests", () => {
  assert.equal(conversationRequestsScanProgress("הצג התקדמות סריקה"), true);
  assert.equal(conversationRequestsScanProgress("מה עם התשלומים"), false);
});
