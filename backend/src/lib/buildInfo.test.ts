import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getBuildInfo, getHealthPayload, resetBuildInfoCacheForTests } from "./buildInfo.js";

test("getHealthPayload prefers runtime RENDER_GIT_COMMIT over embedded build info", () => {
  const previousCommit = process.env.RENDER_GIT_COMMIT;
  const previousService = process.env.RENDER_SERVICE_NAME;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.RENDER_GIT_COMMIT = "runtimecommit123";
  process.env.RENDER_SERVICE_NAME = "ai-office-worker-backend";
  process.env.NODE_ENV = "production";
  try {
    const payload = getHealthPayload({ status: "ok", database: "connected" });
    assert.equal(payload.status, "ok");
    assert.equal(payload.database, "connected");
    assert.equal(payload.commit, "runtimecommit123");
    assert.equal(payload.serviceName, "ai-office-worker-backend");
    assert.equal(payload.nodeEnv, "production");
    assert.equal(typeof payload.version, "string");
    assert.ok(payload.buildTime);
    assert.ok(payload.serverStartedAt);
  } finally {
    if (previousCommit === undefined) delete process.env.RENDER_GIT_COMMIT;
    else process.env.RENDER_GIT_COMMIT = previousCommit;
    if (previousService === undefined) delete process.env.RENDER_SERVICE_NAME;
    else process.env.RENDER_SERVICE_NAME = previousService;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("getBuildInfo falls back to embedded build-info.json when runtime commit unset", () => {
  const distDir = join(process.cwd(), "backend", "dist");
  const buildInfoPath = join(distDir, "build-info.json");
  const previousCommit = process.env.RENDER_GIT_COMMIT;
  const previousBuildTime = process.env.BUILD_TIME;
  delete process.env.RENDER_GIT_COMMIT;
  delete process.env.BUILD_TIME;
  resetBuildInfoCacheForTests();
  mkdirSync(distDir, { recursive: true });
  writeFileSync(
    buildInfoPath,
    JSON.stringify({ commitSha: "embeddedcommit456", buildTime: "2026-07-09T00:00:00.000Z" }),
    "utf8"
  );

  try {
    const info = getBuildInfo();
    assert.equal(info.commitSha, "embeddedcommit456");
    assert.equal(info.buildTime, "2026-07-09T00:00:00.000Z");
  } finally {
    rmSync(buildInfoPath, { force: true });
    resetBuildInfoCacheForTests();
    if (previousCommit === undefined) delete process.env.RENDER_GIT_COMMIT;
    else process.env.RENDER_GIT_COMMIT = previousCommit;
    if (previousBuildTime === undefined) delete process.env.BUILD_TIME;
    else process.env.BUILD_TIME = previousBuildTime;
  }
});

test("getBuildInfo returns null commit when runtime and embedded info are absent", () => {
  const previousCommit = process.env.RENDER_GIT_COMMIT;
  delete process.env.RENDER_GIT_COMMIT;
  resetBuildInfoCacheForTests();
  try {
    const info = getBuildInfo();
    assert.equal(info.commitSha, null);
  } finally {
    if (previousCommit !== undefined) process.env.RENDER_GIT_COMMIT = previousCommit;
  }
});
