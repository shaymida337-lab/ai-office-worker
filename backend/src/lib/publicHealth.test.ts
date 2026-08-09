import test from "node:test";
import assert from "node:assert/strict";
import { buildLivenessHealthPayload } from "./publicHealth.js";

test("buildLivenessHealthPayload never needs a DB probe and reflects process connect flag", () => {
  const calls: Array<{ status: string; database: string }> = [];
  const getHealthPayload = (input: { status: "ok" | "error"; database: "connected" | "disconnected" }) => {
    calls.push(input);
    return { ...input, commit: "abc" };
  };

  const connected = buildLivenessHealthPayload(getHealthPayload, () => true);
  assert.deepEqual(connected, { status: "ok", database: "connected", commit: "abc" });

  const disconnected = buildLivenessHealthPayload(getHealthPayload, () => false);
  assert.deepEqual(disconnected, { status: "ok", database: "disconnected", commit: "abc" });

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.status, "ok");
});

test("liveness payload keeps status ok even when prisma flag is false (process up)", () => {
  const payload = buildLivenessHealthPayload(
    (input) => input,
    () => false
  );
  assert.equal(payload.status, "ok");
  assert.equal(payload.database, "disconnected");
});
