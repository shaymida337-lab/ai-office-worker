import test from "node:test";
import assert from "node:assert/strict";
import { resolveCompletionListViewState } from "./completionListViewState.ts";

test("resolveCompletionListViewState: loading beats error and empty", () => {
  assert.equal(
    resolveCompletionListViewState({ loading: true, listLoadError: "fail", rowCount: 0 }),
    "loading",
  );
});

test("resolveCompletionListViewState: error beats empty when list load failed", () => {
  assert.equal(
    resolveCompletionListViewState({ loading: false, listLoadError: "Failed to load invoice completion list", rowCount: 0 }),
    "error",
  );
});

test("resolveCompletionListViewState: genuine empty list", () => {
  assert.equal(
    resolveCompletionListViewState({ loading: false, listLoadError: null, rowCount: 0 }),
    "empty",
  );
});

test("resolveCompletionListViewState: successful list with records", () => {
  assert.equal(
    resolveCompletionListViewState({ loading: false, listLoadError: null, rowCount: 3 }),
    "list",
  );
});
