import * as XLSX from "xlsx";
import { prisma } from "../../lib/prisma.js";
import { normalizeClientEmailInput } from "../clientContact.js";
import { normalizeWhatsAppNumber } from "../whatsapp.js";

export type ClientImportField = "name" | "phone" | "email" | "address" | "notes";

export type ClientImportColumnMapping = {
  columnIndex: number;
  header: string;
  field: ClientImportField | "unknown";
  confidence: number;
};

export type ClientImportPreviewRow = {
  rowIndex: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  /** create = new, update = matched duplicate, skip = error */
  action: "create" | "update" | "skip";
  matchClientId: string | null;
  matchClientName: string | null;
  error: string | null;
};

export type ClientImportPreviewResult = {
  fileType: "excel" | "csv";
  sheetName: string;
  headerRowIndex: number;
  mappings: ClientImportColumnMapping[];
  rows: ClientImportPreviewRow[];
  warnings: string[];
  counts: {
    total: number;
    create: number;
    update: number;
    skip: number;
  };
};

export type ClientImportExecuteRow = {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
};

export type ClientImportExecuteResult = {
  added: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; error: string }>;
};

const FIELD_KEYWORDS: Record<ClientImportField, string[]> = {
  name: ["שם לקוח", "שם מלא", "שם", "לקוח", "customer", "client", "full name", "name", "contact"],
  phone: ["טלפון", "נייד", "פלאפון", "וואטסאפ", "whatsapp", "phone", "mobile", "tel", "cell"],
  email: ['מייל', 'אימייל', 'דוא"ל', "דואר אלקטרוני", "email", "mail", "e-mail"],
  address: ["כתובת", "כתובת מלאה", "עיר", "address", "city", "street", "location"],
  notes: ["הערות", "הערה", "הערת", "notes", "note", "comment", "comments", "remarks"],
};

const MAX_IMPORT_ROWS = 500;

export function detectClientImportColumns(rows: string[][]): {
  headerRowIndex: number;
  mappings: ClientImportColumnMapping[];
  warnings: string[];
} {
  const warnings: string[] = [];
  let bestHeaderRowIndex = -1;
  let bestScore = 0;

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 25); rowIndex += 1) {
    const score = scoreHeaderRow(rows[rowIndex] ?? []);
    if (score > bestScore) {
      bestScore = score;
      bestHeaderRowIndex = rowIndex;
    }
  }

  if (bestScore === 0 || bestHeaderRowIndex < 0) {
    return { headerRowIndex: -1, mappings: [], warnings: ["לא זוהתה שורת כותרות"] };
  }

  const headerRow = rows[bestHeaderRowIndex] ?? [];
  const mappings: ClientImportColumnMapping[] = [];
  const claimed = new Set<ClientImportField>();

  for (let columnIndex = 0; columnIndex < headerRow.length; columnIndex += 1) {
    const header = String(headerRow[columnIndex] ?? "").trim();
    if (!header) continue;
    const { field, confidence } = matchField(header);
    if (field !== "unknown" && claimed.has(field)) {
      mappings.push({ columnIndex, header, field: "unknown", confidence: 0 });
      warnings.push(`עמודת "${header}" זוהתה כ-${field} אבל השדה כבר משויך`);
      continue;
    }
    if (field !== "unknown") claimed.add(field);
    mappings.push({ columnIndex, header, field, confidence });
  }

  if (![...claimed].includes("name")) {
    warnings.push("לא זוהתה עמודת שם — שורות ללא שם יידחו");
  }

  return { headerRowIndex: bestHeaderRowIndex, mappings, warnings };
}

export function parseClientImportWorkbook(buffer: Buffer, fileName: string): {
  fileType: "excel" | "csv";
  sheetName: string;
  rows: string[][];
} {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("הקובץ ריק או לא תקין");
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });
  const rows = rawRows.map((row) => (row ?? []).map(cellToString));
  return {
    fileType: fileName.toLowerCase().endsWith(".csv") ? "csv" : "excel",
    sheetName,
    rows,
  };
}

export function extractClientImportRecords(
  dataRows: string[][],
  mappings: ClientImportColumnMapping[]
): ClientImportExecuteRow[] {
  const byField = new Map<ClientImportField, number>();
  for (const mapping of mappings) {
    if (mapping.field === "unknown") continue;
    if (!byField.has(mapping.field)) byField.set(mapping.field, mapping.columnIndex);
  }

  const records: ClientImportExecuteRow[] = [];
  for (const row of dataRows) {
    const name = cellAt(row, byField.get("name")).trim();
    const phone = emptyToNull(cellAt(row, byField.get("phone")));
    const email = emptyToNull(cellAt(row, byField.get("email")));
    const address = emptyToNull(cellAt(row, byField.get("address")));
    const notes = emptyToNull(cellAt(row, byField.get("notes")));
    if (!name && !phone && !email && !address && !notes) continue;
    records.push({ name, phone, email, address, notes });
  }
  return records;
}

