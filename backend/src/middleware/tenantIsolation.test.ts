import test from "node:test";
import assert from "node:assert/strict";

import type { JwtPayload } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { resolveVerifiedTenant } from "../services/tenant/verifiedTenant.js";
import {
  crossOrgGmailIdsExcludedForOrganization,
  resetCrossOrgContaminatedGmailIdsCacheForTests,
} from "../services/p0/financialReadIsolation.js";
import { SHARON_CONFIRMED_ALLOWLIST } from "../services/p0/sharonContaminationAllowlist.js";
import {
  financialDataContainmentMiddleware,
  isFinancialDataContainmentActive,
  isFinancialDataPath,
  validateTenantMiddleware,
} from "../middleware/tenantIsolation.js";
import express from "express";

const ORG_A = "org-a";
const ORG_B = "org-b";
const USER_A = "user-a";
const USER_B = "user-b";

test("resolveVerifiedTenant rejects stale token org for organization owner", async () => {
  const originalUserFindUnique = prisma.user.findUnique.bind(prisma.user);
  const originalOrgFindUnique = prisma.organization.findUnique.bind(prisma.organization);
  const originalMemberFindUnique = prisma.organizationMember.findUnique.bind(prisma.organizationMember);

  prisma.user.findUnique = (async () => ({
    id: USER_A,
    email: "a@example.com",
    organization: { id: ORG_A },
  })) as typeof prisma.user.findUnique;
  prisma.organization.findUnique = (async (args: { where: { id: string } }) => {
    if (args.where.id === ORG_B) return { userId: USER_B };
    if (args.where.id === ORG_A) return { userId: USER_A };
    return null;
  }) as typeof prisma.organization.findUnique;
  prisma.organizationMember.findUnique = (async () => null) as typeof prisma.organizationMember.findUnique;

  try {
    const staleToken: JwtPayload = { userId: USER_A, organizationId: ORG_B, email: "a@example.com" };
    const result = await resolveVerifiedTenant(staleToken);
    assert.equal(result.tenant, null);
    assert.equal(result.reason, "stale_organization_token");
  } finally {
    prisma.user.findUnique = originalUserFindUnique;
    prisma.organization.findUnique = originalOrgFindUnique;
    prisma.organizationMember.findUnique = originalMemberFindUnique;
  }
});

test("crossOrgGmailIdsExcludedForOrganization honors sharon allowlist", () => {
  const allowlistedId = SHARON_CONFIRMED_ALLOWLIST.gmailMessageIds[0]!;
  const excludedForSharon = crossOrgGmailIdsExcludedForOrganization(
    SHARON_CONFIRMED_ALLOWLIST.organizationId,
    [allowlistedId, "foreign-gmail-id"],
  );
  assert.deepEqual(excludedForSharon, ["foreign-gmail-id"]);

  const excludedForOther = crossOrgGmailIdsExcludedForOrganization("org-other", [allowlistedId]);
  assert.deepEqual(excludedForOther, [allowlistedId]);
});

test("isFinancialDataPath covers invoice and payment read routes", () => {
  assert.equal(isFinancialDataPath("/invoices"), true);
  assert.equal(isFinancialDataPath("/payments"), true);
  assert.equal(isFinancialDataPath("/document-reviews"), true);
  assert.equal(isFinancialDataPath("/gmail/scan"), true);
  assert.equal(isFinancialDataPath("/verification/center"), true);
  assert.equal(isFinancialDataPath("/dashboard/stats"), false);
});

test("financialDataContainmentMiddleware returns 503 for financial routes when active", async () => {
  const previous = process.env.FINANCIAL_DATA_CONTAINMENT;
  process.env.FINANCIAL_DATA_CONTAINMENT = "1";
  resetCrossOrgContaminatedGmailIdsCacheForTests();
  try {
    assert.equal(isFinancialDataContainmentActive(), true);
    const app = express();
    app.use((req, _res, next) => {
      req.auth = { userId: USER_A, organizationId: ORG_A, email: "a@example.com" };
      next();
    });
    app.use(financialDataContainmentMiddleware);
    app.get("/invoices", (_req, res) => res.json({ invoices: [] }));

    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const response = await fetch(`http://127.0.0.1:${port}/invoices`);
    assert.equal(response.status, 503);
    const body = (await response.json()) as { code?: string };
    assert.equal(body.code, "FINANCIAL_DATA_CONTAINMENT");

    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  } finally {
    if (previous === undefined) delete process.env.FINANCIAL_DATA_CONTAINMENT;
    else process.env.FINANCIAL_DATA_CONTAINMENT = previous;
  }
});

test("validateTenantMiddleware returns 403 when membership is denied", async () => {
  const originalUserFindUnique = prisma.user.findUnique.bind(prisma.user);
  prisma.user.findUnique = (async () => null) as typeof prisma.user.findUnique;

  const app = express();
  app.use((req, _res, next) => {
    req.auth = { userId: USER_B, organizationId: ORG_A, email: "b@example.com" };
    next();
  });
  app.use(validateTenantMiddleware);
  app.get("/protected", (_req, res) => res.json({ ok: true }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/protected`);
    assert.equal(response.status, 403);
  } finally {
    prisma.user.findUnique = originalUserFindUnique;
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
