import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "HistoricalScanSelector.tsx"), "utf8");

test("HistoricalScanSelector PATCHes organization settings with historicalScanYears", () => {
  assert.match(source, /method:\s*"PATCH"/);
  assert.match(source, /\/api\/organization\/settings/);
  assert.match(source, /historicalScanYears/);
  assert.match(source, /עומק הסריקה עודכן/);
});

test("HistoricalScanSelector exposes years 1 through 5", () => {
  assert.match(source, /\[1,\s*2,\s*3,\s*4,\s*5\]/);
});
