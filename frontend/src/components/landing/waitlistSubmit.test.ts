import test from "node:test";
import assert from "node:assert/strict";
import { isWaitlistEmail, submitWaitlist } from "./waitlistSubmit.js";

function makeFormData() {
  const data = new FormData();
  data.append("email", "user@example.com");
  return data;
}

test("missing Formspree ID returns not_configured without any network call", async () => {
  let called = 0;
  const fetchImpl = (async () => {
    called += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const result = await submitWaitlist("", makeFormData(), fetchImpl);
  assert.deepEqual(result, { ok: false, reason: "not_configured" });
  assert.equal(called, 0);
});

test("successful Formspree response returns ok", async () => {
  const urls: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL) => {
    urls.push(String(url));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const result = await submitWaitlist("abc123", makeFormData(), fetchImpl);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(urls, ["https://formspree.io/f/abc123"]);
});

test("non-ok Formspree response returns submit_failed", async () => {
  const fetchImpl = (async () => new Response("{}", { status: 500 })) as typeof fetch;
  const result = await submitWaitlist("abc123", makeFormData(), fetchImpl);
  assert.deepEqual(result, { ok: false, reason: "submit_failed" });
});

test("network error returns submit_failed instead of throwing", async () => {
  const fetchImpl = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  const result = await submitWaitlist("abc123", makeFormData(), fetchImpl);
  assert.deepEqual(result, { ok: false, reason: "submit_failed" });
});

test("email validation accepts a normal address and rejects junk", () => {
  assert.equal(isWaitlistEmail("user@example.com"), true);
  assert.equal(isWaitlistEmail("לא-אימייל"), false);
  assert.equal(isWaitlistEmail("a@b"), false);
  assert.equal(isWaitlistEmail(""), false);
});
