import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_VOICE_CATALOG, DEMO_VOICE_IDS } from "./demoVoiceCatalog.js";
import {
  createAudioCache,
  createRateLimiter,
  handleDemoVoiceRequest,
} from "./demoVoiceService.js";

function deps(overrides: Partial<Parameters<typeof handleDemoVoiceRequest>[1]> = {}) {
  return {
    cache: createAudioCache(),
    limiter: createRateLimiter(),
    synthesize: async () => ({ ok: true as const, audio: Buffer.from("mp3!"), contentType: "audio/mpeg" }),
    log: () => {},
    ...overrides,
  };
}

test("allowlist: unknown id is rejected with 400 and no synthesis", async () => {
  let called = 0;
  const result = await handleDemoVoiceRequest(
    { id: "free-text-injection", ip: "1.1.1.1" },
    deps({ synthesize: async () => { called += 1; return { ok: true as const, audio: Buffer.from("x"), contentType: "audio/mpeg" }; } })
  );
  assert.equal(result.kind, "error");
  assert.equal((result as { status: number }).status, 400);
  assert.equal(called, 0);
});

test("allowlist: non-string id rejected", async () => {
  const result = await handleDemoVoiceRequest({ id: { evil: true }, ip: "1.1.1.1" }, deps());
  assert.equal(result.kind, "error");
});

test("valid id returns audio", async () => {
  const result = await handleDemoVoiceRequest({ id: "reply-urgent", ip: "1.1.1.1" }, deps());
  assert.equal(result.kind, "audio");
  assert.equal((result as { cacheHit: boolean }).cacheHit, false);
});

test("cache: second request for same id is a hit and does not re-synthesize", async () => {
  let calls = 0;
  const d = deps({
    synthesize: async () => { calls += 1; return { ok: true as const, audio: Buffer.from("mp3"), contentType: "audio/mpeg" }; },
  });
  const first = await handleDemoVoiceRequest({ id: "reply-tasks", ip: "1.1.1.1" }, d);
  const second = await handleDemoVoiceRequest({ id: "reply-tasks", ip: "2.2.2.2" }, d);
  assert.equal(first.kind, "audio");
  assert.equal(second.kind, "audio");
  assert.equal((second as { cacheHit: boolean }).cacheHit, true);
  assert.equal(calls, 1);
});

test("rate limit: same IP blocked after limit, other IP unaffected", async () => {
  const limiter = createRateLimiter(3, 60_000);
  const d = deps({ limiter, cache: createAudioCache() });
  // cache would bypass the limiter after first call — use distinct ids? catalog has 8; limit=3 so use uncached path each time by fresh cache per call? Simpler: limiter check happens before cache only for uncached... actually limiter runs before cache lookup? In service: allowlist → limiter → cache. So every call counts.
  for (let i = 0; i < 3; i += 1) {
    const r = await handleDemoVoiceRequest({ id: "reply-default", ip: "9.9.9.9" }, d);
    assert.equal(r.kind, "audio");
  }
  const blocked = await handleDemoVoiceRequest({ id: "reply-default", ip: "9.9.9.9" }, d);
  assert.equal(blocked.kind, "error");
  assert.equal((blocked as { status: number }).status, 429);
  const other = await handleDemoVoiceRequest({ id: "reply-default", ip: "8.8.8.8" }, d);
  assert.equal(other.kind, "audio");
});

test("provider failure maps to error without leaking details", async () => {
  const result = await handleDemoVoiceRequest(
    { id: "seed-1", ip: "1.1.1.1" },
    deps({ synthesize: async () => ({ ok: false as const, status: 502, error: "provider says: secret-key-xyz" }) })
  );
  assert.equal(result.kind, "error");
  const err = result as { status: number; error: string };
  assert.equal(err.status, 502);
  assert.ok(!err.error.includes("secret"), "provider error text must not leak to client");
});

test("synthesize exception (timeout) maps to 502", async () => {
  const result = await handleDemoVoiceRequest(
    { id: "seed-2", ip: "1.1.1.1" },
    deps({ synthesize: async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; } })
  );
  assert.equal(result.kind, "error");
  assert.equal((result as { status: number }).status, 502);
});

test("catalog integrity: ids unique, texts bounded and non-empty", () => {
  assert.ok(DEMO_VOICE_IDS.length >= 8);
  for (const [id, text] of Object.entries(DEMO_VOICE_CATALOG)) {
    assert.ok(id.length <= 40);
    assert.ok(text.trim().length > 0);
    assert.ok(text.length <= 400, `text too long for ${id}`);
  }
});

test("drift guard: every catalog text exists verbatim in the demo page source", () => {
  const pagePath = join(process.cwd(), "..", "frontend", "src", "app", "natalie", "page.tsx");
  const source = readFileSync(pagePath, "utf8");
  for (const [id, text] of Object.entries(DEMO_VOICE_CATALOG)) {
    assert.ok(source.includes(text), `catalog text for "${id}" not found in natalie/page.tsx — update both together`);
  }
});
