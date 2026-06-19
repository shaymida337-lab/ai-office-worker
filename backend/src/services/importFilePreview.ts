import * as XLSX from "xlsx";
import {
  detectImportColumns,
  detectImportFileKind,
  type ColumnMapping,
  type ImportFileKind,
} from "./importColumnMapper.js";

export type ImportPreviewResult = {
  fileType: "excel" | "csv";
  sheetName: string;
  headerRowIndex: number;
  fileKind: ImportFileKind;
  fileKindConfidence: number;
  fileKindReason: string;
  mappings: ColumnMapping[];
  sampleRows: string[][];
  allRows: string[][];
  totalDataRows: number;
  warnings: string[];
};

export type ImportPreviewInput = {
  buffer: Buffer;
  fileName: string;
  mimeType?: string | null;
};

type RawRow = unknown[];

export function buildImportPreview(input: ImportPreviewInput): ImportPreviewResult {
  const workbook = XLSX.read(input.buffer, {
    type: "buffer",
    cellDates: true,
    raw: false,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("הקובץ ריק או לא תקין");
  }

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<RawRow>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });
  const rows = rawRows.map((row) => (row ?? []).map(cellToString));

  const columnResult = detectImportColumns(rows);
  const fileKindResult = detectImportFileKind(columnResult.mappings);

  const dataStartIndex = columnResult.headerRowIndex >= 0 ? columnResult.headerRowIndex + 1 : 0;
  const dataRows = rows.slice(dataStartIndex);
  const sampleRows = dataRows.slice(0, 10);

  return {
    fileType: detectFileType(input.fileName, input.mimeType),
    sheetName,
    headerRowIndex: columnResult.headerRowIndex,
    fileKind: fileKindResult.kind,
    fileKindConfidence: fileKindResult.confidence,
    fileKindReason: fileKindResult.reason,
    mappings: columnResult.mappings,
    sampleRows,
    allRows: dataRows,
    totalDataRows: dataRows.length,
    warnings: columnResult.warnings,
  };
}

function detectFileType(fileName: string, mimeType?: string | null): "excel" | "csv" {
  const lowerName = fileName.toLowerCase();
  const lowerMime = (mimeType ?? "").toLowerCase();
  if (lowerName.endsWith(".csv") || lowerMime.includes("csv")) return "csv";
  return "excel";
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}
