import { randomUUID } from "crypto";
import { performance } from "node:perf_hooks";
import type { Prisma } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import { prisma as defaultPrisma } from "../../../lib/prisma.js";

export const VOICE_ALREADY_EXECUTED_MESSAGE = "כבר ביצעתי את הפעולה הזו.";

const CLAIM_WAIT_MS = 50;
const CLAIM_WAIT_ATTEMPTS = 24;

type PrismaLike = Pick<typeof defaultPrisma, "natalieConfirmationExecution" | "natalieConversationSession" | "$transaction">;

export type ConfirmationExecutionRecord = {
  id: string;
  organizationId: string;
  userId: string;
  sessionId: string;
  confirmationId: string;
  turnId: string | null;
  action: string;
  status: string;
  ok: boolean | null;
  resultMessage: string | null;
  resultPayload: unknown;
};

export type ClaimConfirmationResult =
  | { mode: "claimed"; recordId: string }
  | { mode: "replay"; record: ConfirmationExecutionRecord; duplicateTurn: boolean };

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadConfirmationRecord(
  prisma: PrismaLike,
  confirmationId: string
): Promise<ConfirmationExecutionRecord | null> {
  const existing = await prisma.natalieConfirmationExecution.findUnique({
    where: { confirmationId },
  });
  return existing ? mapRow(existing) : null;
}

function mapRow(row: {
  id: string;
  organizationId: string;
  userId: string;
  sessionId: string;
  confirmationId: string;
  turnId: string | null;
  action: string;
  status: string;
  ok: boolean | null;
  resultMessage: string | null;
  resultPayload: unknown;
}): ConfirmationExecutionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    sessionId: row.sessionId,
    confirmationId: row.confirmationId,
    turnId: row.turnId,
    action: row.action,
    status: row.status,
    ok: row.ok,
    resultMessage: row.resultMessage,
    resultPayload: row.resultPayload,
  };
}

export function newConfirmationId(): string {
  return randomUUID();
}

export async function claimConfirmationExecution(
  input: {
    organizationId: string;
    userId: string;
    sessionId: string;
    confirmationId: string;
    turnId?: string | null;
    action: string;
  },
  deps: { prisma?: PrismaLike } = {}
): Promise<ClaimConfirmationResult> {
  const prisma = deps.prisma ?? defaultPrisma;
  try {
    const created = await prisma.natalieConfirmationExecution.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        sessionId: input.sessionId,
        confirmationId: input.confirmationId,
        turnId: input.turnId ?? null,
        action: input.action,
        status: "processing",
      },
      select: { id: true },
    });
    return { mode: "claimed", recordId: created.id };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return waitForConfirmationRecord(prisma, input.confirmationId, input.turnId ?? null);
  }
}

async function waitForConfirmationRecord(
  prisma: PrismaLike,
  confirmationId: string,
  turnId: string | null
): Promise<Extract<ClaimConfirmationResult, { mode: "replay" }>> {
  for (let attempt = 0; attempt < CLAIM_WAIT_ATTEMPTS; attempt += 1) {
    const row = await loadConfirmationRecord(prisma, confirmationId);
    if (!row) {
      throw new Error("CONFIRMATION_CLAIM_CONFLICT");
    }
    if (row.status === "completed" || row.status === "failed") {
      return {
        mode: "replay",
        record: row,
        duplicateTurn: Boolean(turnId && row.turnId === turnId),
      };
    }
    await sleep(CLAIM_WAIT_MS);
  }
  throw new Error("CONFIRMATION_IN_PROGRESS");
}

export async function completeConfirmationExecution(
  input: {
    recordId: string;
    ok: boolean;
    resultMessage: string;
    resultPayload?: unknown;
  },
  deps: { prisma?: PrismaLike } = {}
): Promise<void> {
  const prisma = deps.prisma ?? defaultPrisma;
  await prisma.natalieConfirmationExecution.update({
    where: { id: input.recordId },
    data: {
      status: "completed",
      ok: input.ok,
      resultMessage: input.resultMessage,
      resultPayload:
        input.resultPayload === undefined ? undefined : (input.resultPayload as Prisma.InputJsonValue),
      completedAt: new Date(),
    },
  });
}

export async function releaseConfirmationExecution(
  recordId: string,
  deps: { prisma?: PrismaLike } = {}
): Promise<void> {
  const prisma = deps.prisma ?? defaultPrisma;
  await prisma.natalieConfirmationExecution.deleteMany({
    where: { id: recordId, status: "processing" },
  });
}

export async function saveSessionAfterConfirmationExecution(
  input: {
    sessionId: string;
    organizationId: string;
    userId: string;
    recordId: string;
    ok: boolean;
    resultMessage: string;
    resultPayload?: unknown;
    sessionPatch: {
      currentChannel: string;
      structuredHistory: unknown;
      pendingAction: unknown;
      pendingConfirmation: unknown;
      interruptionState: unknown;
      lastMessageAt: string;
    };
  },
  deps: { prisma?: PrismaLike } = {}
): Promise<void> {
  const prisma = deps.prisma ?? defaultPrisma;
  await prisma.$transaction([
    prisma.natalieConfirmationExecution.update({
      where: { id: input.recordId },
      data: {
        status: "completed",
        ok: input.ok,
        resultMessage: input.resultMessage,
        resultPayload:
          input.resultPayload === undefined ? undefined : (input.resultPayload as Prisma.InputJsonValue),
        completedAt: new Date(),
      },
    }),
    prisma.natalieConversationSession.updateMany({
      where: {
        id: input.sessionId,
        organizationId: input.organizationId,
        userId: input.userId,
      },
      data: {
        currentChannel: input.sessionPatch.currentChannel,
        structuredHistory: input.sessionPatch.structuredHistory as Prisma.InputJsonValue,
        pendingAction:
          input.sessionPatch.pendingAction === null
            ? PrismaNamespace.JsonNull
            : (input.sessionPatch.pendingAction as Prisma.InputJsonValue),
        pendingConfirmation:
          input.sessionPatch.pendingConfirmation === null
            ? PrismaNamespace.JsonNull
            : (input.sessionPatch.pendingConfirmation as Prisma.InputJsonValue),
        interruptionState:
          input.sessionPatch.interruptionState === null
            ? PrismaNamespace.JsonNull
            : (input.sessionPatch.interruptionState as Prisma.InputJsonValue),
        lastMessageAt: new Date(input.sessionPatch.lastMessageAt),
      },
    }),
  ]);
}

export async function lookupConfirmationExecutionLatencyMs(
  confirmationId: string,
  deps: { prisma?: PrismaLike } = {}
): Promise<{ found: boolean; latencyMs: number }> {
  const prisma = deps.prisma ?? defaultPrisma;
  const startedAt = performance.now();
  const row = await prisma.natalieConfirmationExecution.findUnique({
    where: { confirmationId },
    select: { id: true },
  });
  return {
    found: Boolean(row),
    latencyMs: performance.now() - startedAt,
  };
}
