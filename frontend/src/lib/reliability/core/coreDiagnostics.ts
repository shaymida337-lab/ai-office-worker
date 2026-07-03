import type { NatalieCoreDiagnosticEvent } from "./coreTypes";

const MAX_EVENTS = 100;
let diagnosticsOverride: boolean | null = null;
const diagnosticEvents: NatalieCoreDiagnosticEvent[] = [];

export function isCoreDiagnosticsEnabled(): boolean {
  if (diagnosticsOverride !== null) return diagnosticsOverride;
  if (process.env.NEXT_PUBLIC_NATALIE_CORE_DIAGNOSTICS === "1") return true;
  return process.env.NODE_ENV === "development";
}

export function setCoreDiagnosticsEnabled(enabled: boolean | null) {
  diagnosticsOverride = enabled;
}

export function resetCoreDiagnostics() {
  diagnosticEvents.length = 0;
}

export function getCoreDiagnosticEvents(): NatalieCoreDiagnosticEvent[] {
  return [...diagnosticEvents];
}

export function recordCoreDiagnostic(input: {
  subsystem: string;
  kind: string;
  message: string;
  correlationId?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  if (!isCoreDiagnosticsEnabled()) return;
  const event: NatalieCoreDiagnosticEvent = {
    at: Date.now(),
    subsystem: input.subsystem,
    kind: input.kind,
    message: input.message,
    correlationId: input.correlationId ?? null,
    metadata: input.metadata ?? null,
  };
  diagnosticEvents.push(event);
  if (diagnosticEvents.length > MAX_EVENTS) diagnosticEvents.shift();
  if (process.env.NODE_ENV === "development") {
    console.info("[natalie-core-diagnostics]", event);
  }
}
