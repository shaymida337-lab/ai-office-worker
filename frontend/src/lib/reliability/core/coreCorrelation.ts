import type { NatalieCoreCorrelationContext } from "./coreTypes";

export function generateCoreCorrelationId(prefix = "natalie"): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${suffix}`;
}

export function propagateCoreCorrelationId(input: {
  explicit?: string | null;
  parent?: string | null;
  entity?: string | null;
  prefix?: string;
}): string {
  const explicit = input.explicit?.trim();
  if (explicit) return explicit;

  const parent = input.parent?.trim();
  if (parent) return parent;

  const entity = input.entity?.trim();
  if (entity) return entity;

  return generateCoreCorrelationId(input.prefix ?? "workflow");
}

export function buildCoreCorrelationContext(input: {
  explicit?: string | null;
  parent?: string | null;
  entity?: string | null;
  workflow?: string | null;
  prefix?: string;
}): NatalieCoreCorrelationContext {
  const correlationId = propagateCoreCorrelationId(input);
  return {
    correlationId,
    parentCorrelationId: input.parent?.trim() || null,
    workflow: input.workflow?.trim() || null,
  };
}

export function attachCoreCorrelationId<T extends Record<string, unknown>>(
  payload: T,
  correlationId: string
): T & { correlationId: string } {
  return { ...payload, correlationId };
}

export function correlationIdFromGmailMessage(gmailMessageId?: string | null): string | null {
  if (!gmailMessageId?.trim()) return null;
  return `gmail:${gmailMessageId.trim()}`;
}

export function resolveCoreWorkflowCorrelationId(input: {
  gmailMessageId?: string | null;
  emailMessageId?: string | null;
  explicit?: string | null;
  parent?: string | null;
  prefix?: string;
}): string {
  const explicit = input.explicit?.trim();
  const fromGmail = correlationIdFromGmailMessage(input.gmailMessageId);
  const fromEmail = input.emailMessageId?.trim() ? `email:${input.emailMessageId.trim()}` : null;
  return propagateCoreCorrelationId({
    explicit: explicit || fromGmail || fromEmail,
    parent: input.parent,
    prefix: input.prefix ?? "workflow",
  });
}
