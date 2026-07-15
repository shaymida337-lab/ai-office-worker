import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  detectClientImportColumns,
  extractClientImportRecords,
  parseClientImportWorkbook,
  phoneMatchKey,
} from "./clientImport.js";

function workbookBuffer(rows: string[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "לקוחות");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("detectClientImportColumns maps Hebrew client headers", () => {
  const detected = detectClientImportColumns([
    ["שם", "טלפון", "אימייל", "כתובת", "הערות"],
    ["דני", "0501234567", "dani@example.com", "תל אביב", "VIP"],
  ]);
  assert.equal(detected.headerRowIndex, 0);
  const fields = detected.mappings.map((m) => m.field);
  assert.deepEqual(fields, ["name", "phone", "email", "address", "notes"]);
});

test("extractClientImportRecords builds typed rows from mappings", () => {
  const headers = ["Name", "Phone", "Email", "Address", "Notes"];
  const detected = detectClientImportColumns([headers]);
  const records = extractClientImportRecords(
    [["שרה כהן", "052-1112233", "sara@example.com", "חיפה", "לקוחה קבועה"]],
    detected.mappings
  );
  assert.equal(records.length, 1);
  assert.equal(records[0]?.name, "שרה כהן");
  assert.equal(records[0]?.phone, "052-1112233");
  assert.equal(records[0]?.email, "sara@example.com");
  assert.equal(records[0]?.address, "חיפה");
  assert.equal(records[0]?.notes, "לקוחה קבועה");
});

test("parseClientImportWorkbook reads excel buffer", () => {
  const buffer = workbookBuffer([
    ["שם לקוח", "טלפון", "מייל"],
    ["יוסי", "0509998887", "yossi@example.com"],
  ]);
  const parsed = parseClientImportWorkbook(buffer, "clients.xlsx");
  assert.equal(parsed.fileType, "excel");
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[1]?.[0], "יוסי");
});

test("phoneMatchKey compares last 9 digits across formats", () => {
  assert.equal(phoneMatchKey("050-123-4567"), phoneMatchKey("+972501234567"));
  assert.equal(phoneMatchKey("whatsapp:+972501234567"), "501234567");
  assert.equal(phoneMatchKey("12"), null);
});
