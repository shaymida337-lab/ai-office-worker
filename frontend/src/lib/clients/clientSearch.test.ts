import test from "node:test";
import assert from "node:assert/strict";
import { clientMatchesQuery, filterClientsByQuery } from "./clientSearch";

const sarit = {
  name: "שרית כהן",
  email: "sarit@example.com",
  phone: "+972501234567",
  whatsappNumber: "050-123-4567",
};

test("חיפוש לפי שם — 'שרית' מוצא את שרית כהן", () => {
  assert.equal(clientMatchesQuery(sarit, "שרית"), true);
  assert.equal(clientMatchesQuery(sarit, "כהן"), true);
  assert.equal(clientMatchesQuery(sarit, "  שרית  "), true);
});

test("חיפוש לפי אימייל — case-insensitive", () => {
  assert.equal(clientMatchesQuery(sarit, "SARIT@"), true);
  assert.equal(clientMatchesQuery(sarit, "example.com"), true);
});

test("חיפוש לפי טלפון — מקומי מוצא בינלאומי ולהפך", () => {
  assert.equal(clientMatchesQuery(sarit, "0501234567"), true);
  assert.equal(clientMatchesQuery(sarit, "050-123"), true);
  assert.equal(clientMatchesQuery(sarit, "+972501234567"), true);
  assert.equal(clientMatchesQuery(sarit, "972501234"), true);
});

test("חיפוש טלפון עובד גם כשיש רק whatsappNumber", () => {
  const client = { name: "דנה", whatsappNumber: "0521111111" };
  assert.equal(clientMatchesQuery(client, "+972521111111"), true);
  assert.equal(clientMatchesQuery(client, "052111"), true);
});

test("אי-התאמה מחזירה false; מחרוזת ריקה מחזירה הכל", () => {
  assert.equal(clientMatchesQuery(sarit, "יוסי"), false);
  assert.equal(clientMatchesQuery(sarit, "0539999999"), false);
  assert.equal(clientMatchesQuery(sarit, ""), true);
  assert.equal(filterClientsByQuery([sarit, { name: "יוסי" }], "שרית").length, 1);
});
