import test from "node:test";
import assert from "node:assert/strict";

import {
  bestTierMatches,
  computeCustomerMatchPriority,
  MATCH_PRIORITY,
  normalizeCustomerNameForMatch,
  rankCustomerMatches,
  resolveRankedCustomerMatches,
} from "./customerNameRanking.js";

test("normalizeCustomerNameForMatch strips punctuation and niqqud", () => {
  assert.equal(normalizeCustomerNameForMatch('  "שרון!"  '), "שרון");
  assert.equal(normalizeCustomerNameForMatch("שרון."), "שרון");
});

test('query "שרון" prefers exact full name over partial "רון" matches', () => {
  const candidates = [
    { id: "1", name: "רון בחמישי" },
    { id: "2", name: "רון לוי" },
    { id: "3", name: "שרון" },
  ];
  const resolved = resolveRankedCustomerMatches("שרון", candidates);
  assert.equal(resolved.kind, "resolved");
  if (resolved.kind === "resolved") {
    assert.equal(resolved.match.name, "שרון");
  }
});

test('query "רון" prefers exact token matches over substring "שרון"', () => {
  const candidates = [
    { id: "1", name: "שרון" },
    { id: "2", name: "רון לוי" },
    { id: "3", name: "רון כהן" },
  ];
  const tier = bestTierMatches("רון", candidates);
  assert.equal(tier.length, 2);
  assert.equal(tier[0]?.matchPriority, MATCH_PRIORITY.EXACT_TOKEN);
  assert.ok(!tier.some((item) => item.name === "שרון"));
});

test("multiple exact full-name matches stay ambiguous", () => {
  const candidates = [
    { id: "1", name: "שרון כהן" },
    { id: "2", name: "שרון לוי" },
  ];
  const resolved = resolveRankedCustomerMatches("שרון כהן", candidates);
  assert.equal(resolved.kind, "resolved");
  if (resolved.kind === "resolved") {
    assert.equal(resolved.match.name, "שרון כהן");
  }
});

test("computeCustomerMatchPriority ranks exact full name highest", () => {
  assert.equal(computeCustomerMatchPriority("שרון", "שרון").priority, MATCH_PRIORITY.EXACT_FULL);
  assert.equal(computeCustomerMatchPriority("רון", "רון לוי").priority, MATCH_PRIORITY.EXACT_TOKEN);
  assert.equal(computeCustomerMatchPriority("רון", "שרון").priority, MATCH_PRIORITY.FUZZY);
});
