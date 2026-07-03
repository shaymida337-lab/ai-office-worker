import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  createCoreWorkflowTrace,
  emitCoreWorkflowAudit,
  getCoreDiagnosticEvents,
  resetCoreDiagnostics,
  resolveCoreWorkflowCorrelationId,
  setCoreDiagnosticsEnabled,
} from "./index.js";

describe("core workflow integration", () => {
  beforeEach(() => {
    resetCoreDiagnostics();
    setCoreDiagnosticsEnabled(true);
  });

  it("propagates one gmail correlation id across scanner and extraction stages", () => {
    const gmailMessageId = "msg-integration-1";
    const scannerTrace = createCoreWorkflowTrace({
      subsystem: "scanner_pipeline",
      organizationId: "org-1",
      gmailMessageId,
      workflow: "scanner_pipeline",
    });
    const extractionCorrelation = resolveCoreWorkflowCorrelationId({ gmailMessageId });
    assert.equal(scannerTrace.correlationId, extractionCorrelation);
    assert.equal(scannerTrace.correlationId, `gmail:${gmailMessageId}`);

    emitCoreWorkflowAudit(scannerTrace, "started", "message_process");
    emitCoreWorkflowAudit(
      createCoreWorkflowTrace({
        subsystem: "claude_extraction",
        explicit: extractionCorrelation,
        workflow: "claude_extraction",
      }),
      "started",
      "extraction"
    );

    const events = getCoreDiagnosticEvents();
    assert.ok(events.length >= 2);
    assert.ok(events.every((event) => event.correlationId === `gmail:${gmailMessageId}`));
  });

  it("uses explicit sync correlation id for gmail sync workflow", () => {
    const syncTrace = createCoreWorkflowTrace({
      subsystem: "gmail_sync",
      organizationId: "org-1",
      explicit: "gmail-sync:scan-123",
      workflow: "gmail_sync",
    });
    assert.equal(syncTrace.correlationId, "gmail-sync:scan-123");
    emitCoreWorkflowAudit(syncTrace, "started", "sync_run");
    assert.equal(getCoreDiagnosticEvents()[0]?.correlationId, "gmail-sync:scan-123");
  });

  it("bridges review and payment workflows on the same entity correlation", () => {
    const correlationId = resolveCoreWorkflowCorrelationId({
      gmailMessageId: "msg-pay-1",
      emailMessageId: "email-db-1",
    });
    assert.equal(correlationId, "gmail:msg-pay-1");

    const reviewTrace = createCoreWorkflowTrace({
      subsystem: "review_queue",
      organizationId: "org-1",
      gmailMessageId: "msg-pay-1",
      emailMessageId: "email-db-1",
      workflow: "review_queue",
    });
    const paymentTrace = createCoreWorkflowTrace({
      subsystem: "payment_creation",
      organizationId: "org-1",
      gmailMessageId: "msg-pay-1",
      emailMessageId: "email-db-1",
      workflow: "payment_creation",
    });
    assert.equal(reviewTrace.correlationId, paymentTrace.correlationId);
  });
});
