import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "scheduler.ts"), "utf8");

test("FAST_GMAIL_SCAN_INTERVAL_MS is exactly 15 minutes", () => {
  assert.match(source, /export const FAST_GMAIL_SCAN_INTERVAL_MS = 15 \* 60 \* 1000/);
  assert.doesNotMatch(source, /FAST_GMAIL_SCAN_INTERVAL_MS = 2 \* 60 \* 1000/);
});

test("scheduler wires setInterval to FAST_GMAIL_SCAN_INTERVAL_MS", () => {
  assert.match(
    source,
    /setInterval\(\(\) => \{\s*void this\.runFastGmailScans\("interval"\);\s*\}, FAST_GMAIL_SCAN_INTERVAL_MS\)/s
  );
});
