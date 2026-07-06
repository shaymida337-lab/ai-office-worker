import test from "node:test";
import assert from "node:assert/strict";
import {
  commitsAligned,
  resolveSystemDeployStatus,
  systemDeployBannerMessage,
} from "./systemDeployStatus.js";

test("commitsAligned matches full or short SHA prefixes", () => {
  assert.equal(commitsAligned("9c956b6df98a", "9c956b6df98a6edd5b3d231a8a2de871c24d5302"), true);
  assert.equal(commitsAligned("abc", "def"), false);
});

test("resolveSystemDeployStatus flags commit mismatch", () => {
  const status = resolveSystemDeployStatus({
    health: { status: "ok", database: "connected", commit: "aaaa111" },
    healthOk: true,
    frontendCommit: "bbbb222",
  });
  assert.equal(status.state, "commit_mismatch");
  assert.match(systemDeployBannerMessage(status) ?? "", /עדכון מערכת/);
});

test("resolveSystemDeployStatus ok when backend healthy and aligned", () => {
  const status = resolveSystemDeployStatus({
    health: { status: "ok", database: "connected", commit: "9c956b6d" },
    healthOk: true,
    frontendCommit: "9c956b6df98a6edd5b3d231a8a2de871c24d5302",
  });
  assert.equal(status.state, "ok");
  assert.equal(systemDeployBannerMessage(status), null);
});

test("backend unreachable shows deploy banner message", () => {
  const status = resolveSystemDeployStatus({
    health: null,
    healthOk: false,
    frontendCommit: "9c956b6",
  });
  assert.equal(status.state, "backend_unreachable");
  assert.ok(systemDeployBannerMessage(status));
});
