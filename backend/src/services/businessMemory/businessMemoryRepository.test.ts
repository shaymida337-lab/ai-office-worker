import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import {
  upsertBusinessMemoryDocument,
  searchBusinessMemory,
  countBusinessMemory,
} from "./businessMemoryRepository.js";
import { runBusinessMemoryLookup } from "./businessMemorySearchService.js";
import { buildCustomerWorkspace } from "./customerWorkspace.js";

const ORG = "org-memory-A";
const OTHER = "org-memory-B";

type Row = {
  id: string;
  organizationId: string;
  source: string;
  title: string;
  category: string;
  fileName: string | null;
  customerName: string | null;
  supplierName: string | null;
  tags: string[];
  driveUrl: string | null;
  driveFileId: string | null;
  storageLocation: string | null;
  metadata: null;
  createdAt: Date;
  updatedAt: Date;
  uploadedAt: Date;
};

let DATA: Row[] = [];

function row(
  id: string,
  organizationId: string,
  title: string,
  category: string,
  overrides: Partial<Row> = {}
): Row {
  const uploadedAt = new Date("2026-07-01T10:00:00.000Z");
  return {
    id,
    organizationId,
    source: "manual",
    title,
    category,
    fileName: `${id}.pdf`,
    customerName: null,
    supplierName: null,
    tags: [],
    driveUrl: `https://drive.example/${id}`,
    driveFileId: null,
    storageLocation: null,
    metadata: null,
    createdAt: uploadedAt,
    updatedAt: uploadedAt,
    uploadedAt,
    ...overrides,
  };
}

function matches(r: Row, where: Record<string, any>): boolean {
  if (where.organizationId && r.organizationId !== where.organizationId) return false;
  if (where.category && r.category !== where.category) return false;
  if (where.source && r.source !== where.source) return false;
  if (where.driveFileId && r.driveFileId !== where.driveFileId) return false;
  if (where.fileName?.contains && !r.fileName?.toLowerCase().includes(where.fileName.contains.toLowerCase()))
    return false;
  if (where.tags?.has && !r.tags.includes(where.tags.has)) return false;
  if (Array.isArray(where.OR)) {
    const anyMatch = where.OR.some((clause: Record<string, any>) => {
      const contains = (v: string | null, needle: string) =>
        v?.toLowerCase().includes(needle.toLowerCase());
      if (clause.customerName?.contains) return contains(r.customerName, clause.customerName.contains);
      if (clause.supplierName?.contains) return contains(r.supplierName, clause.supplierName.contains);
      if (clause.title?.contains) return contains(r.title, clause.title.contains);
      if (clause.fileName?.contains) return contains(r.fileName, clause.fileName.contains);
      if (clause.tags?.has) return r.tags.includes(clause.tags.has);
      return false;
    });
    if (!anyMatch) return false;
  }
  return true;
}

function installMock() {
  DATA = [
    row("m1", ORG, "חוזה שכירות שרית", "contract", { customerName: "שרית" }),
    row("m2", ORG, "אחריות מזגן", "warranty", { tags: ["מזגן"] }),
    row("m3", ORG, "הצעת מחיר רונן", "quotation", { customerName: "רונן" }),
    row("m4", ORG, "חוזה דני", "contract", { customerName: "דני", fileName: "dani.pdf" }),
    row("m5", OTHER, "חוזה זר", "contract", { customerName: "שרית" }),
    row("m6", ORG, "Drive חוזה", "contract", {
      source: "google_drive",
      driveFileId: "drive-file-1",
      customerName: "שרית",
    }),
  ];

  const original = {
    findMany: prisma.knowledgeDocument.findMany,
    count: prisma.knowledgeDocument.count,
    findFirst: prisma.knowledgeDocument.findFirst,
    create: prisma.knowledgeDocument.create,
    update: prisma.knowledgeDocument.update,
  };

  (prisma as any).knowledgeDocument.findMany = async (args: any) =>
    DATA.filter((r) => matches(r, args.where ?? {}));
  (prisma as any).knowledgeDocument.count = async (args: any) =>
    DATA.filter((r) => matches(r, args.where ?? {})).length;
  (prisma as any).knowledgeDocument.findFirst = async (args: any) =>
    DATA.find((r) => matches(r, args.where ?? {})) ?? null;
  (prisma as any).knowledgeDocument.create = async (args: any) => {
    const uploadedAt = new Date();
    const created: Row = {
      id: `new-${DATA.length + 1}`,
      organizationId: args.data.organizationId,
      source: args.data.source ?? "manual",
      title: args.data.title,
      category: args.data.category,
      fileName: args.data.fileName ?? null,
      customerName: args.data.customerName ?? null,
      supplierName: args.data.supplierName ?? null,
      tags: args.data.tags ?? [],
      driveUrl: args.data.driveUrl ?? null,
      driveFileId: args.data.driveFileId ?? null,
      storageLocation: args.data.storageLocation ?? null,
      metadata: null,
      createdAt: uploadedAt,
      updatedAt: uploadedAt,
      uploadedAt: args.data.uploadedAt ?? uploadedAt,
    };
    DATA.push(created);
    return created;
  };
  (prisma as any).knowledgeDocument.update = async (args: any) => {
    const idx = DATA.findIndex((r) => r.id === args.where.id);
    if (idx < 0) throw new Error("not found");
    DATA[idx] = { ...DATA[idx], ...args.data, updatedAt: new Date() };
    return DATA[idx];
  };

  return () => {
    (prisma as any).knowledgeDocument.findMany = original.findMany;
    (prisma as any).knowledgeDocument.count = original.count;
    (prisma as any).knowledgeDocument.findFirst = original.findFirst;
    (prisma as any).knowledgeDocument.create = original.create;
    (prisma as any).knowledgeDocument.update = original.update;
  };
}

