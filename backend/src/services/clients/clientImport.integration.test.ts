import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { prisma } from "../../lib/prisma.js";
import { executeClientImport, previewClientImport } from "./clientImport.js";

function workbookBuffer(rows: string[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "clients");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("preview + execute create new and update duplicate by phone", async () => {
  const originals = {
    findMany: prisma.client.findMany.bind(prisma.client),
    count: prisma.client.count.bind(prisma.client),
    create: prisma.client.create.bind(prisma.client),
    update: prisma.client.update.bind(prisma.client),
    noteCreate: prisma.clientNote.create.bind(prisma.clientNote),
  };

  const existing = [
    {
      id: "c1",
      name: "ישן",
      email: "old@example.com",
      phone: "0501112233",
      whatsappNumber: "whatsapp:+972501112233",
    },
  ];
  const created: unknown[] = [];
  const updated: unknown[] = [];
  const notes: unknown[] = [];

  prisma.client.findMany = (async () => existing) as typeof prisma.client.findMany;
  prisma.client.count = (async () => existing.length + created.length) as typeof prisma.client.count;
  prisma.client.create = (async ({ data }: { data: Record<string, unknown> }) => {
    const row = {
      id: `new-${created.length + 1}`,
      name: String(data.name),
      email: (data.email as string | null) ?? null,
      phone: (data.phone as string | null) ?? null,
      whatsappNumber: (data.whatsappNumber as string | null) ?? null,
    };
    created.push(row);
    existing.push(row);
    return row;
  }) as typeof prisma.client.create;
  prisma.client.update = (async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    updated.push({ id: where.id, data });
    const current = existing.find((item) => item.id === where.id);
    if (current) {
      if (typeof data.name === "string") current.name = data.name;
      if (typeof data.email === "string") current.email = data.email;
      if (typeof data.phone === "string") current.phone = data.phone;
    }
    return current;
  }) as typeof prisma.client.update;
  prisma.clientNote.create = (async ({ data }: { data: unknown }) => {
    notes.push(data);
    return { id: `n-${notes.length}` };
  }) as typeof prisma.clientNote.create;

  try {
    const buffer = workbookBuffer([
      ["שם", "טלפון", "מייל", "כתובת", "הערות"],
      ["מעודכן", "050-111-2233", "old@example.com", "ת״א", "הערה1"],
      ["חדש", "0529998887", "new@example.com", "חיפה", "הערה2"],
      ["", "0500000000", "bad", "", ""],
    ]);

    const preview = await previewClientImport({
      organizationId: "org-1",
      buffer,
      fileName: "clients.xlsx",
    });
    assert.equal(preview.counts.create, 1);
    assert.equal(preview.counts.update, 1);
    assert.equal(preview.counts.skip, 1);

    const result = await executeClientImport({
      organizationId: "org-1",
      rows: preview.rows.map((row) => ({
        name: row.name,
        phone: row.phone,
        email: row.email,
        address: row.address,
        notes: row.notes,
      })),
    });
    assert.equal(result.added, 1);
    assert.equal(result.updated, 1);
    assert.equal(result.skipped, 1);
    assert.equal(created.length, 1);
    assert.equal(updated.length, 1);
    assert.equal(notes.length, 2);
  } finally {
    prisma.client.findMany = originals.findMany;
    prisma.client.count = originals.count;
    prisma.client.create = originals.create;
    prisma.client.update = originals.update;
    prisma.clientNote.create = originals.noteCreate;
  }
});
