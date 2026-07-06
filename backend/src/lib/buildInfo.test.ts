import test from "node:test";
import assert from "node:assert/strict";
import { getBuildInfo, getHealthPayload } from "./buildInfo.js";

test("getHealthPayload includes commit and database status", () => {
  const previous = process.env.RENDER_GIT_COMMIT;
  process.env.RENDER_GIT_COMMIT = "abc123def456";
  try {
    const payload = getHealthPayload({ status: "ok", database: "connected" });
    assert.equal(payload.status, "ok");
    assert.equal(payload.database, "connected");
    assert.equal(payload.commit, "abc123def456");
    assert.equal(typeof payload.version, "string");
    assert.ok(payload.buildTime);
  } finally {
    if (previous === undefined) delete process.env.RENDER_GIT_COMMIT;
    else process.env.RENDER_GIT_COMMIT = previous;
  }
});

test("getBuildInfo returns null commit when env unset", () => {
  const previous = process.env.RENDER_GIT_COMMIT;
  delete process.env.RENDER_GIT_COMMIT;
  try {
    const info = getBuildInfo();
    assert.equal(info.commitSha, null);
  } finally {
    if (previous !== undefined) process.env.RENDER_GIT_COMMIT = previous;
  }
});