test("search by customer", async () => {
  const restore = installMock();
  try {
    const docs = await searchBusinessMemory({ organizationId: ORG, subject: "דני" });
    assert.equal(docs.length, 1);
    assert.equal(docs[0].customer, "דני");
  } finally {
    restore();
  }
});

test("search by document type", async () => {
  const restore = installMock();
  try {
    const docs = await searchBusinessMemory({ organizationId: ORG, documentType: "contract" });
    assert.equal(docs.length, 3);
    assert.ok(docs.every((d) => d.documentType === "contract"));
  } finally {
    restore();
  }
});

test("search by tag", async () => {
  const restore = installMock();
  try {
    const res = await runBusinessMemoryLookup({ organizationId: ORG, text: "איפה האחריות של המזגן" });
    assert.equal(res.count, 1);
    assert.equal(res.documents[0].id, "m2");
  } finally {
    restore();
  }
});

test("search by title", async () => {
  const restore = installMock();
  try {
    const docs = await searchBusinessMemory({ organizationId: ORG, title: "רונן" });
    assert.equal(docs.length, 1);
    assert.equal(docs[0].id, "m3");
  } finally {
    restore();
  }
});

test("multiple results disambiguation in open mode", async () => {
  const restore = installMock();
  try {
    const res = await runBusinessMemoryLookup({ organizationId: ORG, text: "תפתחי מסמך של שרית" });
    assert.equal(res.count, 2);
    assert.match(res.message, /איזה מהם לפתוח\?/);
  } finally {
    restore();
  }
});

test("list mode returns documents without disambiguation prompt", async () => {
  const restore = installMock();
  try {
    const res = await runBusinessMemoryLookup({ organizationId: ORG, text: "איזה מסמכים יש לשרית" });
    assert.equal(res.count, 2);
    assert.equal(res.mode, "list");
    assert.doesNotMatch(res.message, /איזה מהם לפתוח\?/);
  } finally {
    restore();
  }
});

test("no results", async () => {
  const restore = installMock();
  try {
    const res = await runBusinessMemoryLookup({ organizationId: ORG, text: "תפתחי את החוזה של אבישי" });
    assert.equal(res.count, 0);
    assert.equal(res.message, "לא מצאתי מסמך עבור אבישי.");
  } finally {
    restore();
  }
});

test("organization isolation", async () => {
  const restore = installMock();
  try {
    const count = await countBusinessMemory({ organizationId: ORG, documentType: "contract" });
    assert.equal(count, 3);
    const otherCount = await countBusinessMemory({ organizationId: OTHER, documentType: "contract" });
    assert.equal(otherCount, 1);
  } finally {
    restore();
  }
});

test("drive duplicate prevention updates existing row", async () => {
  const restore = installMock();
  try {
    const first = await upsertBusinessMemoryDocument({
      organizationId: ORG,
      source: "google_drive",
      documentType: "contract",
      title: "חוזה Drive",
      driveFileId: "drive-dup-1",
      driveUrl: "https://drive.example/dup",
    });
    const second = await upsertBusinessMemoryDocument({
      organizationId: ORG,
      source: "google_drive",
      documentType: "contract",
      title: "חוזה Drive מעודכן",
      driveFileId: "drive-dup-1",
      driveUrl: "https://drive.example/dup-v2",
    });
    assert.equal(first.id, second.id);
    assert.equal(second.title, "חוזה Drive מעודכן");
    const driveRows = DATA.filter((r) => r.driveFileId === "drive-dup-1");
    assert.equal(driveRows.length, 1);
  } finally {
    restore();
  }
});

test("customer workspace groups contracts and documents", async () => {
  const restore = installMock();
  try {
    const workspace = await buildCustomerWorkspace({ organizationId: ORG, customerName: "שרית" });
    assert.equal(workspace.customerName, "שרית");
    assert.ok(workspace.sections.contracts.length >= 1);
    assert.equal(workspace.sections.invoices.length, 0);
    assert.equal(workspace.sections.meetings.length, 0);
  } finally {
    restore();
  }
});
