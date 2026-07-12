import test from "node:test";
import assert from "node:assert/strict";
import {
  handleMarketingLead,
  normalizePhone,
  validateMarketingLead,
} from "./marketingLeadService.js";

const VALID = {
  name: "דנה כהן",
  email: "Dana@Example.com",
  phone: "050-123-4567",
  businessType: "קוסמטיקה",
  consent: true,
};

function deps(overrides: Partial<Parameters<typeof handleMarketingLead>[1]> = {}) {
  return {
    createLead: async () => ({ id: "lead_1" }),
    limiter: { allow: () => true },
    log: () => {},
    ...overrides,
  };
}

test("valid lead passes validation with normalized email+phone", () => {
  const result = validateMarketingLead(VALID);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.lead.email, "dana@example.com");
    assert.equal(result.lead.phone, "0501234567");
  }
});

test("validation failures: name, email, phone, businessType, consent", () => {
  assert.equal(validateMarketingLead({ ...VALID, name: "א" }).ok, false);
  assert.equal(validateMarketingLead({ ...VALID, email: "not-an-email" }).ok, false);
  assert.equal(validateMarketingLead({ ...VALID, phone: "123" }).ok, false);
  assert.equal(validateMarketingLead({ ...VALID, businessType: "" }).ok, false);
  assert.equal(validateMarketingLead({ ...VALID, consent: false }).ok, false);
  assert.equal(validateMarketingLead({ ...VALID, consent: "true" }).ok, false);
});

test("phone normalization strips separators", () => {
  assert.equal(normalizePhone("+972 50-123 45.67"), "+972501234567");
});

test("success only after DB write; utm fields persisted", async () => {
  let saved: unknown = null;
  const result = await handleMarketingLead(
    { ...VALID, ip: "1.1.1.1", source: "facebook", medium: "social", campaign: "launch", landingPath: "/?utm_source=facebook" },
    deps({ createLead: async (lead) => { saved = lead; return { id: "lead_42" }; } })
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, id: "lead_42" });
  assert.equal((saved as { source: string }).source, "facebook");
  assert.equal((saved as { campaign: string }).campaign, "launch");
});

test("DB failure returns 500 and never fake success", async () => {
  const result = await handleMarketingLead(
    { ...VALID, ip: "1.1.1.1" },
    deps({ createLead: async () => { throw new Error("db down"); } })
  );
  assert.equal(result.status, 500);
  assert.equal(result.body.ok, false);
});

test("honeypot filled → fake success, nothing saved", async () => {
  let saved = 0;
  const result = await handleMarketingLead(
    { ...VALID, website: "http://spam.example", ip: "1.1.1.1" },
    deps({ createLead: async () => { saved += 1; return { id: "x" }; } })
  );
  assert.equal(result.status, 200);
  assert.equal(saved, 0);
});

test("rate limit returns 429 before validation/save", async () => {
  let saved = 0;
  const result = await handleMarketingLead(
    { ...VALID, ip: "9.9.9.9" },
    deps({ limiter: { allow: () => false }, createLead: async () => { saved += 1; return { id: "x" }; } })
  );
  assert.equal(result.status, 429);
  assert.equal(saved, 0);
});

test("no PII in log events", async () => {
  const events: Record<string, unknown>[] = [];
  await handleMarketingLead(
    { ...VALID, ip: "1.1.1.1" },
    deps({ log: (e) => events.push(e) })
  );
  const dump = JSON.stringify(events);
  assert.ok(!dump.includes("דנה"), "name leaked to logs");
  assert.ok(!dump.includes("dana@example.com"), "email leaked to logs");
  assert.ok(!dump.includes("0501234567"), "phone leaked to logs");
});
