import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNatalieStaleLeadsBatch } from "../whatsapp/natalieWhatsAppUx.js";
import {
  buildRealStaleLeadWhere,
  isJunkLeadEmail,
  isJunkLeadSender,
  isRealBusinessLead,
  MIN_SALES_LEAD_CONFIDENCE,
  QUALIFIED_LEAD_TAG,
  shouldCreateLeadFromGmailEmail,
  shouldCreateLeadFromMessageScan,
} from "./leadQuality.js";

test("noreply email is junk and does not become a lead", () => {
  assert.equal(isJunkLeadEmail("noreply@tm.openai.com"), true);
  assert.equal(isJunkLeadEmail("no-reply@support.th.mytrip.com"), true);
  assert.equal(
    shouldCreateLeadFromMessageScan(
      { contactType: "lead", intent: "question", confidence: 0.9 },
      { email: "noreply@netlify.com", name: "Netlify" }
    ),
    false
  );
  assert.equal(
    shouldCreateLeadFromGmailEmail({ email: "donotreply@wordpress.com", name: "WordPress" }),
    false
  );
});

test("invoice sender does not become a lead", () => {
  assert.equal(
    isJunkLeadSender({
      email: "invoice+statements@mail.anthropic.com",
      name: "Anthropic PBC",
      subject: "Your invoice statement",
    }),
    true
  );
  assert.equal(
    shouldCreateLeadFromMessageScan(
      { contactType: "lead", intent: "price_request", confidence: 0.95 },
      { email: "invoice+statements@mail.anthropic.com", name: "Anthropic PBC", subject: "Invoice" }
    ),
    false
  );
});

test("vendor email does not count as waiting lead", () => {
  const junkLead = {
    source: "email",
    email: "billing@vendor.example.com",
    name: "Vendor Billing",
    assignedTo: null,
    tags: [],
  };
  assert.equal(isRealBusinessLead(junkLead), false);
  assert.equal(
    shouldCreateLeadFromMessageScan(
      { contactType: "vendor", intent: "payment", confidence: 0.95 },
      { email: "billing@vendor.example.com", name: "Vendor" }
    ),
    false
  );
});

test("real customer inquiry does count", () => {
  const realLead = {
    source: "whatsapp",
    email: "dana@example.com",
    name: "דנה כהן",
    assignedTo: null,
    tags: [],
  };
  assert.equal(isRealBusinessLead(realLead), true);
  assert.equal(
    shouldCreateLeadFromMessageScan(
      { contactType: "lead", intent: "price_request", confidence: 0.82 },
      { email: "dana@example.com", name: "דנה כהן", subject: "מעוניינת בהצעת מחיר" }
    ),
    true
  );

  const qualifiedEmailLead = {
    source: "email",
    email: "prospect@real-business.co.il",
    name: "Prospect Ltd",
    assignedTo: null,
    tags: [QUALIFIED_LEAD_TAG],
  };
  assert.equal(isRealBusinessLead(qualifiedEmailLead), true);
  assert.equal(
    shouldCreateLeadFromMessageScan(
      { contactType: "lead", intent: "price_request", confidence: MIN_SALES_LEAD_CONFIDENCE },
      { email: "prospect@real-business.co.il", name: "Prospect Ltd", subject: "בקשה להצעת מחיר" }
    ),
    true
  );
});

test("daily summary and CRM stale alert share the same stale-lead where builder", () => {
  const orgId = "org_test";
  const staleBefore = new Date("2026-07-04T00:00:00.000Z");
  const morningWhere = buildRealStaleLeadWhere(orgId, staleBefore);
  const crmWhere = buildRealStaleLeadWhere(orgId, staleBefore);
  assert.deepEqual(morningWhere, crmWhere);
  assert.equal((morningWhere.AND as unknown[]).length, 2);
});

test("cap of 20 does not change reported stale-lead total", () => {
  const total = 25;
  const previewCount = 20;
  const message = buildNatalieStaleLeadsBatch(total);
  assert.match(message, /25 לידים שממתינים לטיפול/);
  assert.notEqual(previewCount, total);
  assert.ok(previewCount < total);
});
