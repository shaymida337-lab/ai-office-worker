import type { PlatformAuditAction } from "../auditLog/index.js";
import { recordPlatformAudit } from "../auditLog/index.js";

type CalendarActor = {
  actorType: "user" | "AI" | "system" | "natalie";
  actorUserId?: string | null;
  actorRole?: string | null;
};

type CalendarAuditInput = {
  organizationId: string;
  action: PlatformAuditAction;
  entityType?: string;
  entityId: string;
  actor: CalendarActor;
  sourceModule: string;
  sourceRoute?: string | null;
  correlationId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  beforeState?: unknown;
  afterState?: unknown;
};

const SENSITIVE_METADATA_KEYS = [
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "oauth",
  "clientSecret",
  "secret",
  "rawGooglePayload",
] as const;

export function sanitizeCalendarAuditMetadata(
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!metadata) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_METADATA_KEYS.some((blocked) => key.toLowerCase().includes(blocked.toLowerCase()))) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function recordCalendarAudit(input: CalendarAuditInput): void {
  const normalizedActorType = input.actor.actorType === "natalie" ? "AI" : input.actor.actorType;
  const actorId =
    normalizedActorType === "user"
      ? (input.actor.actorUserId ?? null)
      : normalizedActorType === "AI"
        ? "natalie"
        : null;

  recordPlatformAudit({
    organizationId: input.organizationId,
    action: input.action,
    entityType: input.entityType ?? "calendar",
    entityId: input.entityId,
    actorType: normalizedActorType,
    actorId,
    sourceModule: input.sourceModule,
    sourceRoute: input.sourceRoute ?? null,
    correlationId: input.correlationId ?? null,
    reason: input.reason ?? null,
    beforeState: input.beforeState,
    afterState: input.afterState,
    metadata: sanitizeCalendarAuditMetadata({
      ...(input.metadata ?? {}),
      actorRole: input.actor.actorRole ?? null,
    }),
  });
}

