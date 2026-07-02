import assert from "node:assert/strict";
import test from "node:test";
import { buildAttentionCenterHeading } from "./attentionCenterHeading";

test("buildAttentionCenterHeading returns all clear when no urgent items", () => {
  const heading = buildAttentionCenterHeading(0);
  assert.equal(heading.title, "הכל מסודר");
});

test("buildAttentionCenterHeading returns singular title for one item", () => {
  const heading = buildAttentionCenterHeading(1);
  assert.equal(heading.title, "יש משימה אחת חשובה");
});

test("buildAttentionCenterHeading returns plural title for multiple items", () => {
  const heading = buildAttentionCenterHeading(3);
  assert.equal(heading.title, "יש 3 דברים שמחכים לטיפול");
});
