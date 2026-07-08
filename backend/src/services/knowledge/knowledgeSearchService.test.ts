import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import { runKnowledgeLookup } from "./knowledgeSearchService.js";

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
  storageLocation: string | null;
  metadata: null;
  createdAt: Date;
  updatedAt: Date;
  uploadedAt: Date;
};

const ORG = "org-A";
const OTHER_ORG = "org-B";

const DATA: Row[] = [
  row("k1", ORG, "חוזה שכירות שרית", "contract", "sarit-contract.pdf", "שרית"),
  row("k2", ORG, "אחריות מזגן", "warranty", "ac-warranty.pdf", null, null, ["מזגן"]),
  row("k3", ORG, "הצעת מחיר רונן", "quotation", "ronen-quote.pdf", "רונן"),
  row("k4", ORG, "חוזה שירות דני", "contract", "dani.pdf", "דני"),
  row("k5", ORG, "מדריך התקנה", "manual", "install-guide.pdf", null),
  row("k8", ORG, "רישיון ספק חשמל", "license", "electric-license.pdf", null, "חברת החשמל"),
  // A second document for שרית so an "any document" lookup returns multiple.
  row("k7", ORG, "הצעת מחיר שרית", "quotation", "sarit-quote.pdf", "שרית"),
  // Same-day contract for a DIFFERENT org — must never leak into ORG queries.
  row("k6", OTHER_ORG, "חוזה של לקוח אחר", "contract", "other.pdf", "שרית"),
];

function row(
  id: string,
  organizationId: string,
  title: string,
  category: string,
  fileName: string | null,
  customerName: string | null = null,
  supplierName: string | null = null,
  tags: string[] = []
): Row {
  const uploadedAt = new Date("2026-07-01T10:00:00.000Z");
  return {
    id,
    organizationId,
    source: "manual",
    title,
    category,
    fileName,
    customerName,
    supplierName,
    tags,
    driveUrl: `https://drive.example/${id}`,
    storageLocation: null,
    metadata: null,
    createdAt: uploadedAt,
    updatedAt: uploadedAt,
    uploadedAt,
  };
}

function contains(haystack: string | null, needle: string): boolean {
  return typeof haystack === "string" && haystack.toLowerCase().includes(needle.toLowerCase());
}

/** Minimal in-memory evaluator for the where clauses the repository builds. */
function matches(r: Row, where: Record<string, any>): boolean {
  if (where.organizationId && r.organizationId !== where.organizationId) return false;
  if (where.category && r.category !== where.category) return false;
  if (where.fileName?.contains && !contains(r.fileName, where.fileName.contains)) return false;
  if (where.tags?.has && !r.tags.includes(where.tags.has)) return false;
  if (Array.isArray(where.OR)) {
    const anyMatch = where.OR.some((clause: Record<string, any>) => {
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
  const original = {
    findMany: prisma.knowledgeDocument.findMany,
    count: prisma.knowledgeDocument.count,
  };
  (prisma as any).knowledgeDocument.findMany = async (args: any) =>
    DATA.filter((r) => matches(r, args.where ?? {}));
  (prisma as any).knowledgeDocument.count = async (args: any) =>
    DATA.filter((r) => matches(r, args.where ?? {})).length;
  return () => {
    (prisma as any).knowledgeDocument.findMany = original.findMany;
    (prisma as any).knowledgeDocument.count = original.count;
  };
}

test("search by customer returns that customer's document (open, single)", async () => {
  const restore = installMock();
  try {
    const res = await runKnowledgeLookup({ organizationId: ORG, text: "תפתחי את החוזה של דני" });
    assert.equal(res.count, 1);
    assert.equal(res.documents[0].customerName, "דני");
    assert.match(res.message, /מצאתי את חוזה שירות דני/);
  } finally {
    restore();
  }
});

test("search by document type (category) lists only that category", async () => {
  const restore = installMock();
  try {
    const res = await runKnowledgeLookup({ organizationId: ORG, text: "תראי את כל החוזים" });
    assert.equal(res.mode, "list");
    // Only ORG contracts (k1, k4) — never the other org's k6.
    assert.equal(res.count, 2);
    assert.ok(res.documents.every((d) => d.category === "contract"));
    assert.ok(res.documents.every((d) => d.id !== "k6"));
  } finally {
    restore();
  }
});

test("search by filename via subject match", async () => {
  const restore = installMock();
  try {
    const res = await runKnowledgeLookup({ organizationId: ORG, text: "תפתחי את המסמך של install-guide" });
    assert.equal(res.count, 1);
    assert.equal(res.documents[0].id, "k5");
  } finally {
    restore();
  }
});

test("search by item/warranty tag: 'האחריות של המזגן'", async () => {
  const restore = installMock();
  try {
    const res = await runKnowledgeLookup({ organizationId: ORG, text: "תראי לי את האחריות של המזגן" });
    assert.equal(res.count, 1);
    assert.equal(res.documents[0].id, "k2");
  } finally {
    restore();
  }
});

test("multiple results ask which to open", async () => {
  const restore = installMock();
  try {
    // "מסמך" = any category, subject שרית → k1 (contract) + k7 (quotation).
    const res = await runKnowledgeLookup({ organizationId: ORG, text: "תפתחי מסמך של שרית" });
    assert.equal(res.count, 2);
    assert.match(res.message, /מצאתי שני מסמכים:/);
    assert.match(res.message, /איזה מהם לפתוח\?/);
  } finally {
    restore();
  }
});

test("no results returns a clean not-found for the subject", async () => {
  const restore = installMock();
  try {
    const res = await runKnowledgeLookup({ organizationId: ORG, text: "תפתחי את החוזה של אבישי" });
    assert.equal(res.count, 0);
    assert.equal(res.message, "לא מצאתי מסמך עבור אבישי.");
  } finally {
    restore();
  }
});

test("count is organization-isolated", async () => {
  const restore = installMock();
  try {
    const res = await runKnowledgeLookup({ organizationId: ORG, text: "כמה חוזים יש לי" });
    assert.equal(res.mode, "count");
    assert.equal(res.count, 2); // k1, k4 — not the other org's k6
    assert.match(res.message, /יש לך 2 חוזים/);
  } finally {
    restore();
  }
});

test("search by supplier name", async () => {
  const restore = installMock();
  try {
    const res = await runKnowledgeLookup({ organizationId: ORG, text: "תפתחי את הרישיון של חברת החשמל" });
    assert.equal(res.count, 1);
    assert.equal(res.documents[0].id, "k8");
    assert.equal(res.documents[0].supplierName, "חברת החשמל");
  } finally {
    restore();
  }
});

test("organization isolation: org B sees only its own contract", async () => {
  const restore = installMock();
  try {
    const res = await runKnowledgeLookup({ organizationId: OTHER_ORG, text: "תראי את כל החוזים" });
    assert.equal(res.count, 1);
    assert.equal(res.documents[0].id, "k6");
  } finally {
    restore();
  }
});
