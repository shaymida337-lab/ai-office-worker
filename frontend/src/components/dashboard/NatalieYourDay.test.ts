import assert from "node:assert/strict";
import test from "node:test";

test("NatalieYourDay actionable rows use Link with min touch target", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/NatalieYourDay.tsx", "utf8");
  assert.match(source, /from "next\/link"/);
  assert.match(source, /min-h-11/);
  assert.match(source, /data-testid=\{`your-day-link-\$\{item\.id\}`\}/);
  assert.match(source, /aria-label=\{`\$\{item\.text\} — פתיחה`\}/);
  assert.match(source, /focus-visible:outline/);
});

test("NatalieYourDay informational rows are not links", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/NatalieYourDay.tsx", "utf8");
  assert.match(source, /data-actionable="false"/);
  assert.match(source, /isYourDayItemActionable/);
});

test("NatalieYourDay routes come from centralized map not hardcoded paths", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/NatalieYourDay.tsx", "utf8");
  assert.doesNotMatch(source, /\/payments/);
  assert.doesNotMatch(source, /\/dashboard\/document-reviews/);
});
