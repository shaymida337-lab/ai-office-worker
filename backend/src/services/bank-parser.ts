import * as XLSX from "xlsx";

export type BankTransactionDirection = "credit" | "debit";

export type ParsedBankTransaction = {
  date: Date;
  amount: number;
  description: string | null;
  direction: BankTransactionDirection;
  rawData: string;
};

export type BankParserInput = {
  buffer: Buffer;
  fileName: string;
  mimeType?: string | null;
};

export type BankParserResult = {
  fileType: "excel" | "csv";
  sheetName: string;
  headerRowIndex: number;
  detectedColumns: {
    date: number | null;
    amount: number | null;
    credit: number | null;
    debit: number | null;
    description: number | null;
    direction: number | null;
  };
  transactions: ParsedBankTransaction[];
  warnings: string[];
};

type Row = unknown[];

const DATE_HEADERS = [
  "תאריך",
  "תאריך ערך",
  "תאריך פעולה",
  "תאריך עסקה",
  "date",
  "value date",
  "transaction date",
  "booking date",
];

const AMOUNT_HEADERS = ["סכום", "amount", "transaction amount", "סכום עסקה", "סכום בשח", "סכום בש\"ח"];
const CREDIT_HEADERS = ["זכות", "credit", "credits", "deposit", "deposits", "הפקדה", "הכנסה"];
const DEBIT_HEADERS = ["חובה", "debit", "debits", "withdrawal", "withdrawals", "חיוב", "הוצאה"];
const DESCRIPTION_HEADERS = [
  "תיאור",
  "פרטים",
  "תאור",
  "description",
  "details",
  "asmachta",
  "אסמכתא",
  "reference",
  "memo",
  "payee",
];
const DIRECTION_HEADERS = ["direction", "כיוון", "סוג", "סוג פעולה", "חובה זכות", "חיוב זיכוי"];

export function parseBankStatementFile(input: BankParserInput): BankParserResult {
  const workbook = XLSX.read(input.buffer, {
    type: "buffer",
    cellDates: true,
    raw: false,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Bank statement file does not contain any sheets");
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });

  const fileType = detectFileType(input.fileName, input.mimeType);
  const { headerRowIndex, columns } = detectColumns(rows);
  if (headerRowIndex === -1 || columns.date === null || (columns.amount === null && columns.credit === null && columns.debit === null)) {
    throw new Error("Could not detect required bank statement columns: date and amount/credit/debit");
  }

  const warnings: string[] = [];
  const transactions: ParsedBankTransaction[] = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    if (isEmptyRow(row)) continue;

    const date = parseBankDate(cell(row, columns.date));
    if (!date) {
      warnings.push(`Skipped row ${rowIndex + 1}: could not parse date`);
      continue;
    }

    const parsedAmount = parseBankAmountForRow(row, columns);
    if (!parsedAmount) {
      warnings.push(`Skipped row ${rowIndex + 1}: could not parse amount`);
      continue;
    }

    const description = columns.description === null ? fallbackDescription(row, columns) : stringValue(cell(row, columns.description));
    transactions.push({
      date,
      amount: parsedAmount.amount,
      direction: parsedAmount.direction,
      description: description || null,
      rawData: JSON.stringify(row),
    });
  }

  return {
    fileType,
    sheetName,
    headerRowIndex,
    detectedColumns: columns,
    transactions,
    warnings,
  };
}

function detectFileType(fileName: string, mimeType?: string | null): "excel" | "csv" {
  const lowerName = fileName.toLowerCase();
  const lowerMime = (mimeType ?? "").toLowerCase();
  if (lowerName.endsWith(".csv") || lowerMime.includes("csv")) return "csv";
  return "excel";
}

function detectColumns(rows: Row[]) {
  let best = {
    headerRowIndex: -1,
    score: 0,
    columns: emptyColumns(),
  };

  for (let index = 0; index < Math.min(rows.length, 25); index += 1) {
    const row = rows[index] ?? [];
    const columns = emptyColumns();

    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const header = normalizeHeader(stringValue(row[columnIndex]));
      if (!header) continue;

      if (columns.date === null && matchesHeader(header, DATE_HEADERS)) columns.date = columnIndex;
      if (columns.amount === null && matchesHeader(header, AMOUNT_HEADERS)) columns.amount = columnIndex;
      if (columns.credit === null && matchesHeader(header, CREDIT_HEADERS)) columns.credit = columnIndex;
      if (columns.debit === null && matchesHeader(header, DEBIT_HEADERS)) columns.debit = columnIndex;
      if (columns.description === null && matchesHeader(header, DESCRIPTION_HEADERS)) columns.description = columnIndex;
      if (columns.direction === null && matchesHeader(header, DIRECTION_HEADERS)) columns.direction = columnIndex;
    }

    const score = scoreColumns(columns);
    if (score > best.score) {
      best = { headerRowIndex: index, score, columns };
    }
  }

  return { headerRowIndex: best.headerRowIndex, columns: best.columns };
}

