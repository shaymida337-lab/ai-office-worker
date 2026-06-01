import test from "node:test";
import assert from "node:assert/strict";
import { classifyJunk, shouldAutoClassifyAfterJunkFilter } from "./junkFilter.js";

test("no-reply security alert is certain junk", () => {
  const result = classifyJunk({
    sender: "no-reply@example.com",
    subject: "Security alert: new sign-in",
    body: "A new sign-in was detected for your account.",
    channel: "gmail",
  });

  assert.equal(result.bucket, "CERTAIN_JUNK");
  assert.equal(result.reason, "no_reply_system_alert");
  assert.equal(result.blocklisted, false);
});

test("Render deployment notification is certain junk", () => {
  const result = classifyJunk({
    sender: "notifications@render.com",
    subject: "Deployment failed for backend",
    body: "Your service failed to deploy.",
    channel: "gmail",
  });

  assert.equal(result.bucket, "CERTAIN_JUNK");
  assert.equal(result.reason, "technical_platform_system_notification");
});

test("pure marketing newsletter is certain junk", () => {
  const result = classifyJunk({
    sender: "newsletter@vendor.example",
    subject: "Big sale this week",
    body: "Promotion newsletter. Unsubscribe here.",
    channel: "gmail",
  });

  assert.equal(result.bucket, "CERTAIN_JUNK");
  assert.equal(result.reason, "pure_marketing_newsletter");
});

test("real customer message proceeds as real", () => {
  const result = classifyJunk({
    sender: "moshe@example.co.il",
    subject: "Need a quote",
    body: "Can you send a proposal for next week?",
    channel: "gmail",
  });

  assert.equal(result.bucket, "REAL");
  assert.equal(result.reason, "customer_action_signal");
});

test("real supplier invoice proceeds as real", () => {
  const result = classifyJunk({
    sender: "billing@supplier.example",
    subject: "Invoice INV-1001",
    body: "Attached is the invoice for your service.",
    channel: "gmail",
    attachmentFilenames: ["invoice-1001.pdf"],
  });

  assert.equal(result.bucket, "REAL");
  assert.equal(result.reason, "business_document_signal");
});

test("ambiguous unknown sender with document goes to review", () => {
  const result = classifyJunk({
    sender: "unknown@example.com",
    subject: "Documents",
    body: "See attached.",
    channel: "gmail",
    attachmentFilenames: ["document.pdf"],
  });

  assert.equal(result.bucket, "UNSURE");
  assert.equal(result.reason, "unknown_sender_with_attachment");
  assert.equal(result.blocklisted, false);
});

test("bank statement is blocklisted and not auto-classified", () => {
  const result = classifyJunk({
    sender: "statements@bank.example",
    subject: "Monthly bank statement",
    body: "Your bank statement is ready.",
    channel: "gmail",
    attachmentFilenames: ["statement.pdf"],
  });

  assert.equal(result.bucket, "UNSURE");
  assert.equal(result.reason, "blocklisted_financial_or_government_sender");
  assert.equal(result.blocklisted, true);
});

test("government no-reply notification is blocklisted", () => {
  const result = classifyJunk({
    sender: "no-reply@gov.il",
    subject: "הודעה ממשלתית",
    body: "יש להיכנס לאזור האישי לצפייה בהודעה.",
    channel: "gmail",
  });

  assert.equal(result.bucket, "UNSURE");
  assert.equal(result.blocklisted, true);
});

test("pipeline gate blocks certain junk before auto classification", () => {
  const result = classifyJunk({
    sender: "no-reply@example.com",
    subject: "Password reset",
    body: "Reset your password.",
    channel: "gmail",
  });

  assert.equal(shouldAutoClassifyAfterJunkFilter(result), false);
});

test("pipeline gate lets real messages reach classification", () => {
  const result = classifyJunk({
    sender: "client@example.com",
    subject: "Need help with an order",
    body: "Please call me about a new order.",
    channel: "gmail",
  });

  assert.equal(result.bucket, "REAL");
  assert.equal(shouldAutoClassifyAfterJunkFilter(result), true);
});

test("pipeline gate sends unsure messages to review instead of auto classification", () => {
  const result = classifyJunk({
    sender: "unknown@example.com",
    subject: "Document",
    body: "Attached.",
    channel: "gmail",
    attachmentFilenames: ["document.pdf"],
  });

  assert.equal(result.bucket, "UNSURE");
  assert.equal(shouldAutoClassifyAfterJunkFilter(result), false);
});
