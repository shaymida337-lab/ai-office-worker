import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

import { buildImportPreview } from "./importFilePreview.js";

function workbookToBuffer(rows: string[][]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function roleAt(preview: ReturnType<typeof buildImportPreview>, columnIndex: number) {
  return preview.mappings.find((mapping) => mapping.columnIndex === columnIndex)?.role;
}

test("buildImportPreview maps ticket sales workbook with sample rows", () => {
  const rows = [
    ["מספר הזמנה", "תאריך", "שם פרטי", "שם משפחה", "טלפון", "מייל", "סכום", "סכום לפי מטבע דיפולטיבי", "כמות כרטיסים"],
    ["15396725", "31.05.2026", "יפעת", "יחזקאל", "050-8327991", "yifnaor@gmail.com", "150.00₪", "150", "3"],
    ["15396726", "01.06.2026", "דני", "כהן", "050-1111111", "d@x.com", "200.00₪", "200", "2"],
  ];
  const buffer = workbookToBuffer(rows);

  const preview = buildImportPreview({
    buffer,
    fileName: "tickets.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  assert.equal(preview.fileKind, "sales");
  assert.equal(roleAt(preview, 2), "firstName");
  assert.equal(roleAt(preview, 5), "email");
  assert.equal(roleAt(preview, 6), "amount");
  assert.equal(preview.sampleRows.length, 2);
  assert.equal(preview.totalDataRows, 2);
});

test("buildImportPreview classifies bank statement workbook", () => {
  const rows = [
    ["תאריך", "אסמכתא", "זכות", "חובה", "יתרה"],
    ["01.01.2026", "123", "100", "", "1100"],
  ];
  const buffer = workbookToBuffer(rows);

  const preview = buildImportPreview({
    buffer,
    fileName: "bank.csv",
    mimeType: "text/csv",
  });

  assert.equal(preview.fileKind, "bank_statement");
  assert.equal(preview.fileType, "csv");
});

test("buildImportPreview limits sample rows to 10", () => {
  const header = ["שם", "מייל", "סכום"];
  const dataRows = Array.from({ length: 15 }, (_, index) => [`לקוח ${index + 1}`, `user${index + 1}@x.com`, String((index + 1) * 10)]);
  const buffer = workbookToBuffer([header, ...dataRows]);

  const preview = buildImportPreview({
    buffer,
    fileName: "sales.xlsx",
  });

  assert.equal(preview.sampleRows.length, 10);
  assert.equal(preview.totalDataRows, 15);
});
