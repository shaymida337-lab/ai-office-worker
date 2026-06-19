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
  | "unknown";

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
