import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import {
  resolveCalendarEngineFlags,
  isGlobalCalendarEngineReadEnabled,
  isGlobalCalendarEngineWriteEnabled,
} from "./calendarEngineFlags.js";

const ORG_ID = "org-flags-test";

function enableGlobalFlags() {
  process.env.CALENDAR_ENGINE_V1_READ = "true";
  process.env.CALENDAR_ENGINE_V1_WRITE = "true";
}

function disableGlobalFlags() {
  delete process.env.CALENDAR_ENGINE_V1_READ;
  delete process.env.CALENDAR_ENGINE_V1_WRITE;
}

function mockOrgFlags(flags: {
  calendarEngineReadEnabled: boolean;
  calendarEngineWriteEnabled: boolean;
  calendarEngineGoogleMirrorEnabled: boolean;
}) {
  const original = prisma.organization.findUnique.bind(prisma.organization);
  prisma.organization.findUnique = (async () => flags) as typeof prisma.organization.findUnique;
  return () => {
    prisma.organization.findUnique = original;
  };
}

test("global false + org true = disabled (global_disabled)", async () => {
  disableGlobalFlags();
  const restore = mockOrgFlags({
    calendarEngineReadEnabled: true,
    calendarEngineWriteEnabled: true,
    calendarEngineGoogleMirrorEnabled: true,
  });
  try {
    const flags = await resolveCalendarEngineFlags(ORG_ID);
    assert.equal(flags.source, "global_disabled");
    assert.equal(flags.readEnabled, false);
    assert.equal(flags.writeEnabled, false);
    assert.equal(flags.googleMirrorEnabled, false);
  } finally {
    restore();
  }
});

test("global true + org false = disabled (org_disabled)", async () => {
  enableGlobalFlags();
  const restore = mockOrgFlags({
    calendarEngineReadEnabled: false,
    calendarEngineWriteEnabled: false,
    calendarEngineGoogleMirrorEnabled: false,
  });
  try {
    const flags = await resolveCalendarEngineFlags(ORG_ID);
    assert.equal(flags.source, "org_disabled");
    assert.equal(flags.readEnabled, false);
    assert.equal(flags.writeEnabled, false);
    assert.equal(flags.googleMirrorEnabled, false);
  } finally {
    restore();
    disableGlobalFlags();
  }
});

test("global true + org true = enabled", async () => {
  enableGlobalFlags();
  const restore = mockOrgFlags({
    calendarEngineReadEnabled: true,
    calendarEngineWriteEnabled: true,
    calendarEngineGoogleMirrorEnabled: true,
  });
  try {
    const flags = await resolveCalendarEngineFlags(ORG_ID);
    assert.equal(flags.source, "enabled");
    assert.equal(flags.readEnabled, true);
    assert.equal(flags.writeEnabled, true);
    assert.equal(flags.googleMirrorEnabled, true);
  } finally {
    restore();
    disableGlobalFlags();
  }
});

test("googleMirrorEnabled requires write and org google mirror flag", async () => {
  enableGlobalFlags();
  const restore = mockOrgFlags({
    calendarEngineReadEnabled: true,
    calendarEngineWriteEnabled: true,
    calendarEngineGoogleMirrorEnabled: false,
  });
  try {
    const flags = await resolveCalendarEngineFlags(ORG_ID);
    assert.equal(flags.readEnabled, true);
    assert.equal(flags.writeEnabled, true);
    assert.equal(flags.googleMirrorEnabled, false);
  } finally {
    restore();
    disableGlobalFlags();
  }
});

test("global kill switches default OFF", () => {
  disableGlobalFlags();
  assert.equal(isGlobalCalendarEngineReadEnabled(), false);
  assert.equal(isGlobalCalendarEngineWriteEnabled(), false);
});
