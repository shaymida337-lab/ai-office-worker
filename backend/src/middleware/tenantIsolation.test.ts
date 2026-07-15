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
  isFinancialDataPath,
  validateTenantMiddleware,
} from "../middleware/tenantIsolation.js";
import express from "express";

const ORG_A = "org-a";
const ORG_B = "org-b";
const USER_A = "user-a";
const USER_B = "user-b";

const ENV_KEYS = [
  "FINANCIAL_DATA_CONTAINMENT",
  "FINANCIAL_READ_CONTAINMENT",
  "FINANCIAL_INGESTION_CONTAINMENT",
] as const;

type EnvSnapshot = Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

function snapshotEnv(): EnvSnapshot {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as EnvSnapshot;
}

function restoreEnv(snapshot: EnvSnapshot) {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function setEnv(master?: string, read?: string, ingestion?: string) {
  if (master === undefined) delete process.env.FINANCIAL_DATA_CONTAINMENT;
  else process.env.FINANCIAL_DATA_CONTAINMENT = master;
  if (read === undefined) delete process.env.FINANCIAL_READ_CONTAINMENT;
  else process.env.FINANCIAL_READ_CONTAINMENT = read;
  if (ingestion === undefined) delete process.env.FINANCIAL_INGESTION_CONTAINMENT;
  else process.env.FINANCIAL_INGESTION_CONTAINMENT = ingestion;
}

async function requestContainment(
  path: string,
  master?: string,
  read?: string,
  ingestion?: string,
): Promise<{ status: number; body: { code?: string } }> {
  const previous = snapshotEnv();
  setEnv(master, read, ingestion);
  resetCrossOrgContaminatedGmailIdsCacheForTests();

  const app = express();
  app.use((req, _res, next) => {
    req.auth = { userId: USER_A, organizationId: ORG_A, email: "a@example.com" };
    next();
  });
  app.use(financialDataContainmentMiddleware);
  app.get(path, (_req, res) => res.json({ ok: true }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: response.status, body: (await response.json()) as { code?: string } };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    restoreEnv(previous);
  }
}

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

test("invoice list GET is allowed under active read containment", async () => {
  const list = await requestContainment("/invoices", "0", "1", "1");
  assert.equal(list.status, 200);
  const months = await requestContainment("/invoices/months", "0", "1", "1");
  assert.equal(months.status, 200);
});

test("invoice list GET is allowed even when legacy master read gate is on", async () => {
  const list = await requestContainment("/invoices", "1", "1", "1");
  assert.equal(list.status, 200);
  const months = await requestContainment("/invoices/months", "1", "1", "1");
  assert.equal(months.status, 200);
});

test("other financial read path returns 503 when read containment active", async () => {
  const result = await requestContainment("/payments", "0", "1", "0");
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "FINANCIAL_READ_CONTAINMENT");
});

test("financial read path continues when read containment inactive", async () => {
  const result = await requestContainment("/payments", "0", "0", "1");
  assert.equal(result.status, 200);
});

test("ingestion path returns 503 when ingestion containment active", async () => {
  const result = await requestContainment("/gmail/scan", "0", "0", "1");
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "FINANCIAL_INGESTION_CONTAINMENT");
});

test("ingestion path still blocked when read inactive but ingestion active", async () => {
  const result = await requestContainment("/sync/gmail", "0", "0", "1");
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "FINANCIAL_INGESTION_CONTAINMENT");
});

test("ingestion path returns 503 when legacy master active", async () => {
  const result = await requestContainment("/gmail/scan", "1", "0", "0");
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "FINANCIAL_INGESTION_CONTAINMENT");
});

test("non-financial path is not blocked", async () => {
  const previous = snapshotEnv();
  setEnv("1", "1", "1");
  resetCrossOrgContaminatedGmailIdsCacheForTests();

  const app = express();
  app.use((req, _res, next) => {
    req.auth = { userId: USER_A, organizationId: ORG_A, email: "a@example.com" };
    next();
  });
  app.use(financialDataContainmentMiddleware);
  app.get("/dashboard/stats", (_req, res) => res.json({ ok: true }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/dashboard/stats`);
    assert.equal(response.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    restoreEnv(previous);
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
