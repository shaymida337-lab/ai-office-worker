import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { describe, it } from "node:test";
import type { ConversationSessionRecord } from "../conversationTypes.js";
import { processVoiceTurn } from "./voiceAdapter.js";
import {
  claimConfirmationExecution,
  completeConfirmationExecution,
  releaseConfirmationExecution,
  VOICE_ALREADY_EXECUTED_MESSAGE,
} from "./voiceConfirmationExecution.js";
import {
  beginVoiceTurnIdempotency,
  completeVoiceTurnIdempotency,
  measureIdempotencyLookupLatency,
  VOICE_TURN_ROUTE_KEY,
} from "./voiceIdempotency.js";

type IdempotencyRow = {
  id: string;
  organizationId: string;
  routeKey: string;
  idempotencyKey: string;
  requestHash: string;
  statusCode: number | null;
  responseBodyJson: unknown;
  completedAt: Date | null;
};

type ConfirmationRow = {
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
  createdAt: Date;
  completedAt: Date | null;
};

function mockPrisma() {
  const idempotencyRows = new Map<string, IdempotencyRow>();
  const confirmationRows = new Map<string, ConfirmationRow>();

  const idemKey = (organizationId: string, routeKey: string, idempotencyKey: string) =>
    `${organizationId}:${routeKey}:${idempotencyKey}`;

  return {
    prisma: {
      apiIdempotencyKey: {
        findUnique: async (args: {
          where: { organizationId_routeKey_idempotencyKey: { organizationId: string; routeKey: string; idempotencyKey: string } };
        }) => {
          const w = args.where.organizationId_routeKey_idempotencyKey;
          return idempotencyRows.get(idemKey(w.organizationId, w.routeKey, w.idempotencyKey)) ?? null;
        },
        create: async (args: {
          data: { organizationId: string; routeKey: string; idempotencyKey: string; requestHash: string };
          select: { id: true };
        }) => {
          const k = idemKey(args.data.organizationId, args.data.routeKey, args.data.idempotencyKey);
          if (idempotencyRows.has(k)) {
            const err = new Error("duplicate");
            (err as { code?: string }).code = "P2002";
            throw err;
          }
          const id = `idem-${idempotencyRows.size + 1}`;
          idempotencyRows.set(k, {
            id,
            organizationId: args.data.organizationId,
            routeKey: args.data.routeKey,
            idempotencyKey: args.data.idempotencyKey,
            requestHash: args.data.requestHash,
            statusCode: null,
            responseBodyJson: null,
            completedAt: null,
          });
          return { id };
        },
        update: async (args: {
          where: { id: string };
          data: { statusCode: number; responseBodyJson: unknown; completedAt: Date };
        }) => {
          for (const row of idempotencyRows.values()) {
            if (row.id === args.where.id) {
              row.statusCode = args.data.statusCode;
              row.responseBodyJson = args.data.responseBodyJson;
              row.completedAt = args.data.completedAt;
            }
          }
        },
      },
      natalieConfirmationExecution: {
        create: async (args: { data: Omit<ConfirmationRow, "id" | "ok" | "resultMessage" | "resultPayload" | "createdAt" | "completedAt"> }) => {
          if (confirmationRows.has(args.data.confirmationId)) {
            const err = new Error("duplicate");
            (err as { code?: string }).code = "P2002";
            throw err;
          }
          const id = `conf-${confirmationRows.size + 1}`;
          confirmationRows.set(args.data.confirmationId, {
            id,
            ...args.data,
            ok: null,
            resultMessage: null,
            resultPayload: null,
            createdAt: new Date(),
            completedAt: null,
          });
          return { id };
        },
        findUnique: async (args: { where: { confirmationId: string } }) =>
          confirmationRows.get(args.where.confirmationId) ?? null,
        update: async (args: {
          where: { id: string };
          data: Partial<ConfirmationRow>;
        }) => {
          for (const row of confirmationRows.values()) {
            if (row.id === args.where.id) {
              Object.assign(row, args.data);
            }
          }
        },
        deleteMany: async (args: { where: { id: string; status: string } }) => {
          const row = [...confirmationRows.values()].find((item) => item.id === args.where.id);
          if (row && row.status === args.where.status) {
            confirmationRows.delete(row.confirmationId);
          }
          return { count: 1 };
        },
      },
      natalieConversationSession: {
        updateMany: async () => ({ count: 1 }),
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    },
    idempotencyRows,
    confirmationRows,
  };
}

function sessionWithConfirmation(confirmationId: string): ConversationSessionRecord {
  return {
    id: randomUUID(),
    organizationId: "org-1",
    userId: "user-1",
    currentChannel: "web_voice",
    structuredHistory: [],
    pendingAction: { action: "create_task", proposal: { title: "להתקשר לספק" } },
    pendingConfirmation: {
      confirmationId,
      action: "create_task",
      proposal: { title: "להתקשר לספק" },
      confirmationType: "soft",
      spokenPrompt: "לאשר?",
      uiPrompt: "לאשר?",
      createdAt: new Date().toISOString(),
    },
    interruptionState: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
  };
}

describe("voice idempotency phase A2", () => {
  it("replays duplicate voice turn id without re-executing", async () => {
    const { prisma } = mockPrisma();
    const turnId = randomUUID();
    const body = { transcript: "כן", sessionId: "s1", turnId };

    const first = await beginVoiceTurnIdempotency({
      prisma: prisma as never,
      organizationId: "org-1",
      turnId,
      body,
    });
    assert.equal(first.mode, "active");
    if (first.mode !== "active") return;

    await completeVoiceTurnIdempotency({
      prisma: prisma as never,
      recordId: first.recordId,
      responseBody: { answer: "בוצע", executed: true },
    });

    const replay = await beginVoiceTurnIdempotency({
      prisma: prisma as never,
      organizationId: "org-1",
      turnId,
      body,
    });
    assert.equal(replay.mode, "replay");
    if (replay.mode !== "replay") return;
    assert.deepEqual(replay.responseBody, { answer: "בוצע", executed: true });
    assert.ok(replay.lookupLatencyMs < 10);
  });

  it("measures idempotency lookup under 10ms with in-memory store", async () => {
    const { prisma } = mockPrisma();
    const turnId = randomUUID();
    const begin = await beginVoiceTurnIdempotency({
      prisma: prisma as never,
      organizationId: "org-1",
      turnId,
      body: { transcript: "שלום", sessionId: null, turnId },
    });
    assert.equal(begin.mode, "active");
    const latency = await measureIdempotencyLookupLatency({
      prisma: prisma as never,
      organizationId: "org-1",
      turnId,
    });
    assert.ok(latency < 10);
  });

  it("claims confirmation once and replays duplicate confirmation", async () => {
    const { prisma, confirmationRows } = mockPrisma();
    const confirmationId = randomUUID();
    const claim = await claimConfirmationExecution(
      {
        organizationId: "org-1",
        userId: "user-1",
        sessionId: "s1",
        confirmationId,
        turnId: "turn-1",
        action: "create_task",
      },
      { prisma: prisma as never }
    );
    assert.equal(claim.mode, "claimed");

    await completeConfirmationExecution(
      {
        recordId: claim.mode === "claimed" ? claim.recordId : "",
        ok: true,
        resultMessage: "בוצע",
      },
      { prisma: prisma as never }
    );
    confirmationRows.get(confirmationId)!.status = "completed";

    const replay = await claimConfirmationExecution(
      {
        organizationId: "org-1",
        userId: "user-1",
        sessionId: "s1",
        confirmationId,
        turnId: "turn-2",
        action: "create_task",
      },
      { prisma: prisma as never }
    );
    assert.equal(replay.mode, "replay");
    if (replay.mode !== "replay") return;
    assert.equal(replay.duplicateTurn, false);
  });

  it("releases failed confirmation claim so retry can proceed", async () => {
    const { prisma } = mockPrisma();
    const confirmationId = randomUUID();
    const claim = await claimConfirmationExecution(
      {
        organizationId: "org-1",
        userId: "user-1",
        sessionId: "s1",
        confirmationId,
        turnId: "turn-1",
        action: "book_appointment",
      },
      { prisma: prisma as never }
    );
    assert.equal(claim.mode, "claimed");
    if (claim.mode !== "claimed") return;
    await releaseConfirmationExecution(claim.recordId, { prisma: prisma as never });

    const second = await claimConfirmationExecution(
      {
        organizationId: "org-1",
        userId: "user-1",
        sessionId: "s1",
        confirmationId,
        turnId: "turn-2",
        action: "book_appointment",
      },
      { prisma: prisma as never }
    );
    assert.equal(second.mode, "claimed");
  });

  it("executes task proposal only once under duplicate confirmation turns", async () => {
    const confirmationId = randomUUID();
    const sessionId = randomUUID();
    const session = sessionWithConfirmation(confirmationId);
    session.id = sessionId;
    let executeCalls = 0;
    const sessions = new Map([[sessionId, session]]);
    const { prisma, confirmationRows } = mockPrisma();

    const deps = {
      getSession: async (input: { sessionId: string }) => sessions.get(input.sessionId) ?? null,
      saveSession: async (value: ConversationSessionRecord) => {
        sessions.set(value.id, value);
        return value;
      },
      claimConfirmationExecutionFn: (input) => claimConfirmationExecution(input, { prisma: prisma as never }),
      releaseConfirmationExecutionFn: (recordId) => releaseConfirmationExecution(recordId, { prisma: prisma as never }),
      saveSessionAfterConfirmationExecutionFn: async (input: {
        recordId: string;
        ok: boolean;
        resultMessage: string;
        sessionPatch: { structuredHistory: unknown };
      }) => {
        await completeConfirmationExecution(
          {
            recordId: input.recordId,
            ok: input.ok,
            resultMessage: input.resultMessage,
          },
          { prisma: prisma as never }
        );
        const row = [...confirmationRows.values()].find((item) => item.id === input.recordId);
        if (row) row.status = "completed";
        const current = sessions.get(sessionId)!;
        sessions.set(sessionId, {
          ...current,
          structuredHistory: input.sessionPatch.structuredHistory as ConversationSessionRecord["structuredHistory"],
          pendingConfirmation: null,
          pendingAction: null,
        });
      },
      executeProposal: async () => {
        executeCalls += 1;
        return { ok: true, action: "create_task", message: 'המשימה "להתקשר לספק" נוצרה.' };
      },
      processTranscriptAccuracyFn: async ({ rawTranscript }: { rawTranscript: string }) => ({
        normalizedTranscript: rawTranscript,
        confidence: 1,
        clarificationRequired: false,
        actionBlocked: false,
        corrections: [],
      }),
    };

    const first = await processVoiceTurn(
      {
        organizationId: "org-1",
        userId: "user-1",
        transcript: "כן",
        sessionId,
        turnId: "turn-a",
        role: "owner",
      },
      deps
    );
    assert.equal(first.executed, true);
    assert.equal(executeCalls, 1);

    session.pendingConfirmation = {
      confirmationId,
      action: "create_task",
      proposal: { title: "להתקשר לספק" },
      confirmationType: "soft",
      spokenPrompt: "לאשר?",
      uiPrompt: "לאשר?",
      createdAt: new Date().toISOString(),
    };
    sessions.set(sessionId, session);

    const second = await processVoiceTurn(
      {
        organizationId: "org-1",
        userId: "user-1",
        transcript: "כן",
        sessionId,
        turnId: "turn-b",
        role: "owner",
      },
      deps
    );
    assert.equal(executeCalls, 1);
    assert.equal(second.duplicateExecution, true);
    assert.equal(second.spokenResponse, VOICE_ALREADY_EXECUTED_MESSAGE);
  });

  it("handles concurrent confirmation claims with single execution", async () => {
    const confirmationId = randomUUID();
    const sessionId = randomUUID();
    const session = sessionWithConfirmation(confirmationId);
    session.id = sessionId;
    let executeCalls = 0;
    const sessions = new Map([[sessionId, session]]);
    const { prisma, confirmationRows } = mockPrisma();

    const deps = {
      getSession: async (input: { sessionId: string }) => sessions.get(input.sessionId) ?? null,
      saveSession: async (value: ConversationSessionRecord) => {
        sessions.set(value.id, value);
        return value;
      },
      claimConfirmationExecutionFn: (input: Parameters<typeof claimConfirmationExecution>[0]) =>
        claimConfirmationExecution(input, { prisma: prisma as never }),
      releaseConfirmationExecutionFn: (recordId: string) =>
        releaseConfirmationExecution(recordId, { prisma: prisma as never }),
      saveSessionAfterConfirmationExecutionFn: async (input: {
        recordId: string;
        ok: boolean;
        resultMessage: string;
      }) => {
        await completeConfirmationExecution(
          {
            recordId: input.recordId,
            ok: input.ok,
            resultMessage: input.resultMessage,
          },
          { prisma: prisma as never }
        );
        const row = [...confirmationRows.values()].find((item) => item.id === input.recordId);
        if (row) row.status = "completed";
      },
      executeProposal: async () => {
        executeCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: true, action: "issue_invoice", message: "הטיוטה נשמרה." };
      },
      processTranscriptAccuracyFn: async ({ rawTranscript }: { rawTranscript: string }) => ({
        normalizedTranscript: rawTranscript,
        confidence: 1,
        clarificationRequired: false,
        actionBlocked: false,
        corrections: [],
      }),
    };

    session.pendingConfirmation = {
      ...session.pendingConfirmation!,
      action: "issue_invoice",
      proposal: { customerName: "דוד", amount: 100 },
    };
    session.pendingAction = { action: "issue_invoice", proposal: { customerName: "דוד", amount: 100 } };

    const [a, b] = await Promise.all([
      processVoiceTurn(
        { organizationId: "org-1", userId: "user-1", transcript: "כן", sessionId, turnId: "c1", role: "owner" },
        deps
      ),
      processVoiceTurn(
        { organizationId: "org-1", userId: "user-1", transcript: "כן", sessionId, turnId: "c2", role: "owner" },
        deps
      ),
    ]);

    assert.equal(executeCalls, 1);
    const executedCount = [a, b].filter((result) => result.executed && !result.duplicateExecution).length;
    const duplicateCount = [a, b].filter((result) => result.duplicateExecution).length;
    assert.equal(executedCount + duplicateCount, 2);
  });
});
