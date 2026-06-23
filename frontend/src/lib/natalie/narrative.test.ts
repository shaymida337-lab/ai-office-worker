import test from "node:test";
import assert from "node:assert/strict";
import { formatNatalieActivities, formatNatalieActivity } from "./narrative.js";
import { customerCopyContainsForbiddenTerms } from "./copy.js";

test("natalie narrative: invoice saved past tense first person", () => {
  const item = formatNatalieActivity({
    id: "1",
    kind: "invoice_saved",
    supplierName: "בזק",
  });
  assert.equal(item.text, "שמרתי חשבונית של בזק.");
});

test("natalie narrative: payment prepared", () => {
  const item = formatNatalieActivity({
    id: "2",
    kind: "payment_prepared",
    supplierName: "אלקטרה",
  });
  assert.match(item.text, /הכנתי תשלום/);
  assert.match(item.text, /אלקטרה/);
});

test("natalie narrative: appointment scheduled", () => {
  const item = formatNatalieActivity({
    id: "3",
    kind: "appointment_scheduled",
    clientName: "דנה",
  });
  assert.match(item.text, /קבעתי/);
  assert.match(item.text, /דנה/);
});

test("natalie narrative: batch formatting stays Hebrew and clean", () => {
  const items = formatNatalieActivities([
    { id: "1", kind: "invoice_saved", supplierName: "בזק" },
    { id: "2", kind: "payment_paid", supplierName: "סלקום" },
    { id: "3", kind: "task_created", title: "להתקשר לרואה חשבון" },
  ]);

  assert.equal(items.length, 3);
  for (const item of items) {
    assert.equal(customerCopyContainsForbiddenTerms(item.text), null);
    assert.match(item.text, /[א-ת]/);
  }
});
