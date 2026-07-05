import {
  claimConfirmationExecution,
  completeConfirmationExecution,
  releaseConfirmationExecution,
} from "./voiceConfirmationExecution.js";

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
};

export function createMockVoicePrisma() {
  const confirmationRows = new Map<string, ConfirmationRow>();

  const prisma = {
    natalieConfirmationExecution: {
      create: async (args: {
        data: Omit<ConfirmationRow, "id" | "ok" | "resultMessage" | "resultPayload">;
      }) => {
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
        });
        return { id };
      },
      findUnique: async (args: { where: { confirmationId: string } }) =>
        confirmationRows.get(args.where.confirmationId) ?? null,
      update: async (args: { where: { id: string }; data: Partial<ConfirmationRow> }) => {
        for (const row of confirmationRows.values()) {
          if (row.id === args.where.id) {
            Object.assign(row, args.data);
          }
        }
      },
      deleteMany: async (args: { where: { id: string; status: string } }) => {
        for (const [key, row] of confirmationRows.entries()) {
          if (row.id === args.where.id && row.status === args.where.status) {
            confirmationRows.delete(key);
          }
        }
        return { count: 1 };
      },
    },
    natalieConversationSession: {
      updateMany: async () => ({ count: 1 }),
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };

  return {
    prisma,
    confirmationRows,
    confirmationDeps: {
      claimConfirmationExecutionFn: (input: Parameters<typeof claimConfirmationExecution>[0]) =>
        claimConfirmationExecution(input, { prisma: prisma as never }),
      releaseConfirmationExecutionFn: (recordId: string) =>
        releaseConfirmationExecution(recordId, { prisma: prisma as never }),
      saveSessionAfterConfirmationExecutionFn: async (input: {
        recordId: string;
        ok: boolean;
        resultMessage: string;
        sessionPatch?: { structuredHistory?: unknown };
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
    },
  };
}
