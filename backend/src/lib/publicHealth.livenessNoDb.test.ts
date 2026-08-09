import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

test("index.ts /health handler does not call prisma.$queryRaw", () => {
  const source = readFileSync(join(here, "..", "index.ts"), "utf8");
  assert.match(source, /app\.get\("\/health", healthHandler\)/);
  assert.match(source, /buildLivenessHealthPayload\(getHealthPayload, isPrismaConnected\)/);
  // DB probe may remain on /ready only.
  assert.match(source, /app\.get\("\/ready", readyHandler\)/);
  const healthFn = source.match(/function healthHandler[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.ok(healthFn.length > 0, "healthHandler function body present");
  assert.doesNotMatch(healthFn, /\$queryRaw/);
  assert.doesNotMatch(healthFn, /prisma\./);
});
