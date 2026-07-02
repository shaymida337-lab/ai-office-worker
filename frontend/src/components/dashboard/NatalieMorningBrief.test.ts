import assert from "node:assert/strict";
import test from "node:test";

test("NatalieMorningBrief mobile-safe layout markers exist in source", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/NatalieMorningBrief.tsx", "utf8");
  assert.match(source, /max-w-full overflow-hidden/);
  assert.match(source, /min-w-0/);
  assert.match(source, /break-words/);
  assert.match(source, /data-testid="natalie-morning-brief"/);
  assert.match(source, /data-testid="hero-recommendation"/);
  assert.doesNotMatch(source, /-mx-1/);
  assert.doesNotMatch(source, /whitespace-nowrap/);
});

test("NatalieMorningBrief no longer renders sync status UI", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/NatalieMorningBrief.tsx", "utf8");
  assert.doesNotMatch(source, /statusLabel/);
  assert.doesNotMatch(source, /statusTone/);
  assert.doesNotMatch(source, /statusLine/);
  assert.doesNotMatch(source, /showStatusDot/);
  assert.doesNotMatch(source, /מה כבר עשיתי/);
  assert.doesNotMatch(source, /workItems/);
});

test("dashboard page wires hero recommendation not sync trust labels", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/app/dashboard/page.tsx", "utf8");
  assert.match(source, /heroBriefing/);
  assert.doesNotMatch(source, /statusLabel=\{d\.heroTrust/);
  assert.doesNotMatch(source, /firstScanPhase/);
  assert.match(source, /DashboardHomeStatus/);
});
