import test from "node:test";
import assert from "node:assert/strict";
import { decideClientGmailJunkAction } from "./clientGmailSync.js";

test("client Gmail junk action drops certain junk", () => {
  const result = decideClientGmailJunkAction({
    subject: "Security alert",
    body: "A new sign-in was detected.",
    sender: "no-reply@example.com",
    attachmentFilenames: [],
    junkDecision: {
      bucket: "CERTAIN_JUNK",
      reason: "no_reply_system_alert",
      blocklisted: false,
    },
  });

  assert.equal(result, "drop");
});

test("client Gmail junk action routes unsure messages to review", () => {
  const result = decideClientGmailJunkAction({
    subject: "Documents",
    body: "See attached.",
    sender: "unknown@example.com",
    attachmentFilenames: ["document.pdf"],
    junkDecision: {
      bucket: "UNSURE",
      reason: "unknown_sender_with_attachment",
      blocklisted: false,
    },
  });

  assert.equal(result, "review");
});

test("client Gmail junk action lets clean messages proceed", () => {
  const result = decideClientGmailJunkAction({
    subject: "Invoice INV-1001",
    body: "Attached is the invoice for your service.",
    sender: "billing@supplier.example",
    attachmentFilenames: ["invoice-1001.pdf"],
    junkDecision: {
      bucket: "REAL",
      reason: "business_document_signal",
      blocklisted: false,
    },
  });

  assert.equal(result, "proceed");
});
