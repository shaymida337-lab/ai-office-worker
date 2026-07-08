import test from "node:test";
import assert from "node:assert/strict";

import { parseBusinessMemoryIntent, isBusinessMemoryLookupPhrase } from "./businessMemoryIntentParser.js";

test("open contract: 'תפתחי את החוזה של שרית'", () => {
  const res = parseBusinessMemoryIntent("תפתחי את החוזה של שרית");
  assert.equal(res.intent, "business_memory_lookup");
  assert.equal(res.mode, "open");
  assert.equal(res.documentType, "contract");
  assert.equal(res.subject, "שרית");
});

test("warranty by item: 'איפה האחריות של המזגן'", () => {
  const res = parseBusinessMemoryIntent("איפה האחריות של המזגן");
  assert.equal(res.intent, "business_memory_lookup");
  assert.equal(res.documentType, "warranty");
  assert.equal(res.subject, "המזגן");
});

test("list all documents: 'תראי את כל המסמכים'", () => {
  const res = parseBusinessMemoryIntent("תראי את כל המסמכים");
  assert.equal(res.intent, "business_memory_lookup");
  assert.equal(res.mode, "list");
  assert.equal(res.documentType, null);
  assert.equal(res.subject, null);
});

test("count all documents: 'כמה מסמכים יש לי'", () => {
  const res = parseBusinessMemoryIntent("כמה מסמכים יש לי");
  assert.equal(res.intent, "business_memory_lookup");
  assert.equal(res.mode, "count");
  assert.equal(res.documentType, null);
});

test("list customer documents: 'איזה מסמכים יש לשרית'", () => {
  const res = parseBusinessMemoryIntent("איזה מסמכים יש לשרית");
  assert.equal(res.mode, "list");
  assert.equal(res.subject, "שרית");
});

test("calendar command is not business memory", () => {
  assert.equal(isBusinessMemoryLookupPhrase("תקבעי תור לשרית מחר"), false);
});
