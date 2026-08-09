import test from "node:test";
import assert from "node:assert/strict";

import {
  formatInsuranceFieldDisplay,
  mergeInsuranceProfile,
  parseInsuranceJson,
} from "./clientInsurance.js";

test("parseInsuranceJson returns empty profile for invalid input", () => {
  const profile = parseInsuranceJson(null);
  assert.equal(profile.dateOfBirth, null);
  assert.equal(formatInsuranceFieldDisplay(profile, "dateOfBirth"), "לא הוזן");
});

test("mergeInsuranceProfile merges personal fields and ignores legacy policy keys", () => {
  const merged = mergeInsuranceProfile(
    { dateOfBirth: "01.01.1990", nationalId: "123", insuranceCompany: "כלל" },
    { dateOfBirth: "12.03.1988", nationalId: "" }
  );
  assert.equal(merged.dateOfBirth, "12.03.1988");
  assert.equal(merged.nationalId, null);
  assert.equal(formatInsuranceFieldDisplay(merged, "nationalId"), "לא הוזן");
  assert.equal("insuranceCompany" in merged, false);
});
