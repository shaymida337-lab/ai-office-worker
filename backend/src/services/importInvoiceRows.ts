import type { ColumnMapping, ImportColumnRole } from "./importColumnMapper.js";
import type { InvoiceDraftInput } from "./outgoingInvoiceDraft.js";

export function buildInvoiceDraftsFromRows(input: {
  rows: string[][];
  mappings: ColumnMapping[];
}): { drafts: InvoiceDraftInput[]; warnings: string[] } {
  const roleColumns = buildRoleColumnMap(input.mappings);
  const drafts: InvoiceDraftInput[] = [];
  const warnings: string[] = [];

  input.rows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    if (isEmptyRow(row)) return;

    const customerName = buildCustomerName({
      customerName: cellValue(row, roleColumns.get("customerName")),
      firstName: cellValue(row, roleColumns.get("firstName")),
      lastName: cellValue(row, roleColumns.get("lastName")),
    });
    if (!customerName) {
      warnings.push(`שורה ${rowNumber}: חסר שם לקוח, דולגה`);
      return;
    }

    const amount = parseImportAmount(cellValue(row, roleColumns.get("amount")));
    if (amount === null) {
      warnings.push(`שורה ${rowNumber}: סכום לא תקין, דולגה`);
      return;
    }

    const description = buildDescription({
      description: cellValue(row, roleColumns.get("description")),
      quantity: cellValue(row, roleColumns.get("quantity")),
    });

    const customerEmail = cellValue(row, roleColumns.get("email"));
    const issueDate = cellValue(row, roleColumns.get("date"));

    drafts.push({
      customerName,
      amount,
      description,
      ...(customerEmail ? { customerEmail } : {}),
      ...(issueDate ? { issueDate } : {}),
    });
  });

  return { drafts, warnings };
}

function buildRoleColumnMap(mappings: ColumnMapping[]) {
  const roleColumns = new Map<ImportColumnRole, number>();
  const sorted = [...mappings].sort((left, right) => right.confidence - left.confidence);

  for (const mapping of sorted) {
    if (mapping.role === "unknown") continue;
    if (!roleColumns.has(mapping.role)) {
      roleColumns.set(mapping.role, mapping.columnIndex);
    }
  }

  return roleColumns;
}

function buildCustomerName(values: {
  customerName?: string;
  firstName?: string;
  lastName?: string;
}) {
  const direct = values.customerName?.trim();
  if (direct) return direct.replace(/\s+/g, " ");

  const firstName = values.firstName?.trim();
  const lastName = values.lastName?.trim();
  if (firstName && lastName) return `${firstName} ${lastName}`.replace(/\s+/g, " ");
  return (firstName || lastName || "").replace(/\s+/g, " ");
}

function buildDescription(values: { description?: string; quantity?: string }) {
  const description = values.description?.trim();
  if (description) return description;

  const quantity = values.quantity?.trim();
  if (quantity) return `כרטיסים: ${quantity}`;

  return "חיוב מיובא";
}

function cellValue(row: string[], columnIndex: number | undefined) {
  if (columnIndex === undefined) return "";
  return String(row[columnIndex] ?? "").trim();
}

function parseImportAmount(value: string): number | null {
  const text = value.trim();
  if (!text) return null;

  const negative = /^\s*\(.*\)\s*$/.test(text) || text.includes("-");
  const cleaned = text
    .replace(/[₪$€\s]/g, "")
    .replace(/[^\d.,()-]/g, "")
    .replace(/[()]/g, "")
    .replace(/(?!^)-/g, "");
  const amount = parseLocalizedNumber(cleaned);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return negative ? Math.abs(amount) : amount;
}

function parseLocalizedNumber(value: string) {
  const digitsAndSeparators = value.replace(/[^\d.,-]/g, "");
  if (!digitsAndSeparators || digitsAndSeparators === "-") return NaN;

  const lastDot = digitsAndSeparators.lastIndexOf(".");
  const lastComma = digitsAndSeparators.lastIndexOf(",");
  let normalized = digitsAndSeparators;

  if (lastDot !== -1 && lastComma !== -1) {
    normalized =
      lastComma > lastDot
        ? digitsAndSeparators.replace(/\./g, "").replace(",", ".")
        : digitsAndSeparators.replace(/,/g, "");
  } else if (lastComma !== -1) {
    normalized =
      digitsAndSeparators.length - lastComma - 1 === 2
        ? digitsAndSeparators.replace(",", ".")
        : digitsAndSeparators.replace(/,/g, "");
  }

  return Number(normalized);
}

function isEmptyRow(row: string[]) {
  return row.every((cell) => String(cell ?? "").trim() === "");
}
