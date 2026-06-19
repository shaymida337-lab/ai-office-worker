import test from "node:test";
import assert from "node:assert/strict";

import { detectImportColumns } from "./importColumnMapper.js";

function roleAt(result: ReturnType<typeof detectImportColumns>, columnIndex: number) {
  return result.mappings.find((mapping) => mapping.columnIndex === columnIndex)?.role;
}

test("detectImportColumns maps ticket sales card file headers", () => {
  const rows = [
    ["מספר הזמנה", "תאריך", "שם פרטי", "שם משפחה", "טלפון", "מייל", "סכום", "סכום לפי מטבע דיפולטיבי", "כמות כרטיסים"],
    ["15396725", "31.05.2026", "יפעת", "יחזקאל", "050-8327991", "yifnaor@gmail.com", "150.00₪", "150", "3"],
  ];

  const result = detectImportColumns(rows);

  assert.equal(result.headerRowIndex, 0);
  assert.equal(roleAt(result, 1), "date");
  assert.equal(roleAt(result, 2), "firstName");
  assert.equal(roleAt(result, 3), "lastName");
  assert.equal(roleAt(result, 4), "phone");
  assert.equal(roleAt(result, 5), "email");
  assert.equal(roleAt(result, 6), "amount");
  assert.equal(roleAt(result, 8), "quantity");
  assert.ok(result.warnings.some((warning) => warning.includes("amount")));
});

test("detectImportColumns maps English headers", () => {
  const rows = [
    ["Name", "Email", "Amount"],
    ["John", "j@x.com", "100"],
  ];

  const result = detectImportColumns(rows);

  assert.equal(result.headerRowIndex, 0);
  assert.equal(roleAt(result, 0), "customerName");
  assert.equal(roleAt(result, 1), "email");
  assert.equal(roleAt(result, 2), "amount");
});

test("detectImportColumns finds header row below title rows", () => {
  const rows = [
    ["דוח מכירות", "", ""],
    ["", "", ""],
    ["שם", "מייל", "סכום"],
    ["דני", "d@x.com", "50"],
  ];

  const result = detectImportColumns(rows);

  assert.equal(result.headerRowIndex, 2);
  assert.equal(roleAt(result, 0), "customerName");
  assert.equal(roleAt(result, 1), "email");
  assert.equal(roleAt(result, 2), "amount");
});

test("detectImportColumns marks unrecognized column as unknown", () => {
  const rows = [
    ["שם", "קוד פנימי", "סכום"],
    ["דני", "XYZ", "50"],
  ];

  const result = detectImportColumns(rows);

  assert.equal(roleAt(result, 1), "unknown");
});

test("detectImportColumns reports missing header row for data-only file", () => {
  const rows = [
    ["123", "456"],
    ["789", "012"],
  ];

  const result = detectImportColumns(rows);

  assert.equal(result.headerRowIndex, -1);
  assert.deepEqual(result.mappings, []);
  assert.ok(result.warnings.includes("לא זוהתה שורת כותרות"));
});
