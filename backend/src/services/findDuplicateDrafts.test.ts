import test from "node:test";
import assert from "node:assert/strict";

import { findDuplicateDrafts, type DuplicateDraftInput } from "./findDuplicateDrafts.js";

function draft(overrides: Partial<DuplicateDraftInput> & Pick<DuplicateDraftInput, "id">): DuplicateDraftInput {
  return {
    customerName: "Default Customer",
    amount: 100,
    ...overrides,
  };
}

test("findDuplicateDrafts marks same email (after normalize) and same amount as duplicates", () => {
  const drafts = [
    draft({ id: "a", customerEmail: "User@Example.com", amount: 150 }),
    draft({ id: "b", customerEmail: "  user@example.com  ", amount: 150 }),
  ];

  const result = findDuplicateDrafts(drafts);

  assert.deepEqual(result, {
    a: ["b"],
    b: ["a"],
  });
});

test("findDuplicateDrafts does not mark same email with different amount as duplicates", () => {
  const drafts = [
    draft({ id: "a", customerEmail: "user@example.com", amount: 150 }),
    draft({ id: "b", customerEmail: "user@example.com", amount: 200 }),
  ];

  const result = findDuplicateDrafts(drafts);

  assert.deepEqual(result, {});
});

test("findDuplicateDrafts marks same normalized name and amount when email is missing", () => {
  const drafts = [
    draft({ id: "a", customerName: "  יפעת   יחזקאל  ", amount: 150 }),
    draft({ id: "b", customerName: "יפעת יחזקאל", amount: 150 }),
  ];

  const result = findDuplicateDrafts(drafts);

  assert.deepEqual(result, {
    a: ["b"],
    b: ["a"],
  });
});

test("findDuplicateDrafts does not mark different names without email as duplicates", () => {
  const drafts = [
    draft({ id: "a", customerName: "יפעת יחזקאל", amount: 150 }),
    draft({ id: "b", customerName: "דני כהן", amount: 150 }),
  ];

  const result = findDuplicateDrafts(drafts);

  assert.deepEqual(result, {});
});

test("findDuplicateDrafts links all members in a group of three with the same key", () => {
  const drafts = [
    draft({ id: "a", customerEmail: "user@example.com", amount: 150 }),
    draft({ id: "b", customerEmail: "USER@EXAMPLE.COM", amount: 150 }),
    draft({ id: "c", customerEmail: "user@example.com", amount: 150 }),
  ];

  const result = findDuplicateDrafts(drafts);

  assert.deepEqual(result.a?.sort(), ["b", "c"]);
  assert.deepEqual(result.b?.sort(), ["a", "c"]);
  assert.deepEqual(result.c?.sort(), ["a", "b"]);
});

test("findDuplicateDrafts returns empty result for single draft or empty list", () => {
  assert.deepEqual(findDuplicateDrafts([]), {});
  assert.deepEqual(
    findDuplicateDrafts([draft({ id: "only", customerEmail: "user@example.com", amount: 150 })]),
    {},
  );
});

test("findDuplicateDrafts does not match email-key draft with name-key draft even when name and amount match", () => {
  const drafts = [
    draft({ id: "with-email", customerName: "יפעת יחזקאל", customerEmail: "yifnaor@gmail.com", amount: 150 }),
    draft({ id: "without-email", customerName: "יפעת יחזקאל", amount: 150 }),
  ];

  const result = findDuplicateDrafts(drafts);

  assert.deepEqual(result, {});
});
