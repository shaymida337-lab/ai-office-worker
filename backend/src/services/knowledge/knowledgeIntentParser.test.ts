import test from "node:test";
import assert from "node:assert/strict";

import { parseKnowledgeIntent, isKnowledgeLookupPhrase } from "./knowledgeIntentParser.js";

test("open contract by customer: 'תפתחי לי את החוזה עם שרית'", () => {
  const res = parseKnowledgeIntent("תפתחי לי את החוזה עם שרית");
  assert.equal(res.intent, "knowledge_lookup");
  assert.equal(res.mode, "open");
  assert.equal(res.category, "contract");
  assert.equal(res.subject, "שרית");
});

test("open agreement by customer: 'איפה ההסכם של דני'", () => {
  const res = parseKnowledgeIntent("איפה ההסכם של דני");
  assert.equal(res.intent, "knowledge_lookup");
  assert.equal(res.mode, "open");
  assert.equal(res.category, "agreement");
  assert.equal(res.subject, "דני");
});

test("open warranty by item: 'תראי לי את האחריות של המזגן'", () => {
  const res = parseKnowledgeIntent("תראי לי את האחריות של המזגן");
  assert.equal(res.intent, "knowledge_lookup");
  assert.equal(res.category, "warranty");
  assert.equal(res.subject, "המזגן");
});

test("quotation existence: 'יש לי הצעת מחיר של רונן?'", () => {
  const res = parseKnowledgeIntent("יש לי הצעת מחיר של רונן?");
  assert.equal(res.intent, "knowledge_lookup");
  assert.equal(res.category, "quotation");
  assert.equal(res.subject, "רונן");
});

test("open contract, 'מה כתוב בחוזה עם יוסי'", () => {
  const res = parseKnowledgeIntent("מה כתוב בחוזה עם יוסי");
  assert.equal(res.intent, "knowledge_lookup");
  assert.equal(res.category, "contract");
  assert.equal(res.subject, "יוסי");
});

test("list all contracts: 'תראי את כל החוזים'", () => {
  const res = parseKnowledgeIntent("תראי את כל החוזים");
  assert.equal(res.intent, "knowledge_lookup");
  assert.equal(res.mode, "list");
  assert.equal(res.category, "contract");
  assert.equal(res.subject, null);
});

test("count contracts: 'כמה חוזים יש לי'", () => {
  const res = parseKnowledgeIntent("כמה חוזים יש לי");
  assert.equal(res.intent, "knowledge_lookup");
  assert.equal(res.mode, "count");
  assert.equal(res.category, "contract");
  assert.equal(res.subject, null);
});

test("list any documents for a customer: 'איזה מסמכים יש לשרית'", () => {
  const res = parseKnowledgeIntent("איזה מסמכים יש לשרית");
  assert.equal(res.intent, "knowledge_lookup");
  assert.equal(res.mode, "list");
  assert.equal(res.category, null);
  assert.equal(res.subject, "שרית");
});

test("non-knowledge (calendar) message is not a knowledge lookup", () => {
  const res = parseKnowledgeIntent("תקבעי תור לשרית מחר בשלוש");
  assert.equal(res.intent, "unknown");
  assert.equal(isKnowledgeLookupPhrase("תקבעי תור לשרית מחר בשלוש"), false);
});

test("non-knowledge (list appointments) is not a knowledge lookup", () => {
  assert.equal(isKnowledgeLookupPhrase("מה יש לי מחר ביומן"), false);
});

test("gate helper is true for a supported document command", () => {
  assert.equal(isKnowledgeLookupPhrase("תפתחי את החוזה של שרית"), true);
});
