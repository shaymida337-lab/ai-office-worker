import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type {
  ConversationInterruptionState,
  ConversationSessionRecord,
  ConversationTurn,
  NatalieChannel,
  PendingConfirmation,
} from "./conversationTypes.js";
import { importLegacyHistory } from "./conversationHistory.js";

type SessionJson = {
  structuredHistory: ConversationTurn[];
  pendingAction: ConversationSessionRecord["pendingAction"];
  pendingConfirmation: PendingConfirmation | null;
  interruptionState: ConversationInterruptionState | null;
};

export const CONVERSATION_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function parseSessionRow(row: {
  id: string;
  organizationId: string;
  userId: string;
  currentChannel: string;
  structuredHistory: unknown;
  pendingAction: unknown;
  pendingConfirmation: unknown;
  interruptionState: unknown;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
}): ConversationSessionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    currentChannel: row.currentChannel as NatalieChannel,
    structuredHistory: Array.isArray(row.structuredHistory) ? (row.structuredHistory as ConversationTurn[]) : [],
    pendingAction:
      row.pendingAction && typeof row.pendingAction === "object" && !Array.isArray(row.pendingAction)
        ? (row.pendingAction as ConversationSessionRecord["pendingAction"])
        : null,
    pendingConfirmation:
      row.pendingConfirmation && typeof row.pendingConfirmation === "object" && !Array.isArray(row.pendingConfirmation)
        ? (row.pendingConfirmation as PendingConfirmation)
        : null,
    interruptionState:
      row.interruptionState && typeof row.interruptionState === "object" && !Array.isArray(row.interruptionState)
        ? (row.interruptionState as ConversationInterruptionState)
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastMessageAt: row.lastMessageAt.toISOString(),
  };
}

export async function createConversationSession(input: {
  organizationId: string;
  userId: string;
  channel: NatalieChannel;
  legacyHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<ConversationSessionRecord> {
  const structuredHistory = input.legacyHistory?.length
    ? importLegacyHistory(input.legacyHistory, input.channel)
    : [];
  const row = await prisma.natalieConversationSession.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      currentChannel: input.channel,
      structuredHistory: structuredHistory as Prisma.InputJsonValue,
      pendingAction: Prisma.JsonNull,
      pendingConfirmation: Prisma.JsonNull,
      interruptionState: Prisma.JsonNull,
    },
  });
  return parseSessionRow(row);
}

export async function getConversationSession(input: {
  sessionId: string;
  organizationId: string;
  userId: string;
}): Promise<ConversationSessionRecord | null> {
  const row = await prisma.natalieConversationSession.findFirst({
    where: {
      id: input.sessionId,
      organizationId: input.organizationId,
      userId: input.userId,
    },
  });
  return row ? parseSessionRow(row) : null;
}

export async function saveConversationSession(session: ConversationSessionRecord): Promise<ConversationSessionRecord> {
  const row = await prisma.natalieConversationSession.update({
    where: { id: session.id },
    data: {
      currentChannel: session.currentChannel,
      structuredHistory: session.structuredHistory as Prisma.InputJsonValue,
      pendingAction:
        session.pendingAction === null ? Prisma.JsonNull : (session.pendingAction as Prisma.InputJsonValue),
      pendingConfirmation:
        session.pendingConfirmation === null
          ? Prisma.JsonNull
          : (session.pendingConfirmation as Prisma.InputJsonValue),
      interruptionState:
        session.interruptionState === null
          ? Prisma.JsonNull
          : (session.interruptionState as Prisma.InputJsonValue),
      lastMessageAt: new Date(session.lastMessageAt),
    },
  });
  return parseSessionRow(row);
}

export async function resolveConversationSession(input: {
  sessionId?: string | null;
  organizationId: string;
  userId: string;
  channel: NatalieChannel;
  legacyHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<ConversationSessionRecord> {
  if (input.sessionId) {
    const existing = await getConversationSession({
      sessionId: input.sessionId,
      organizationId: input.organizationId,
      userId: input.userId,
    });
    if (existing) {
      return {
        ...existing,
        currentChannel: input.channel,
      };
    }
  }
  return createConversationSession({
    organizationId: input.organizationId,
    userId: input.userId,
    channel: input.channel,
    legacyHistory: input.legacyHistory,
  });
}

export function newConversationTurnId(): string {
  return randomUUID();
}

export function sessionDurationMs(session: ConversationSessionRecord): number {
  const start = Date.parse(session.createdAt);
  const end = Date.parse(session.lastMessageAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

export function isConversationSessionExpired(
  session: Pick<ConversationSessionRecord, "lastMessageAt">,
  nowMs = Date.now()
): boolean {
  const lastMessageAtMs = Date.parse(session.lastMessageAt);
  if (!Number.isFinite(lastMessageAtMs)) return false;
  return nowMs - lastMessageAtMs > CONVERSATION_SESSION_TTL_MS;
}
