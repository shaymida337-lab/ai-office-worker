import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  buildCoreAuditEvent,
  buildCoreCorrelationContext,
  buildCoreHealthSnapshot,
  classifyCoreError,
  computeCoreRetryDelayMs,
  enforceCoreInvariant,
  generateCoreCorrelationId,
  getCoreDiagnosticEvents,
  guardCoreInvariant,
  isCoreDiagnosticsEnabled,
  normalizeCoreHealthStatus,
  propagateCoreCorrelationId,
  recordCoreDiagnostic,
  resetCoreDiagnostics,
  resolveCoreWorkflowCorrelationId,
  runCoreInvariantSafe,
  setCoreDiagnosticsEnabled,
  withCoreRetry,
  withCoreSafeFallback,
  withCoreTimeout,
} from "./index";

describe("natalie core reliability phase 1 (frontend)", () => {
  beforeEach(() => {
    resetCoreDiagnostics();
    setCoreDiagnosticsEnabled(true);
  });

  it("normalizes health statuses", () => {
    assert.equal(normalizeCoreHealthStatus("Recovering"), "Recovering");
    assert.equal(normalizeCoreHealthStatus(null), "Unknown");
  });

  it("builds health snapshots", () => {
    const snapshot = buildCoreHealthSnapshot({ subsystemId: "dashboard", status: "Healthy" });
    assert.equal(snapshot.status, "Healthy");
  });

  it("classifies errors", () => {
    const classified = classifyCoreError({ status: 500, message: "server error" });
    assert.equal(classified.category, "external_service");
    assert.equal(classified.recoverable, true);
  });

  it("propagates correlation ids", () => {
    const id = resolveCoreWorkflowCorrelationId({ gmailMessageId: "abc" });
    assert.equal(id, "gmail:abc");
    const context = buildCoreCorrelationContext({ parent: "workflow:parent" });
    assert.equal(context.correlationId, "workflow:parent");
    assert.match(generateCoreCorrelationId("ui"), /^ui:/);
  });

  it("builds audit events", () => {
    const event = buildCoreAuditEvent({
      type: "completed",
      subsystem: "review",
      stage: "approval",
      correlationId: "workflow:1",
    });
    assert.equal(event.type, "completed");
  });

  it("enforces invariants safely", () => {
    const guarded = guardCoreInvariant("x", (value) => value === "ok", "bad", "fallback");
    assert.equal(guarded.value, "fallback");
    const safe = runCoreInvariantSafe(() => {
      throw new Error("fail");
    }, "ok", "runtime");
    assert.equal(safe.value, "ok");
    const enforced = enforceCoreInvariant(true, "bad", "value", "fallback");
    assert.equal(enforced.value, "value");
  });

  it("provides retry, timeout, and fallback helpers", async () => {
    assert.equal(computeCoreRetryDelayMs(3, { maxAttempts: 4, baseDelayMs: 10, maxDelayMs: 50 }), 40);
    const retried = await withCoreRetry(async (attempt) => {
      if (attempt < 2) throw new Error("retry");
      return "done";
    }, { maxAttempts: 3, baseDelayMs: 1 });
    assert.equal(retried, "done");
    const timedOut = await withCoreTimeout(
      new Promise<string>((resolve) => setTimeout(() => resolve("late"), 30)),
      5,
      () => "fallback"
    );
    assert.equal(timedOut, "fallback");
    assert.equal(
      withCoreSafeFallback(() => {
        throw new Error("fail");
      }, "safe"),
      "safe"
    );
  });

  it("records diagnostics when enabled", () => {
    setCoreDiagnosticsEnabled(false);
    recordCoreDiagnostic({ subsystem: "gmail", kind: "test", message: "hidden" });
    assert.equal(getCoreDiagnosticEvents().length, 0);
    setCoreDiagnosticsEnabled(true);
    recordCoreDiagnostic({ subsystem: "gmail", kind: "test", message: "visible" });
    assert.equal(getCoreDiagnosticEvents().length, 1);
    assert.equal(isCoreDiagnosticsEnabled(), true);
  });
});