function emptyColumns() {
  return {
    date: null as number | null,
    amount: null as number | null,
    credit: null as number | null,
    debit: null as number | null,
    description: null as number | null,
    direction: null as number | null,
  };
}

function scoreColumns(columns: ReturnType<typeof emptyColumns>) {
  let score = 0;
  if (columns.date !== null) score += 4;
  if (columns.amount !== null) score += 3;
  if (columns.credit !== null) score += 2;
  if (columns.debit !== null) score += 2;
  if (columns.description !== null) score += 1;
  if (columns.direction !== null) score += 1;
  if (columns.date !== null && (columns.amount !== null || columns.credit !== null || columns.debit !== null)) score += 5;
  return score;
}

function parseBankAmountForRow(row: Row, columns: ReturnType<typeof emptyColumns>): { amount: number; direction: BankTransactionDirection } | null {
  const credit = columns.credit === null ? null : parseBankAmount(cell(row, columns.credit));
  const debit = columns.debit === null ? null : parseBankAmount(cell(row, columns.debit));

  if (credit !== null && credit > 0) return { amount: credit, direction: "credit" };
  if (debit !== null && debit > 0) return { amount: debit, direction: "debit" };

  if (columns.amount === null) return null;
  const amount = parseBankAmount(cell(row, columns.amount));
  if (amount === null || amount === 0) return null;

  const directionText = columns.direction === null ? "" : normalizeHeader(stringValue(cell(row, columns.direction)));
  const direction = directionFromText(directionText) ?? (amount < 0 ? "debit" : "credit");
  return { amount: Math.abs(amount), direction };
}

function directionFromText(value: string): BankTransactionDirection | null {
  if (!value) return null;
  if (matchesHeader(value, CREDIT_HEADERS) || value.includes("זיכוי")) return "credit";
  if (matchesHeader(value, DEBIT_HEADERS) || value.includes("חיוב")) return "debit";
  return null;
}

function parseBankDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(parsed.y, parsed.m - 1, parsed.d);
  }

  const text = stringValue(value);
  if (!text) return null;

  const parts = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (parts) {
    const day = Number(parts[1]);
    const month = Number(parts[2]);
    const year = Number(parts[3].length === 2 ? `20${parts[3]}` : parts[3]);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = new Date(text);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function parseBankAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = stringValue(value);
  if (!text || text === "-") return null;

  const negative = /^\s*\(.*\)\s*$/.test(text) || text.includes("-");
  const cleaned = text
    .replace(/[₪$€\s]/g, "")
    .replace(/[^\d.,()-]/g, "")
    .replace(/[()]/g, "")
    .replace(/(?!^)-/g, "");
  const amount = parseLocalizedNumber(cleaned);
  if (!Number.isFinite(amount)) return null;
  return negative ? -Math.abs(amount) : amount;
}

function parseLocalizedNumber(value: string) {
  const digitsAndSeparators = value.replace(/[^\d.,-]/g, "");
  if (!digitsAndSeparators || digitsAndSeparators === "-") return NaN;
  const lastDot = digitsAndSeparators.lastIndexOf(".");
  const lastComma = digitsAndSeparators.lastIndexOf(",");
  let normalized = digitsAndSeparators;

  if (lastDot !== -1 && lastComma !== -1) {
    normalized = lastComma > lastDot
      ? digitsAndSeparators.replace(/\./g, "").replace(",", ".")
      : digitsAndSeparators.replace(/,/g, "");
  } else if (lastComma !== -1) {
    normalized = digitsAndSeparators.length - lastComma - 1 === 2
      ? digitsAndSeparators.replace(",", ".")
      : digitsAndSeparators.replace(/,/g, "");
  }

  return Number(normalized);
}

function fallbackDescription(row: Row, columns: ReturnType<typeof emptyColumns>) {
  const ignored = new Set([columns.date, columns.amount, columns.credit, columns.debit, columns.direction].filter((value): value is number => value !== null));
  return row
    .filter((_, index) => !ignored.has(index))
    .map(stringValue)
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
}

function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .replace(/[״"׳'`]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesHeader(header: string, candidates: string[]) {
  return candidates.some((candidate) => {
    const normalized = normalizeHeader(candidate);
    return header === normalized || header.includes(normalized) || normalized.includes(header);
  });
}

function cell(row: Row, index: number | null) {
  return index === null ? "" : row[index];
}

function stringValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function isEmptyRow(row: Row) {
  return row.every((value) => stringValue(value) === "");
}
