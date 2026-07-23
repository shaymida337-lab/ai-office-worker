import assert from "node:assert/strict";
import test from "node:test";
import {
  accountedExclusiveMs,
  buildAppointmentsServerTiming,
  computeUnaccountedMs,
  safeDatabaseTopology,
  type AppointmentsEndpointTiming,
} from "./appointmentsEndpointTiming.js";

function withUnaccounted(
  base: Omit<AppointmentsEndpointTiming, "unaccountedMs">
): AppointmentsEndpointTiming {
  return { ...base, unaccountedMs: computeUnaccountedMs(base) };
}

test("Server-Timing includes gap RCA phases without PII", () => {
  const t = withUnaccounted({
    preRouteMs: 0,
    authMs: 1,
    authToOrgMs: 850,
    tenantMs: 840,
    orgMs: 335,
    orgToDbMs: 0,
    dbMs: 329,
    dbToMapMs: 0,
    mapMs: 0,
    jsonMs: 0,
    responseMs: 1,
    middlewareMs: 850,
    eventLoopMs: 0,
    totalMs: 1516,
    rowCount: 1,
    prismaCallCount: 1,
    authDbRoundTrips: 0,
    tenantDbRoundTrips: 3,
    orgDbRoundTrips: 2,
    eventsDbRoundTrips: 1,
  });
  const header = buildAppointmentsServerTiming(t);
  assert.match(header, /pre_route;dur=/);
  assert.match(header, /auth_to_org;dur=/);
  assert.match(header, /tenant;dur=/);
  assert.match(header, /tenant_db;dur=/);
  assert.match(header, /org_to_db;dur=/);
  assert.match(header, /unaccounted;dur=/);
  assert.match(header, /total;dur=/);
  assert.equal(/token|Bearer|organizationId|email|phone|secret/i.test(header), false);
});

test("prod-shaped gap: tenant explains ~851ms; unaccounted under 50ms", () => {
  const t = withUnaccounted({
    preRouteMs: 0,
    authMs: 1,
    authToOrgMs: 851,
    tenantMs: 851,
    orgMs: 335,
    orgToDbMs: 0,
    dbMs: 329,
    dbToMapMs: 0,
    mapMs: 0,
    jsonMs: 0,
    responseMs: 0,
    middlewareMs: 851,
    eventLoopMs: 0,
    totalMs: 1516,
    rowCount: 1,
    prismaCallCount: 1,
    authDbRoundTrips: 0,
    tenantDbRoundTrips: 3,
    orgDbRoundTrips: 2,
    eventsDbRoundTrips: 1,
  });
  assert.equal(t.tenantMs, 851);
  assert.ok(t.unaccountedMs < 50, `unaccounted=${t.unaccountedMs}`);
  assert.equal(accountedExclusiveMs(t) + t.unaccountedMs, t.totalMs);
});

test("local mock phases: unaccounted under 50ms", () => {
  const t = withUnaccounted({
    preRouteMs: 0,
    authMs: 1,
    authToOrgMs: 12,
    tenantMs: 10,
    orgMs: 8,
    orgToDbMs: 0,
    dbMs: 15,
    dbToMapMs: 0,
    mapMs: 0,
    jsonMs: 0,
    responseMs: 1,
    middlewareMs: 12,
    eventLoopMs: 0,
    totalMs: 37,
    rowCount: 1,
    prismaCallCount: 1,
    authDbRoundTrips: 0,
    tenantDbRoundTrips: 3,
    orgDbRoundTrips: 2,
    eventsDbRoundTrips: 1,
  });
  assert.ok(t.unaccountedMs < 50, `unaccounted=${t.unaccountedMs}`);
  assert.equal(t.unaccountedMs, 0);
});

test("safeDatabaseTopology never returns userinfo or full URL", () => {
  const prev = process.env.DATABASE_URL;
  process.env.DATABASE_URL =
    "postgresql://user:secret@ep-x-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require";
  try {
    const topo = safeDatabaseTopology();
    assert.equal(topo.neon, true);
    assert.equal(topo.pooledHost, true);
    assert.equal(topo.neonRegion, "us-east-1");
    const dumped = JSON.stringify(topo);
    assert.equal(/secret|user:|postgresql:\/\//i.test(dumped), false);
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  }
});