export function phoneMatchKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 9) return null;
  return digits.slice(-9);
}

export async function previewClientImport(input: {
  organizationId: string;
  buffer: Buffer;
  fileName: string;
}): Promise<ClientImportPreviewResult> {
  const parsed = parseClientImportWorkbook(input.buffer, input.fileName);
  const detected = detectClientImportColumns(parsed.rows);
  if (detected.headerRowIndex < 0) {
    return {
      fileType: parsed.fileType,
      sheetName: parsed.sheetName,
      headerRowIndex: -1,
      mappings: [],
      rows: [],
      warnings: detected.warnings,
      counts: { total: 0, create: 0, update: 0, skip: 0 },
    };
  }

  const dataRows = parsed.rows.slice(detected.headerRowIndex + 1);
  const records = extractClientImportRecords(dataRows, detected.mappings).slice(0, MAX_IMPORT_ROWS);
  const existing = await loadExistingClientsForMatch(input.organizationId);
  const previewRows = buildPreviewRows(records, existing);

  return {
    fileType: parsed.fileType,
    sheetName: parsed.sheetName,
    headerRowIndex: detected.headerRowIndex,
    mappings: detected.mappings,
    rows: previewRows,
    warnings: [
      ...detected.warnings,
      ...(dataRows.length > MAX_IMPORT_ROWS
        ? [`יובאו רק ${MAX_IMPORT_ROWS} השורות הראשונות מתוך ${dataRows.length}`]
        : []),
    ],
    counts: {
      total: previewRows.length,
      create: previewRows.filter((row) => row.action === "create").length,
      update: previewRows.filter((row) => row.action === "update").length,
      skip: previewRows.filter((row) => row.action === "skip").length,
    },
  };
}

export async function executeClientImport(input: {
  organizationId: string;
  rows: ClientImportExecuteRow[];
}): Promise<ClientImportExecuteResult> {
  const limited = input.rows.slice(0, MAX_IMPORT_ROWS);
  const existing = await loadExistingClientsForMatch(input.organizationId);
  const previewRows = buildPreviewRows(limited, existing);

  let added = 0;
  let updated = 0;
  let skipped = 0;
  const errors: Array<{ row: number; error: string }> = [];

  for (const row of previewRows) {
    if (row.action === "skip") {
      skipped += 1;
      if (row.error) errors.push({ row: row.rowIndex, error: row.error });
      continue;
    }

    try {
      if (row.action === "update" && row.matchClientId) {
        await updateImportedClient(input.organizationId, row.matchClientId, row);
        // Keep match indexes fresh for later rows in the same batch.
        refreshMatchIndexes(existing, {
          id: row.matchClientId,
          name: row.name,
          email: row.email,
          phone: row.phone,
          whatsappNumber: row.phone,
        });
        updated += 1;
      } else {
        const created = await createImportedClient(input.organizationId, row);
        refreshMatchIndexes(existing, {
          id: created.id,
          name: created.name,
          email: created.email,
          phone: created.phone,
          whatsappNumber: created.whatsappNumber,
        });
        added += 1;
      }
    } catch (err) {
      skipped += 1;
      errors.push({
        row: row.rowIndex,
        error: err instanceof Error ? err.message : "ייבוא השורה נכשל",
      });
    }
  }

  return { added, updated, skipped, errors };
}

type ExistingClient = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsappNumber: string | null;
};

type MatchIndex = {
  byEmail: Map<string, ExistingClient>;
  byPhone: Map<string, ExistingClient>;
};

async function loadExistingClientsForMatch(organizationId: string): Promise<MatchIndex> {
  const clients = await prisma.client.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, name: true, email: true, phone: true, whatsappNumber: true },
  });
  const index: MatchIndex = { byEmail: new Map(), byPhone: new Map() };
  for (const client of clients) refreshMatchIndexes(index, client);
  return index;
}

function refreshMatchIndexes(index: MatchIndex, client: ExistingClient): void {
  const email = normalizeClientEmailInput(client.email);
  if (email) index.byEmail.set(email, client);
  for (const raw of [client.phone, client.whatsappNumber]) {
    const key = phoneMatchKey(raw);
    if (key) index.byPhone.set(key, client);
  }
}

