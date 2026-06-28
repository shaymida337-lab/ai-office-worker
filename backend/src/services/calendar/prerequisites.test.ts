import test from "node:test";
import assert from "node:assert/strict";

import { allRequiredPrerequisitesPassed, markPrerequisitePassed } from "./prerequisites.js";

test("allRequiredPrerequisitesPassed returns false when required item is missing", () => {
  const items = [{ id: "client", label: "Client", required: true, passed: false }];
  assert.equal(allRequiredPrerequisitesPassed(items), false);
});

test("markPrerequisitePassed updates the matching prerequisite", () => {
  const items = [
    { id: "client", label: "Client", required: true, passed: false },
    { id: "payment", label: "Payment", required: false, passed: false },
  ];
  const next = markPrerequisitePassed(items, "client");
  assert.equal(allRequiredPrerequisitesPassed(next), true);
});
