import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAppointmentsServerTiming,
  safeDatabaseTopology,
  type AppointmentsEndpointTiming,
} from "./appointmentsEndpointTiming.js";

test("Server-Timing header contains only duration metrics", () => {
  const t: AppointmentsEndpointTiming = {
    requestReceivedAt: 0,
    authMs: 1,
    orgMs: 120,
    dbMs: 800,
    mapMs: 0,
    serializeMs: 2,
    totalMs: 923,
    poolWaitMs: null,
    rowCount: 1,
    prismaCallCount: 1,
    authDbRoundTrips: 0,
    orgDbRoundTrips: 2,
    eventsDbRoundTrips: 1,
  };
  const header = buildAppointmentsServerTiming(t);
  assert.equal(
    header,
    "auth;dur=1, org;dur=120, db;dur=800, map;dur=0, serialize;dur=2, total;dur=923"
  );
  assert.equal(/token|Bearer|organization|appointment|email|phone/i.test(header), false);
});

test("Server-Timing includes pool when measurable", () => {
  const header = buildAppointmentsServerTiming({
    requestReceivedAt: 0,
    authMs: 0,
    orgMs: 10,
    dbMs: 100,
    mapMs: 0,
    serializeMs: 0,
    totalMs: 110,
    poolWaitMs: 5,
    rowCount: 0,
    prismaCallCount: 1,
    authDbRoundTrips: 0,
    orgDbRoundTrips: 2,
    eventsDbRoundTrips: 1,
  });
  assert.match(header, /pool;dur=5/);
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
    assert.equal(topo.hostSuffix, "aws.neon.tech");
    const dumped = JSON.stringify(topo);
    assert.equal(/secret|user:|postgresql:\/\//i.test(dumped), false);
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  }
});
