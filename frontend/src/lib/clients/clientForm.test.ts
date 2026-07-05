import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClientCreatePayload,
  buildClientUpdatePayload,
  formatClientEmailDisplay,
  isPlaceholderClientEmail,
  validateClientEmail,
  validateClientForm,
} from "./clientForm.js";

test("validateClientForm allows name only", () => {
  const result = validateClientForm({ name: "David Cohen", email: "", whatsappNumber: "" });
  assert.equal(result.ok, true);
});

test("validateClientForm allows name and phone without email", () => {
  const result = validateClientForm({
    name: "David Cohen",
    email: "",
    whatsappNumber: "0501234567",
  });
  assert.equal(result.ok, true);
});

test("validateClientForm allows real email", () => {
  const result = validateClientForm({
    name: "David Cohen",
    email: "david@example.com",
    whatsappNumber: "",
  });
  assert.equal(result.ok, true);
});

test("validateClientEmail rejects invalid and placeholder addresses", () => {
  assert.equal(validateClientEmail(""), null);
  assert.equal(validateClientEmail("not-an-email"), "כתובת המייל לא תקינה");
  assert.equal(validateClientEmail("natalie-x@scheduling.local"), "לא ניתן להשתמש בכתובת מייל זמנית");
  assert.ok(isPlaceholderClientEmail("user@whatsapp.local"));
});

test("buildClientCreatePayload omits empty email", () => {
  const payload = buildClientCreatePayload({
    name: "David Cohen",
    email: "",
    whatsappNumber: "0501234567",
  });
  assert.equal(payload.name, "David Cohen");
  assert.equal(payload.whatsappNumber, "0501234567");
  assert.equal("email" in payload, false);
});

test("buildClientCreatePayload includes normalized real email", () => {
  const payload = buildClientCreatePayload({
    name: "David Cohen",
    email: "David@Example.com",
    whatsappNumber: "",
  });
  assert.equal(payload.email, "david@example.com");
});

test("buildClientUpdatePayload can clear email", () => {
  const payload = buildClientUpdatePayload({
    name: "David Cohen",
    email: "",
    whatsappNumber: "0501234567",
  });
  assert.equal(payload.email, "");
});

test("formatClientEmailDisplay hides placeholder and empty values", () => {
  assert.equal(formatClientEmailDisplay(null), "לא מוגדר");
  assert.equal(formatClientEmailDisplay("natalie-x@scheduling.local"), "לא מוגדר");
  assert.equal(formatClientEmailDisplay("david@example.com"), "david@example.com");
});
