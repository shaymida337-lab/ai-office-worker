import assert from "node:assert/strict";
import test from "node:test";

test("NatalieMorningBrief mobile-safe layout markers exist in source", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/NatalieMorningBrief.tsx", "utf8");
  assert.match(source, /max-w-full overflow-hidden/);
  assert.match(source, /min-w-0/);
  assert.match(source, /break-words/);
  assert.match(source, /data-testid="natalie-morning-brief"/);
  assert.doesNotMatch(source, /-mx-1/);
  assert.doesNotMatch(source, /whitespace-nowrap/);
});