function buildPreviewRows(records: ClientImportExecuteRow[], existing: MatchIndex): ClientImportPreviewRow[] {
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  const rows: ClientImportPreviewRow[] = [];

  records.forEach((record, index) => {
    const rowIndex = index + 1;
    const name = record.name?.trim() ?? "";
    const rawEmail = record.email?.trim() ?? "";
    const rawPhone = record.phone?.trim() ?? "";
    const address = emptyToNull(record.address);
    const notes = emptyToNull(record.notes);

    let email: string | null = null;
    if (rawEmail) {
      email = normalizeClientEmailInput(rawEmail);
      if (!email || !isValidEmail(email)) {
        rows.push({
          rowIndex,
          name,
          phone: emptyToNull(rawPhone),
          email: rawEmail,
          address,
          notes,
          action: "skip",
          matchClientId: null,
          matchClientName: null,
          error: "כתובת מייל לא תקינה",
        });
        return;
      }
    }

    const phone = emptyToNull(rawPhone);
    const phoneKey = phoneMatchKey(phone);

    if (!name) {
      rows.push({
        rowIndex,
        name: "",
        phone,
        email,
        address,
        notes,
        action: "skip",
        matchClientId: null,
        matchClientName: null,
        error: "חסר שם לקוח",
      });
      return;
    }

    if (email && seenEmails.has(email)) {
      rows.push({
        rowIndex,
        name,
        phone,
        email,
        address,
        notes,
        action: "skip",
        matchClientId: null,
        matchClientName: null,
        error: "כפילות בקובץ לפי מייל",
      });
      return;
    }
    if (phoneKey && seenPhones.has(phoneKey)) {
      rows.push({
        rowIndex,
        name,
        phone,
        email,
        address,
        notes,
        action: "skip",
        matchClientId: null,
        matchClientName: null,
        error: "כפילות בקובץ לפי טלפון",
      });
      return;
    }

    const match =
      (email ? existing.byEmail.get(email) : undefined) ??
      (phoneKey ? existing.byPhone.get(phoneKey) : undefined) ??
      null;

    if (email) seenEmails.add(email);
    if (phoneKey) seenPhones.add(phoneKey);

    rows.push({
      rowIndex,
      name,
      phone,
      email,
      address,
      notes,
      action: match ? "update" : "create",
      matchClientId: match?.id ?? null,
      matchClientName: match?.name ?? null,
      error: null,
    });
  });

  return rows;
}

async function createImportedClient(
  organizationId: string,
  row: ClientImportPreviewRow
): Promise<{ id: string; name: string; email: string | null; phone: string | null; whatsappNumber: string | null }> {
  const count = await prisma.client.count({ where: { organizationId } });
  const colors = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];
  const created = await prisma.client.create({
    data: {
      organizationId,
      name: row.name,
      email: row.email,
      emailIsPlaceholder: false,
      phone: row.phone,
      whatsappNumber: row.phone ? normalizeWhatsAppNumber(row.phone) : null,
      address: row.address,
      color: colors[count % colors.length],
      isActive: true,
    },
    select: { id: true, name: true, email: true, phone: true, whatsappNumber: true },
  });
  if (row.notes) {
    await prisma.clientNote.create({
      data: {
        organizationId,
        clientId: created.id,
        body: row.notes,
      },
    });
  }
  return created;
}

async function updateImportedClient(
  organizationId: string,
  clientId: string,
  row: ClientImportPreviewRow
): Promise<void> {
  await prisma.client.update({
    where: { id: clientId },
    data: {
      name: row.name,
      ...(row.email ? { email: row.email, emailIsPlaceholder: false } : {}),
      ...(row.phone
        ? { phone: row.phone, whatsappNumber: normalizeWhatsAppNumber(row.phone) }
        : {}),
      ...(row.address ? { address: row.address } : {}),
    },
  });
  if (row.notes) {
    await prisma.clientNote.create({
      data: {
        organizationId,
        clientId,
        body: row.notes,
      },
    });
  }
}

function scoreHeaderRow(row: string[]): number {
  let score = 0;
  for (const cell of row) {
    const { field, confidence } = matchField(String(cell ?? ""));
    if (field !== "unknown") score += confidence;
  }
  return score;
}

function matchField(header: string): { field: ClientImportField | "unknown"; confidence: number } {
  const normalized = header.trim().toLowerCase();
  if (!normalized) return { field: "unknown", confidence: 0 };
  const tokens = normalized.split(/[\s_/\-]+/).filter(Boolean);

  let best: { field: ClientImportField | "unknown"; confidence: number } = {
    field: "unknown",
    confidence: 0,
  };

  for (const field of Object.keys(FIELD_KEYWORDS) as ClientImportField[]) {
    for (const keyword of FIELD_KEYWORDS[field]) {
      const key = keyword.toLowerCase();
      if (normalized === key) {
        return { field, confidence: 1 };
      }
      if (tokens.includes(key)) {
        const confidence = 0.95;
        if (confidence > best.confidence) best = { field, confidence };
        continue;
      }
      // Longer phrases only (e.g. "שם לקוח") — avoid "name" matching inside "notes".
      if (key.includes(" ") && normalized.includes(key)) {
        const confidence = 0.9;
        if (confidence > best.confidence) best = { field, confidence };
      }
    }
  }
  return best;
}

function cellAt(row: string[], index: number | undefined): string {
  if (index == null || index < 0) return "";
  return String(row[index] ?? "").trim();
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
