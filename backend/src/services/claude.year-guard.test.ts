import test from "node:test";
import assert from "node:assert/strict";

test("Claude fallback keeps 2000 as a legitimate round amount", async () => {
  process.env.ANTHROPIC_API_KEY = "";
  const { analyzeEmailContent } = await import("./claude.js");
  const amount2000 = await analyzeEmailContent({
    subject: "חשבונית",
    body: 'סה"כ לתשלום: 2000 ש"ח',
    filenames: [],
    sender: "supplier@example.com",
  });

  assert.equal(amount2000.amount, 2000);
});

test("Claude fallback keeps 1950 as a legitimate round amount", async () => {
  process.env.ANTHROPIC_API_KEY = "";
  const { analyzeEmailContent } = await import("./claude.js");
  const amount1950 = await analyzeEmailContent({
    subject: "חשבונית",
    body: 'סה"כ לתשלום: 1950 ש"ח',
    filenames: [],
    sender: "supplier@example.com",
  });

  assert.equal(amount1950.amount, 1950);
});

test("Claude fallback keeps bare 2025 as a legitimate amount", async () => {
  process.env.ANTHROPIC_API_KEY = "";
  const { analyzeEmailContent } = await import("./claude.js");
  const amount2025 = await analyzeEmailContent({
    subject: "חשבונית",
    body: 'סה"כ לתשלום: 2025 ש"ח',
    filenames: [],
    sender: "supplier@example.com",
  });

  assert.equal(amount2025.amount, 2025);
});

test("Claude fallback still filters years that appear in date context", async () => {
  process.env.ANTHROPIC_API_KEY = "";
  const { analyzeEmailContent } = await import("./claude.js");
  const dateYear = await analyzeEmailContent({
    subject: "חשבונית",
    body: "לתשלום עד 2025-05-14",
    filenames: [],
    sender: "supplier@example.com",
  });

  assert.equal(dateYear.amount, null);
});
