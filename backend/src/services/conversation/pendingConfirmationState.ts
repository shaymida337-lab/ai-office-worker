import { randomUUID } from "crypto";
import type { ConversationSessionRecord, ConversationTurn, PendingConfirmation } from "./conversationTypes.js";
import { evaluateConfirmationPolicy } from "./conversationConfirmationPolicy.js";
import type { NatalieChannel } from "./conversationTypes.js";

export const PENDING_CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000;

export type PendingConfirmationLogContext = {
  requestId?: string | null;
  sessionId: string;
  confirmationId?: string | null;
  conversationId?: string | null;
  createdAt?: string | null;
  expiresAt?: string | null;
  consumedAt?: string | null;
  reason?: string | null;
  source?: "session" | "history" | "new" | null;
};

export function logPendingConfirmationEvent(
  event: string,
  ctx: PendingConfirmationLogContext
): void {
  console.info(`[natalie/confirmation] ${event}`, {
    requestId: ctx.requestId ?? null,
    sessionId: ctx.sessionId,
    conversationId: ctx.conversationId ?? ctx.sessionId,
    confirmationId: ctx.confirmationId ?? null,
    createdAt: ctx.createdAt ?? null,
    expiresAt: ctx.expiresAt ?? null,
    consumedAt: ctx.consumedAt ?? null,
    reason: ctx.reason ?? null,
    source: ctx.source ?? null,
  });
}

export function computePendingConfirmationExpiresAt(createdAt: string): string {
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) {
    return new Date(Date.now() + PENDING_CONFIRMATION_TIMEOUT_MS).toISOString();
  }
  return new Date(createdMs + PENDING_CONFIRMATION_TIMEOUT_MS).toISOString();
}

export function stampPendingConfirmation(
  pending: Omit<PendingConfirmation, "createdAt" | "expiresAt"> & {
    createdAt?: string;
    expiresAt?: string;
  }
): PendingConfirmation {
  const createdAt = pending.createdAt ?? new Date().toISOString();
  const expiresAt = pending.expiresAt ?? computePendingConfirmationExpiresAt(createdAt);
  return {
    ...pending,
    createdAt,
    expiresAt,
  };
}

export function isPendingConfirmationExpired(
  pending: Pick<PendingConfirmation, "createdAt" | "expiresAt">,
  nowMs = Date.now()
): boolean {
  const expiresMs = Date.parse(pending.expiresAt);
  if (Number.isFinite(expiresMs)) {
    return nowMs > expiresMs;
  }
  const createdMs = Date.parse(pending.createdAt);
  if (!Number.isFinite(createdMs)) return false;
  return nowMs - createdMs > PENDING_CONFIRMATION_TIMEOUT_MS;
}

function pendingFromAssistantTurn(
  turn: ConversationTurn,
  channel: NatalieChannel,
  role?: string | null,
  permissions?: string[]
): PendingConfirmation | null {
  if (turn.role !== "assistant" || turn.confirmationState !== "pending") return null;
  if (!turn.action || !turn.proposal) return null;

  const confirmation = evaluateConfirmationPolicy({
    action: turn.action,
    channel,
    role,
    permissions,
  });
  const createdAt = turn.at;
  return stampPendingConfirmation({
    confirmationId: turn.confirmationId ?? `turn:${turn.id}`,
    action: turn.action,
    proposal: turn.proposal,
    confirmationType: confirmation.confirmationType,
    spokenPrompt: turn.text,
    uiPrompt: turn.text,
    createdAt,
  });
}

export function findRecentPendingConfirmationInHistory(
  history: ConversationTurn[],
  channel: NatalieChannel,
  role?: string | null,
  permissions?: string[],
  nowMs = Date.now()
): PendingConfirmation | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const pending = pendingFromAssistantTurn(history[index]!, channel, role, permissions);
    if (!pending) continue;
    if (!isPendingConfirmationExpired(pending, nowMs)) return pending;
  }
  return null;
}

export function resolveActivePendingConfirmation(input: {
  session: ConversationSessionRecord;
  channel: NatalieChannel;
  role?: string | null;
  permissions?: string[];
  nowMs?: number;
}): {
  pending: PendingConfirmation | null;
  source: "session" | "history" | "none";
  hadExpiredSessionPending: boolean;
} {
  const nowMs = input.nowMs ?? Date.now();
  const sessionPending = input.session.pendingConfirmation;

  if (sessionPending && !isPendingConfirmationExpired(sessionPending, nowMs)) {
    return { pending: sessionPending, source: "session", hadExpiredSessionPending: false };
  }

  const historyPending = findRecentPendingConfirmationInHistory(
    input.session.structuredHistory,
    input.channel,
    input.role,
    input.permissions,
    nowMs
  );

  if (sessionPending && isPendingConfirmationExpired(sessionPending, nowMs)) {
    if (historyPending) {
      return { pending: historyPending, source: "history", hadExpiredSessionPending: true };
    }
    return { pending: null, source: "none", hadExpiredSessionPending: true };
  }

  if (historyPending) {
    return { pending: historyPending, source: "history", hadExpiredSessionPending: false };
  }

  return { pending: null, source: "none", hadExpiredSessionPending: false };
}

export function newPendingConfirmationId(): string {
  return randomUUID();
}
