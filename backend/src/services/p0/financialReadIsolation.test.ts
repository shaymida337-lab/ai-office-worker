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

test("buildSupplierPaymentReadIsolationWhere uses emailMessageId not gmailMessageId", () => {
  const where = buildSupplierPaymentReadIsolationWhere(ORG_A, CONTAMINATED);
  assert.ok("OR" in where);
  assert.equal("gmailMessageId" in where, false);
  assert.deepEqual(where.OR, [
    { emailMessageId: null },
    { emailMessageId: { notIn: CONTAMINATED } },
  ]);
  const _typecheck: Prisma.SupplierPaymentWhereInput = where;
  assert.ok(_typecheck);
});

test("buildFinancialDocumentReviewReadIsolationWhere keeps gmailMessageId null-safe", () => {
  const where = buildFinancialDocumentReviewReadIsolationWhere(ORG_A, CONTAMINATED);
  assert.ok("OR" in where);
  assert.equal("emailMessageId" in where, false);
  assert.deepEqual(where.OR, [
    { gmailMessageId: null },
    { gmailMessageId: { notIn: CONTAMINATED } },
  ]);
  const _typecheck: Prisma.FinancialDocumentReviewWhereInput = where;
  assert.ok(_typecheck);
});

test("buildGmailScanItemReadIsolationWhere keeps gmailMessageId null-safe", () => {
  const where = buildGmailScanItemReadIsolationWhere(ORG_A, CONTAMINATED);
  assert.ok("OR" in where);
  assert.equal("emailMessageId" in where, false);
});

test("supplier payment isolation excludes cross-org contaminated ids for other orgs", () => {
  const excluded = crossOrgGmailIdsExcludedForOrganization(ORG_A, CONTAMINATED);
  assert.deepEqual(excluded, CONTAMINATED);
  const where = buildSupplierPaymentReadIsolationWhere(ORG_A, CONTAMINATED);
  assert.deepEqual(where.OR, [
    { emailMessageId: null },
    { emailMessageId: { notIn: CONTAMINATED } },
  ]);
});

test("supplier payment isolation honors sharon allowlist for contaminated gmail ids", () => {
  const excludedForSharon = crossOrgGmailIdsExcludedForOrganization(ORG_SHARON, CONTAMINATED);
  assert.deepEqual(excludedForSharon, ["gmail-cross-1", "gmail-cross-2"]);
  const where = buildSupplierPaymentReadIsolationWhere(ORG_SHARON, CONTAMINATED);
  assert.deepEqual(where.OR, [
    { emailMessageId: null },
    { emailMessageId: { notIn: ["gmail-cross-1", "gmail-cross-2"] } },
  ]);
});

test("supplier payment isolation does not add notIn filter when contaminated list empty", () => {
  const where = buildSupplierPaymentReadIsolationWhere(ORG_A, []);
  assert.equal(where.OR, undefined);
  assert.deepEqual(where.NOT, {
    duplicateReason: { contains: CROSS_ORG_QUARANTINE_MARKER },
  });
});

test("supplier payment isolation keeps null emailMessageId rows eligible", () => {
  const where = mergePrismaWhere(
    { organizationId: ORG_A, approvalStatus: "approved" },
    buildSupplierPaymentReadIsolationWhere(ORG_A, ["foreign-gmail"]),
  );
  assert.deepEqual(where.OR, [
    { emailMessageId: null },
    { emailMessageId: { notIn: ["foreign-gmail"] } },
  ]);
  assert.equal(where.organizationId, ORG_A);
});

test("financial document review isolation still filters gmailMessageId null-safe", () => {
  const where = buildFinancialDocumentReviewReadIsolationWhere(ORG_A, ["foreign-gmail"]);
  assert.deepEqual(where.OR, [
    { gmailMessageId: null },
    { gmailMessageId: { notIn: ["foreign-gmail"] } },
  ]);
});
