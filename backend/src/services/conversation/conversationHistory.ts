import { randomUUID } from "crypto";
import type { ConversationTurn, NatalieChannel } from "./conversationTypes.js";

export function createConversationTurn(input: {
  role: "user" | "assistant";
  text: string;
  channel: NatalieChannel;
  action?: string | null;
  proposal?: Record<string, unknown> | null;
  confirmationId?: string | null;
  confirmationState?: ConversationTurn["confirmationState"];
  at?: string;
}): ConversationTurn {
  return {
    id: randomUUID(),
    role: input.role,
    text: input.text.trim(),
    action: input.action ?? null,
    proposal: input.proposal ?? null,
    confirmationId: input.confirmationId ?? null,
    confirmationState: input.confirmationState ?? "none",
    channel: input.channel,
    at: input.at ?? new Date().toISOString(),
  };
}

export function toBrainHistory(turns: ConversationTurn[]): Array<{ role: "user" | "assistant"; content: string }> {
  return turns
    .filter((turn) => turn.text.trim().length > 0)
    .map((turn) => ({ role: turn.role, content: turn.text.trim() }))
    .slice(-10);
}

export function importLegacyHistory(
  legacyHistory: Array<{ role: "user" | "assistant"; content: string }>,
  channel: NatalieChannel
): ConversationTurn[] {
  return legacyHistory
    .filter((item) => item.content.trim().length > 0)
    .map((item) =>
      createConversationTurn({
        role: item.role,
        text: item.content,
        channel,
      })
    );
}

export function extractActionFromBrainResponse(
  response: Record<string, unknown>
): { action: string | null; proposal: Record<string, unknown> | null; answer: string } {
  const answer = typeof response.answer === "string" ? response.answer : "";
  const action = typeof response.action === "string" ? response.action : null;
  const proposal =
    response.proposal && typeof response.proposal === "object" && !Array.isArray(response.proposal)
      ? (response.proposal as Record<string, unknown>)
      : null;
  return { action, proposal, answer };
}

export function appendTurn(history: ConversationTurn[], turn: ConversationTurn, maxTurns = 40): ConversationTurn[] {
  const next = [...history, turn];
  return next.length > maxTurns ? next.slice(next.length - maxTurns) : next;
}
