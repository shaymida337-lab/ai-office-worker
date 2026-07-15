import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { CROSS_ORG_QUARANTINE_MARKER } from "./crossOrgGmailQuarantine.js";
import { SHARON_CONFIRMED_ALLOWLIST } from "./sharonContaminationAllowlist.js";
import {
  buildFinancialDocumentReviewReadIsolationWhere,
  buildGmailScanItemReadIsolationWhere,
  buildSupplierPaymentReadIsolationWhere,
  crossOrgGmailIdsExcludedForOrganization,
  mergePrismaWhere,
} from "./financialReadIsolation.js";

const ORG_A = "org-a";
const ORG_SHARON = SHARON_CONFIRMED_ALLOWLIST.organizationId;
const ALLOWLISTED_GMAIL = SHARON_CONFIRMED_ALLOWLIST.gmailMessageIds[0]!;
const CONTAMINATED = ["gmail-cross-1", "gmail-cross-2", ALLOWLISTED_GMAIL];

const NULL_SAFE_DUPLICATE_REASON = [
  { duplicateReason: null },
  { NOT: { duplicateReason: { contains: CROSS_ORG_QUARANTINE_MARKER } } },
];
const NULL_SAFE_UNCERTAINTY_REASON = [
  { uncertaintyReason: null },
  { NOT: { uncertaintyReason: { contains: CROSS_ORG_QUARANTINE_MARKER } } },
];

function isolationParts(where: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(where.AND)) return where.AND as Record<string, unknown>[];
  return [where];
}

test("buildSupplierPaymentReadIsolationWhere uses emailMessageId not gmailMessageId", () => {
  const where = buildSupplierPaymentReadIsolationWhere(ORG_A, CONTAMINATED);
  assert.equal("gmailMessageId" in where, false);
  const parts = isolationParts(where as Record<string, unknown>);
  assert.deepEqual(parts[0]?.OR, NULL_SAFE_DUPLICATE_REASON);
  assert.deepEqual(parts[1]?.OR, [
    { emailMessageId: null },
    { emailMessageId: { notIn: CONTAMINATED } },
  ]);
  const _typecheck: Prisma.SupplierPaymentWhereInput = where;
  assert.ok(_typecheck);
});

test("buildFinancialDocumentReviewReadIsolationWhere keeps gmailMessageId null-safe", () => {
  const where = buildFinancialDocumentReviewReadIsolationWhere(ORG_A, CONTAMINATED);
  assert.equal("emailMessageId" in where, false);
  const parts = isolationParts(where as Record<string, unknown>);
  assert.deepEqual(parts[0]?.OR, NULL_SAFE_UNCERTAINTY_REASON);
  assert.deepEqual(parts[1]?.OR, [
    { gmailMessageId: null },
    { gmailMessageId: { notIn: CONTAMINATED } },
  ]);
  const _typecheck: Prisma.FinancialDocumentReviewWhereInput = where;
  assert.ok(_typecheck);
});

test("buildGmailScanItemReadIsolationWhere uses notIn only (gmailMessageId is required)", () => {
  const where = buildGmailScanItemReadIsolationWhere(ORG_A, CONTAMINATED);
  // Gmail scan rows always have a gmailMessageId — never use `{ gmailMessageId: null }`.
  assert.equal("OR" in where, false);
  assert.equal("emailMessageId" in where, false);
  assert.deepEqual(where.gmailMessageId, { notIn: CONTAMINATED });
  const _typecheck: Prisma.GmailScanItemWhereInput = where;
  assert.ok(_typecheck);
});

test("buildGmailScanItemReadIsolationWhere is accepted by Prisma (null branch must never appear)", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const where = buildGmailScanItemReadIsolationWhere(ORG_A, CONTAMINATED);
  try {
    await prisma.gmailScanItem.findMany({ where, take: 1 });
  } finally {
    await prisma.$disconnect();
  }
});

test("camera FDR null gmailMessageId and Gmail FDR id both stay eligible under isolation", () => {
  const where = buildFinancialDocumentReviewReadIsolationWhere(ORG_A, ["gmail-cross-1"]);
  const parts = isolationParts(where as Record<string, unknown>);
  assert.deepEqual(parts[1]?.OR, [
    { gmailMessageId: null },
    { gmailMessageId: { notIn: ["gmail-cross-1"] } },
  ]);
});

test("supplier payment isolation excludes cross-org contaminated ids for other orgs", () => {
  const excluded = crossOrgGmailIdsExcludedForOrganization(ORG_A, CONTAMINATED);
  assert.deepEqual(excluded, CONTAMINATED);
  const where = buildSupplierPaymentReadIsolationWhere(ORG_A, CONTAMINATED);
  const parts = isolationParts(where as Record<string, unknown>);
  assert.deepEqual(parts[1]?.OR, [
    { emailMessageId: null },
    { emailMessageId: { notIn: CONTAMINATED } },
  ]);
});

test("supplier payment isolation honors sharon allowlist for contaminated gmail ids", () => {
  const excludedForSharon = crossOrgGmailIdsExcludedForOrganization(ORG_SHARON, CONTAMINATED);
  assert.deepEqual(excludedForSharon, ["gmail-cross-1", "gmail-cross-2"]);
  const where = buildSupplierPaymentReadIsolationWhere(ORG_SHARON, CONTAMINATED);
  const parts = isolationParts(where as Record<string, unknown>);
  assert.deepEqual(parts[1]?.OR, [
    { emailMessageId: null },
    { emailMessageId: { notIn: ["gmail-cross-1", "gmail-cross-2"] } },
  ]);
});

test("supplier payment isolation keeps null duplicateReason rows when contaminated list empty", () => {
  const where = buildSupplierPaymentReadIsolationWhere(ORG_A, []);
  assert.deepEqual(where.OR, NULL_SAFE_DUPLICATE_REASON);
  assert.equal(where.AND, undefined);
});

test("supplier payment isolation keeps null emailMessageId and null duplicateReason eligible", () => {
  const where = mergePrismaWhere(
    { organizationId: ORG_A, approvalStatus: "approved" },
    buildSupplierPaymentReadIsolationWhere(ORG_A, ["foreign-gmail"]),
  );
  const parts = isolationParts(where as Record<string, unknown>);
  assert.deepEqual(parts[0]?.OR, NULL_SAFE_DUPLICATE_REASON);
  assert.deepEqual(parts[1]?.OR, [
    { emailMessageId: null },
    { emailMessageId: { notIn: ["foreign-gmail"] } },
  ]);
  assert.equal(where.organizationId, ORG_A);
});

test("financial document review isolation still filters gmailMessageId null-safe", () => {
  const where = buildFinancialDocumentReviewReadIsolationWhere(ORG_A, ["foreign-gmail"]);
  const parts = isolationParts(where as Record<string, unknown>);
  assert.deepEqual(parts[1]?.OR, [
    { gmailMessageId: null },
    { gmailMessageId: { notIn: ["foreign-gmail"] } },
  ]);
});

test("nullable quarantine exclusion keeps duplicateReason null eligible in where shape", () => {
  const where = buildSupplierPaymentReadIsolationWhere(ORG_A, []);
  assert.deepEqual(where.OR?.[0], { duplicateReason: null });
  assert.deepEqual(where.OR?.[1], {
    NOT: { duplicateReason: { contains: CROSS_ORG_QUARANTINE_MARKER } },
  });
});
