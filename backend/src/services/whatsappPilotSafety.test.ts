import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { validateRequest } from "twilio";
import twilio from "twilio";

import { config } from "../lib/config.js";
import {
  createInboundWhatsAppLogOnce,
  handleUnmappedWhatsAppSender,
  shouldContinueAfterWhatsAppJunkGate,
  verifyTwilioWebhookSignature,
} from "../routes/webhooks.js";
import {
  buildWhatsAppWebhookLogContext,
  maskBodyPreviewForLog,
  maskSupplierForLog,
  maskWhatsAppPhoneForLog,
  WHATSAPP_MEDIA_DOWNLOAD_FAILED_MESSAGE,
  WHATSAPP_UNMAPPED_SENDER_MESSAGE,
} from "../services/whatsappSafety.js";
import { evaluateFinanceTrustGates } from "../services/trust/financeTrustPersistence.js";
import { pipelineActionForClassification } from "../services/classification/classifier.js";
import { classifyJunk, shouldAutoClassifyAfterJunkFilter } from "../services/classification/junkFilter.js";
import { hasWhatsAppMediaEvidence } from "../routes/webhooks.js";

function twilioTestSignature(url: string, params: Record<string, string>, authToken: string) {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

function createFakeWhatsAppLogStore() {
  const logs: Array<{ id: string } & Record<string, unknown>> = [];
  return {
    logs,
    store: {
      whatsAppLog: {
        async findFirst(args: { where: Record<string, unknown> }) {
          const where = args.where;
          return (
            logs.find(
              (log) =>
                log.organizationId === where.organizationId &&
                log.direction === where.direction &&
                log.providerMessageSid === where.providerMessageSid
            ) ?? null
          );
        },
        async create(args: { data: Record<string, unknown> }) {
          const created = { id: `log-${logs.length + 1}`, ...args.data };
          logs.push(created);
          return { id: created.id };
        },
      },
    },
  };
}

test("WhatsApp webhook verification accepts valid Twilio signature", () => {
  const authToken = "test_auth_token_123";
  const previous = config.twilio.authToken;
  config.twilio.authToken = authToken;
  try {
    const url = "https://example.com/webhook/whatsapp";
    const body = { Body: "שלום", From: "whatsapp:+972501234567", To: "whatsapp:+14155238886" };
    const signature = twilioTestSignature(url, body, authToken);
    const req = {
      headers: { host: "example.com", "x-forwarded-proto": "https" },
      protocol: "https",
      originalUrl: "/webhook/whatsapp",
      body,
    } as Parameters<typeof verifyTwilioWebhookSignature>[0];

    assert.equal(verifyTwilioWebhookSignature(req, signature), true);
    assert.equal(validateRequest(authToken, signature, url, body), true);
  } finally {
    config.twilio.authToken = previous;
  }
});

test("WhatsApp webhook verification rejects invalid signature", () => {
  const authToken = "test_auth_token_123";
  const previous = config.twilio.authToken;
  config.twilio.authToken = authToken;
  try {
    const req = {
      headers: { host: "example.com", "x-forwarded-proto": "https" },
      protocol: "https",
      originalUrl: "/webhook/whatsapp",
      body: { Body: "שלום", From: "whatsapp:+972501234567" },
    } as Parameters<typeof verifyTwilioWebhookSignature>[0];
    assert.equal(verifyTwilioWebhookSignature(req, "invalid-signature"), false);
  } finally {
    config.twilio.authToken = previous;
  }
});

test("duplicate WhatsApp message does not double-create inbound log", async () => {
  const fake = createFakeWhatsAppLogStore();
  const input = {
    organizationId: "org-whatsapp",
    body: "חשבונית",
    fromNumber: "whatsapp:+972501111111",
    toNumber: "whatsapp:+14155238886",
    providerMessageSid: "SM-DUP-1",
    mediaCount: 0,
    mediaJson: [],
  };

  const first = await createInboundWhatsAppLogOnce(input, fake.store);
  const second = await createInboundWhatsAppLogOnce(input, fake.store);

  assert.equal(first.created, true);
  assert.equal(second.duplicate, true);
  assert.equal(fake.logs.length, 1);
  assert.equal(fake.logs[0]?.organizationId, "org-whatsapp");
});

test("unmapped WhatsApp sender does not write inbound logs", async () => {
  const fake = createFakeWhatsAppLogStore();
  const twiml = new twilio.twiml.MessagingResponse();
  const previousAutoReply = config.twilio.autoReplyEnabled;
  config.twilio.autoReplyEnabled = true;
  let responseBody = "";
  const res = {
    type() {
      return res;
    },
    send(body: string) {
      responseBody = body;
      return res;
    },
  } as Parameters<typeof handleUnmappedWhatsAppSender>[0]["res"];

  try {
    await handleUnmappedWhatsAppSender({
      twiml,
      res,
      messageSid: "SM-UNMAPPED",
      normalizedFrom: "whatsapp:+972509999999",
      normalizedTo: "whatsapp:+14155238886",
    });
    assert.equal(fake.logs.length, 0);
    assert.match(responseBody, new RegExp(WHATSAPP_UNMAPPED_SENDER_MESSAGE));
  } finally {
    config.twilio.autoReplyEnabled = previousAutoReply;
  }
});

test("low-trust WhatsApp finance evaluation blocks supplier payment creation", () => {
  const evaluation = evaluateFinanceTrustGates({
    parsedFieldsJson: null,
    selectedAmount: null,
    needsReview: true,
    documentType: "invoice",
    confidenceScore: 0.4,
  });
  assert.equal(evaluation.shouldCreatePayment, false);
});

test("classifier NEEDS_REVIEW pipeline action does not imply supplier expense auto-save", () => {
  const action = pipelineActionForClassification({
    decision: "NEEDS_REVIEW",
    direction: "OUTGOING",
    party: "SUPPLIER",
    isRealSupplier: "UNSURE",
    reason: "ambiguous_sender",
  });
  assert.equal(action, "NEEDS_REVIEW");
});

test("inbound WhatsApp log write always includes organizationId", async () => {
  const fake = createFakeWhatsAppLogStore();
  await createInboundWhatsAppLogOnce(
    {
      organizationId: "org-required",
      body: "test",
      fromNumber: "whatsapp:+972501111111",
      toNumber: "whatsapp:+14155238886",
      providerMessageSid: "SM-ORG",
      mediaCount: 1,
      mediaJson: [{ url: "https://example.com/media", contentType: "image/jpeg" }],
    },
    fake.store
  );
  assert.equal(fake.logs[0]?.organizationId, "org-required");
});

test("WhatsApp logs mask phone numbers and message body by default", () => {
  assert.equal(maskWhatsAppPhoneForLog("whatsapp:+972501234567"), "***4567");
  assert.equal(maskSupplierForLog("OpenAI LLC"), "Op***");
  assert.equal(maskBodyPreviewForLog("חשבונית מספק רגיש"), "[redacted:17chars]");

  const context = buildWhatsAppWebhookLogContext({
    sid: "SM1",
    from: "whatsapp:+972501234567",
    to: "whatsapp:+14155238886",
    mediaCount: 1,
    body: "סודי",
  });
  assert.equal(context.from, "***4567");
  assert.equal(context.bodyPreview, "[redacted:4chars]");
});

test("WhatsApp media failure message is Hebrew and generic", () => {
  assert.match(WHATSAPP_MEDIA_DOWNLOAD_FAILED_MESSAGE, /קיבלתי את הקובץ/);
  assert.doesNotMatch(WHATSAPP_MEDIA_DOWNLOAD_FAILED_MESSAGE, /Error|stack|twilio/i);
});

test("WhatsApp image with empty body and filename=null bypasses pre-download junk gate", async () => {
  assert.equal(
    hasWhatsAppMediaEvidence([
      {
        url: "https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages/MMtest/Media/MEtest",
        contentType: "image/jpeg",
        filename: null,
      },
    ]),
    true
  );

  const allowed = await shouldContinueAfterWhatsAppJunkGate({
    organizationId: "org-whatsapp",
    whatsappLogId: "log-media-1",
    fromNumber: "whatsapp:+972544427244",
    body: "",
    media: [
      {
        url: "https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages/MMtest/Media/MEtest",
        contentType: "image/jpeg",
        filename: null,
      },
    ],
  });

  assert.equal(allowed, true);
});

test("text-only empty WhatsApp message keeps pre-download junk safety and blocks OCR path", () => {
  assert.equal(hasWhatsAppMediaEvidence([]), false);

  const decision = classifyJunk({
    sender: "whatsapp:+972544427244",
    subject: "",
    body: "",
    channel: "whatsapp",
    attachmentFilenames: [],
  });

  assert.equal(decision.bucket, "UNSURE");
  assert.equal(decision.reason, "insufficient_signal");
  assert.equal(shouldAutoClassifyAfterJunkFilter(decision), false);
});
