export type ImportColumnRole =
  | "customerName"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "amount"
  | "date"
  | "quantity"
  | "description"
  | "credit"
  | "debit"
  | "balance"
  | "reference"
  | "unknown";

export type ImportFileKind = "sales" | "bank_statement" | "unknown";

export type ColumnMapping = {
  columnIndex: number;
  header: string;
  role: ImportColumnRole;
  confidence: number;
};

export type ColumnMappingResult = {
  headerRowIndex: number;
  mappings: ColumnMapping[];
  warnings: string[];
};

const ROLE_KEYWORDS: Record<Exclude<ImportColumnRole, "unknown">, string[]> = {
  customerName: ["שם לקוח", "שם מלא", "לקוח", "customer", "client", "full name", "name"],
  firstName: ["שם פרטי", "first name", "firstname", "פרטי"],
  lastName: ["שם משפחה", "last name", "lastname", "משפחה"],
  email: ['מייל', 'אימייל', 'דוא"ל', "email", "mail", "e-mail"],
  phone: ["טלפון", "נייד", "phone", "mobile", "tel"],
  amount: ["סכום", "מחיר", "total", "amount", "price", "sum", "₪", "סך"],
  date: ["תאריך", "date", "יום"],
  quantity: ["כמות", "qty", "quantity", "units", "יחידות"],
  description: ["תיאור", "פירוט", "description", "desc", "details", "מוצר", "פריט"],
  credit: ["זכות", "credit", "הפקדה", "זיכוי"],
  debit: ["חובה", "debit", "משיכה", "חיוב"],
  balance: ["יתרה", "balance"],
  reference: ["אסמכתא", "reference", "ref", "אישור"],
};

const KNOWN_ROLES = Object.keys(ROLE_KEYWORDS) as Exclude<ImportColumnRole, "unknown">[];

export function detectImportColumns(rows: string[][]): ColumnMappingResult {
  const warnings: string[] = [];
  let bestHeaderRowIndex = -1;
  let bestScore = 0;

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 25); rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const score = scoreHeaderRow(row);
    if (score > bestScore) {
      bestScore = score;
      bestHeaderRowIndex = rowIndex;
    }
  }

  if (bestScore === 0) {
    return {
      headerRowIndex: -1,
      mappings: [],
      warnings: ["לא זוהתה שורת כותרות"],
    };
  }

  const headerRow = rows[bestHeaderRowIndex] ?? [];
  const mappings: ColumnMapping[] = [];

  for (let columnIndex = 0; columnIndex < headerRow.length; columnIndex += 1) {
    const header = String(headerRow[columnIndex] ?? "").trim();
    if (!header) continue;

    const { role, confidence } = matchRole(header);
    mappings.push({ columnIndex, header, role, confidence });
  }

  const duplicates = new Map<ImportColumnRole, number[]>();
  for (const mapping of mappings) {
    if (mapping.role === "unknown") continue;
    const columns = duplicates.get(mapping.role) ?? [];
    columns.push(mapping.columnIndex);
    duplicates.set(mapping.role, columns);
  }

  for (const [role, columnIndexes] of duplicates) {
    if (columnIndexes.length > 1) {
      warnings.push(`כפילות בזיהוי: role ${role} בעמודות [${columnIndexes.join(", ")}]`);
    }
  }

  return {
    headerRowIndex: bestHeaderRowIndex,
    mappings,
    warnings,
  };
}

export function detectImportFileKind(mappings: ColumnMapping[]): {
  kind: ImportFileKind;
  confidence: number;
  reason: string;
} {
  const roles = new Set(
    mappings.filter((mapping) => mapping.role !== "unknown" && mapping.confidence > 0).map((mapping) => mapping.role)
  );

  const hasBankSignal = roles.has("credit") || roles.has("debit") || roles.has("balance");
  const hasCustomerSignal = roles.has("email") || roles.has("customerName") || roles.has("firstName");
  const hasSalesSignal = hasCustomerSignal && roles.has("amount");

  if (hasBankSignal && hasSalesSignal) {
    return {
      kind: "bank_statement",
      confidence: 0.6,
      reason: "זוהו גם עמודות מכירות וגם עמודות בנק — מעדיף דוח בנק כדי למנוע הנפקת חשבוניות שגויות",
    };
  }

  if (hasBankSignal) {
    return {
      kind: "bank_statement",
      confidence: 0.9,
      reason: "זוהו עמודות זכות/חובה/יתרה — נראה דוח בנק",
    };
  }

  if (hasSalesSignal) {
    return {
      kind: "sales",
      confidence: 0.9,
      reason: "זוהו שם/מייל וסכום — נראה קובץ מכירות",
    };
  }

  return {
    kind: "unknown",
    confidence: 0,
    reason: "לא זוהו מספיק עמודות לסיווג הקובץ",
  };
}

function scoreHeaderRow(row: string[]) {
  let score = 0;
  for (const cell of row) {
    const header = String(cell ?? "").trim();
    if (!header) continue;
    const { role, confidence } = matchRole(header);
    if (role !== "unknown" && confidence > 0) score += 1;
  }
  return score;
}

function matchRole(header: string): { role: ImportColumnRole; confidence: number } {
  const normalized = normalizeHeader(header);
  if (!normalized) return { role: "unknown", confidence: 0 };

  let bestRole: ImportColumnRole = "unknown";
  let bestConfidence = 0;

  for (const role of KNOWN_ROLES) {
    for (const keyword of ROLE_KEYWORDS[role]) {
      const normalizedKeyword = normalizeHeader(keyword);
      if (!normalizedKeyword) continue;

      if (normalized === normalizedKeyword) {
        return { role, confidence: 1.0 };
      }

      if (normalized.includes(normalizedKeyword) || normalizedKeyword.includes(normalized)) {
        if (bestConfidence < 0.7) {
          bestRole = role;
          bestConfidence = 0.7;
        }
      }
    }
  }

  return { role: bestRole, confidence: bestConfidence };
}

function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .replace(/[״"׳'`]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
