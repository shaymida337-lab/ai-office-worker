import type { NatalieCoreCorrelationContext } from "./coreTypes.js";

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
