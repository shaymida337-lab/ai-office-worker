import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../lib/prisma.js";
import { getSchedulingCapabilities } from "../services/scheduling/schedulingCapabilities.js";

const ORG_ID = "org-capabilities-a";

function mockOrgFlags(flags: {
  read: boolean;
  write: boolean;
  googleMirror: boolean;
}) {
  const original = prisma.organization.findUnique.bind(prisma.organization);
  prisma.organization.findUnique = (async () => ({
    calendarEngineReadEnabled: flags.read,
    calendarEngineWriteEnabled: flags.write,
    calendarEngineGoogleMirrorEnabled: flags.googleMirror,
  })) as typeof prisma.organization.findUnique;
  return () => {
    prisma.organization.findUnique = original;
  };
}

function enableGlobal() {
  process.env.CALENDAR_ENGINE_V1_READ = "true";
  process.env.CALENDAR_ENGINE_V1_WRITE = "true";
}

function disableGlobal() {
  delete process.env.CALENDAR_ENGINE_V1_READ;
  delete process.env.CALENDAR_ENGINE_V1_WRITE;
}

test("getSchedulingCapabilities returns enabled when global and org ON", async () => {
  enableGlobal();
  const restore = mockOrgFlags({ read: true, write: true, googleMirror: true });
  try {
    const body = await getSchedulingCapabilities(ORG_ID);
    assert.equal(body.calendarEngineReadEnabled, true);
    assert.equal(body.calendarEngineWriteEnabled, true);
    assert.equal(body.ownerDecisionQueueEnabled, true);
    assert.equal(body.googleMirrorEnabled, true);
    assert.equal(body.source, "enabled");
  } finally {
    restore();
    disableGlobal();
  }
});

test("getSchedulingCapabilities returns disabled when org OFF", async () => {
  enableGlobal();
  const restore = mockOrgFlags({ read: false, write: false, googleMirror: false });
  try {
    const body = await getSchedulingCapabilities(ORG_ID);
    assert.equal(body.calendarEngineReadEnabled, false);
    assert.equal(body.source, "org_disabled");
  } finally {
    restore();
    disableGlobal();
  }
});

test("getSchedulingCapabilities returns global_disabled when env OFF", async () => {
  disableGlobal();
  const restore = mockOrgFlags({ read: true, write: true, googleMirror: true });
  try {
    const body = await getSchedulingCapabilities(ORG_ID);
    assert.equal(body.calendarEngineReadEnabled, false);
    assert.equal(body.source, "global_disabled");
  } finally {
    restore();
  }
});
