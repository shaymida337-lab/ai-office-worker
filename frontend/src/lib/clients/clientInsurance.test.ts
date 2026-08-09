import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInsuranceUpdatePayload,
  displayInsuranceValue,
  parseClientInsurance,
} from "./clientInsurance.ts";

test("displayInsuranceValue uses לא הוזן for empty values", () => {
  assert.equal(displayInsuranceValue(""), "לא הוזן");
  assert.equal(displayInsuranceValue(null), "לא הוזן");
  assert.equal(displayInsuranceValue("תל אביב"), "תל אביב");
});

test("buildInsuranceUpdatePayload clears blanks to null for personal fields only", () => {
  const payload = buildInsuranceUpdatePayload(
    parseClientInsurance({ city: " תל אביב ", nationalId: "  ", insuranceCompany: "הראל" })
  );
  assert.equal(payload.insurance.city, "תל אביב");
  assert.equal(payload.insurance.nationalId, null);
  assert.equal("insuranceCompany" in payload.insurance, false);
});
