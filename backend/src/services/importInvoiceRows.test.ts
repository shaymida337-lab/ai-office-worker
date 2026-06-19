import test from "node:test";
import assert from "node:assert/strict";

import type { ColumnMapping } from "./importColumnMapper.js";
import { buildInvoiceDraftsFromRows } from "./importInvoiceRows.js";

function mapping(
  columnIndex: number,
  role: ColumnMapping["role"],
  header: string = role,
  confidence = 0.9,
): ColumnMapping {
  return { columnIndex, header, role, confidence };
}

const ticketMappings: ColumnMapping[] = [
  mapping(0, "firstName", "שם פרטי"),
  mapping(1, "lastName", "שם משפחה"),
  mapping(2, "amount", "סכום"),
  mapping(3, "quantity", "כמות"),
  mapping(4, "email", "מייל"),
  mapping(5, "date", "תאריך"),
];

test("buildInvoiceDraftsFromRows merges firstName+lastName and cleans amount", () => {
  const result = buildInvoiceDraftsFromRows({
    mappings: ticketMappings,
    rows: [["דני", "כהן", "150.00₪", "3", "d@example.com", "2026-06-18"]],
  });

  assert.equal(result.warnings.length, 0);
  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0]?.customerName, "דני כהן");
  assert.equal(result.drafts[0]?.amount, 150);
  assert.equal(result.drafts[0]?.description, "כרטיסים: 3");
  assert.equal(result.drafts[0]?.customerEmail, "d@example.com");
  assert.equal(result.drafts[0]?.issueDate, "2026-06-18");
});

test("buildInvoiceDraftsFromRows skips row without customer name", () => {
  const result = buildInvoiceDraftsFromRows({
    mappings: ticketMappings,
    rows: [["", "", "100", "1", "", ""]],
  });

  assert.equal(result.drafts.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? "", /שורה 1: חסר שם לקוח/);
});

test("buildInvoiceDraftsFromRows skips row with invalid amount", () => {
  const result = buildInvoiceDraftsFromRows({
    mappings: ticketMappings,
    rows: [["דני", "כהן", "לא-סכום", "2", "", ""]],
  });

  assert.equal(result.drafts.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? "", /שורה 1: סכום לא תקין/);
});

test("buildInvoiceDraftsFromRows uses direct customerName column", () => {
  const mappings: ColumnMapping[] = [
    mapping(0, "customerName", "שם לקוח"),
    mapping(1, "amount", "סכום"),
    mapping(2, "description", "תיאור"),
  ];

  const result = buildInvoiceDraftsFromRows({
    mappings,
    rows: [["חברת אלפא בע\"מ", "250.5", "שירות חודשי"]],
  });

  assert.equal(result.warnings.length, 0);
  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0]?.customerName, "חברת אלפא בע\"מ");
  assert.equal(result.drafts[0]?.amount, 250.5);
  assert.equal(result.drafts[0]?.description, "שירות חודשי");
});

test("buildInvoiceDraftsFromRows prefers highest-confidence mapping for duplicate roles", () => {
  const mappings: ColumnMapping[] = [
    mapping(0, "customerName", "שם", 0.5),
    mapping(1, "customerName", "לקוח", 0.95),
    mapping(2, "amount", "סכום"),
  ];

  const result = buildInvoiceDraftsFromRows({
    mappings,
    rows: [["ignored", "Beta Ltd", "99"]],
  });

  assert.equal(result.drafts[0]?.customerName, "Beta Ltd");
});
