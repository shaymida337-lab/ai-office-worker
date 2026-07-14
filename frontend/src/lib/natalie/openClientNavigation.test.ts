import test from "node:test";
import assert from "node:assert/strict";
import {
  OPEN_CLIENT_PATH_ERROR,
  formatOpenClientChatAnswer,
  isValidNatalieOpenClientPath,
} from "./openClientNavigation";

test("isValidNatalieOpenClientPath accepts client card paths only", () => {
  assert.equal(isValidNatalieOpenClientPath("/dashboard/clients/c-sarit"), true);
  assert.equal(isValidNatalieOpenClientPath("/dashboard/clients/cmqi1yr6m"), true);
  assert.equal(isValidNatalieOpenClientPath("/dashboard/clients/"), false);
  assert.equal(isValidNatalieOpenClientPath("/crm"), false);
  assert.equal(isValidNatalieOpenClientPath("https://evil.example/dashboard/clients/x"), false);
  assert.equal(isValidNatalieOpenClientPath(""), false);
  assert.equal(isValidNatalieOpenClientPath(null), false);
});

test("formatOpenClientChatAnswer strips path lines from answer", () => {
  assert.equal(
    formatOpenClientChatAnswer("פתחתי את הכרטיס של שרית.\n/dashboard/clients/c-sarit", "/dashboard/clients/c-sarit"),
    "פתחתי את הכרטיס של שרית."
  );
  assert.equal(
    formatOpenClientChatAnswer("/dashboard/clients/c-sarit", "/dashboard/clients/c-sarit"),
    "פתחתי את כרטיס הלקוח."
  );
});

test("OPEN_CLIENT_PATH_ERROR is non-empty Hebrew copy", () => {
  assert.match(OPEN_CLIENT_PATH_ERROR, /כרטיס הלקוח/);
});
