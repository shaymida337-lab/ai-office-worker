import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  buildCoreAuditEvent,
  buildCoreCorrelationContext,
  buildCoreHealthSnapshot,
  classifyCoreError,
  computeCoreRetryDelayMs,
  enforceCoreInvariant,
  fromReliabilityHealthStatus,
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
  toReliabilityHealthStatus,
  withCoreRetry,
  withCoreSafeFallback,
  withCoreTimeout,
} from "./index.js";

describe("natalie core reliability phase 1", () => {
  beforeEach(() => {
    resetCoreDiagnostics();
    setCoreDiagnosticsEnabled(true);
  });

  describe("health model", () => {
    it("normalizes unknown values to Unknown", () => {
      assert.equal(normalizeCoreHealthStatus("Healthy"), "Healthy");
      assert.equal(normalizeCoreHealthStatus("bogus"), "Unknown");
    });

    it("builds subsystem health snapshots", () => {
      const snapshot = buildCoreHealthSnapshot({
        subsystemId: "gmail",
        status: "Degraded",
        message: "slow sync",
      });
      assert.equal(snapshot.subsystemId, "gmail");
      assert.equal(snapshot.status, "Degraded");
      assert.equal(snapshot.message, "slow sync");
    });

    it("maps legacy reliability health statuses", () => {
      assert.equal(fromReliabilityHealthStatus("healthy"), "Healthy");
      assert.equal(fromReliabilityHealthStatus("unhealthy"), "Failed");
      assert.equal(toReliabilityHealthStatus("Recovering"), "degraded");
      assert.equal(toReliabilityHealthStatus("Failed"), "unhealthy");
    });
  });

  describe("error classification", () => {
    it("classifies auth errors as non-recoverable and user-visible", () => {
      const classified = classifyCoreError({ status: 401, message: "unauthorized" }, { userFacing: true });
      assert.equal(classified.category, "auth");
      assert.equal(classified.recoverable, false);
      assert.equal(classified.userVisible, true);
      assert.equal(classified.recommendedAction, "reconnect_integration");
    });

    it("classifies network timeouts as recoverable", () => {
      const classified = classifyCoreError(new Error("ETIMEDOUT"));
      assert.equal(classified.category, "timeout");
      assert.equal(classified.recoverable, true);
      assert.equal(classified.recommendedAction, "retry");
    });
  });

  describe("correlation propagation", () => {
    it("prefers explicit correlation ids", () => {
      assert.equal(
        propagateCoreCorrelationId({ explicit: "workflow:abc", parent: "workflow:parent" }),
        "workflow:abc"
      );
    });

    it("falls back to parent then generated ids", () => {
      const fromParent = propagateCoreCorrelationId({ parent: "workflow:parent" });
      assert.equal(fromParent, "workflow:parent");
      const generated = generateCoreCorrelationId("scan");
      assert.match(generated, /^scan:/);
    });

    it("builds correlation context", () => {
      const context = buildCoreCorrelationContext({
        explicit: "workflow:123",
        workflow: "gmail_sync",
      });
      assert.equal(context.correlationId, "workflow:123");
      assert.equal(context.workflow, "gmail_sync");
    });

    it("bridges workflow correlation ids from gmail message ids", () => {
      const id = resolveCoreWorkflowCorrelationId({ gmailMessageId: "msg-1" });
      assert.match(id, /^gmail:msg-1$/);
    });
  });

  describe("audit events", () => {
    it("builds standardized lifecycle events", () => {
      const event = buildCoreAuditEvent({
        type: "started",
        subsystem: "scanner",
        stage: "ocr",
        correlationId: "workflow:1",
        organizationId: "org-1",
      });
      assert.equal(event.type, "started");
      assert.equal(event.subsystem, "scanner");
      assert.equal(event.correlationId, "workflow:1");
      assert.ok(event.timestamp);
    });
  });

  describe("invariant enforcement", () => {
    it("recovers safely on violation", () => {
      const result = enforceCoreInvariant(false, "invalid state", "bad", "safe");
      assert.equal(result.ok, false);
      assert.equal(result.recovered, true);
      assert.equal(result.value, "safe");
    });

    it("guards invariants without throwing", () => {
      const result = guardCoreInvariant(
        -1,
        (value) => value >= 0,
        "negative count",
        0
      );
      assert.equal(result.value, 0);
      assert.equal(result.recovered, true);
    });

    it("runs functions safely with fallback", () => {
      const result = runCoreInvariantSafe(() => {
        throw new Error("boom");
      }, "fallback", "runtime");
      assert.equal(result.value, "fallback");
      assert.equal(result.recovered, true);
    });
  });

  describe("reliability utilities", () => {
    it("computes exponential retry delays", () => {
      assert.equal(computeCoreRetryDelayMs(1, { maxAttempts: 3, baseDelayMs: 100 }), 100);
      assert.equal(computeCoreRetryDelayMs(2, { maxAttempts: 3, baseDelayMs: 100 }), 200);
    });

    it("retries until success", async () => {
      let attempts = 0;
      const value = await withCoreRetry(async () => {
        attempts += 1;
        if (attempts < 2) throw new Error("retry");
        return "ok";
      }, { maxAttempts: 3, baseDelayMs: 1 });
      assert.equal(value, "ok");
      assert.equal(attempts, 2);
    });

    it("times out long operations", async () => {
      const value = await withCoreTimeout(
        new Promise<string>((resolve) => setTimeout(() => resolve("late"), 50)),
        5,
        () => "fallback"
      );
      assert.equal(value, "fallback");
    });

    it("applies safe fallbacks", () => {
      assert.equal(
        withCoreSafeFallback(() => {
          throw new Error("fail");
        }, "safe"),
        "safe"
      );
    });
  });

  describe("development diagnostics", () => {
    it("records diagnostics only when enabled", () => {
      setCoreDiagnosticsEnabled(false);
      recordCoreDiagnostic({ subsystem: "gmail", kind: "test", message: "hidden" });
      assert.equal(getCoreDiagnosticEvents().length, 0);

      setCoreDiagnosticsEnabled(true);
      recordCoreDiagnostic({ subsystem: "gmail", kind: "test", message: "visible" });
      assert.equal(getCoreDiagnosticEvents().length, 1);
      assert.equal(isCoreDiagnosticsEnabled(), true);
    });
  });
});
