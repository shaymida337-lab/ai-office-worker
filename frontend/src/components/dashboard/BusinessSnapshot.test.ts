import assert from "node:assert/strict";
import test from "node:test";

test("BusinessSnapshot renders exactly 4 KPI cards", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/BusinessSnapshot.tsx", "utf8");
  assert.match(source, /Array\.from\(\{ length: 4 \}\)/);
  assert.match(source, /metrics\.slice\(0, 4\)/);
  assert.match(source, /data-testid="dashboard-kpi-grid"/);
});

test("BusinessSnapshot uses mobile 2x2 and desktop 4-column grid", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/BusinessSnapshot.tsx", "utf8");
  assert.match(source, /grid-cols-2/);
  assert.match(source, /lg:grid-cols-4/);
});

test("BusinessSnapshot KPI cards are not styled as clickable", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/BusinessSnapshot.tsx", "utf8");
  assert.doesNotMatch(source, /cursor-pointer/);
  assert.doesNotMatch(source, /<Link|<a /);
  assert.match(source, /aria-label=\{`\$\{label\}: \$\{value\}`\}/);
  assert.match(source, /min-h-\[84px\]/);
});
