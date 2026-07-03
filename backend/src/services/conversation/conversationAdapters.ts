import type { NatalieClaudeResponse } from "../claude.js";
import type { ConfirmationPolicyResult, NatalieChannel } from "./conversationTypes.js";

export type ChannelAdapter = {
  channel: NatalieChannel;
  normalizeInput: (raw: string) => string;
  renderDisplay: (response: NatalieClaudeResponse, confirmation: ConfirmationPolicyResult) => string;
  renderSpoken: (response: NatalieClaudeResponse, confirmation: ConfirmationPolicyResult) => string;
};

function responseAnswer(response: NatalieClaudeResponse): string {
  return "answer" in response && typeof response.answer === "string" ? response.answer : "";
}

function withConfirmationSuffix(answer: string, confirmation: ConfirmationPolicyResult): string {
  if (!confirmation.required || !confirmation.uiPrompt) return answer;
  if (answer.includes("לאשר")) return answer;
  return `${answer.trim()} ${confirmation.uiPrompt}`.trim();
}

function createAdapter(channel: NatalieChannel): ChannelAdapter {
  return {
    channel,
    normalizeInput(raw: string) {
      return raw.replace(/\s+/g, " ").trim();
    },
    renderDisplay(response, confirmation) {
      return withConfirmationSuffix(responseAnswer(response), confirmation);
    },
    renderSpoken(response, confirmation) {
      const spoken = responseAnswer(response);
      if (!confirmation.required || !confirmation.spokenPrompt) return spoken;
      if (spoken.includes("לאשר")) return spoken;
      return `${spoken.trim()} ${confirmation.spokenPrompt}`.trim();
    },
  };
}

const adapters: Record<NatalieChannel, ChannelAdapter> = {
  web_chat: createAdapter("web_chat"),
  web_voice: createAdapter("web_voice"),
  whatsapp: createAdapter("whatsapp"),
  email: createAdapter("email"),
  api: createAdapter("api"),
};

export function getChannelAdapter(channel: NatalieChannel): ChannelAdapter {
  return adapters[channel] ?? adapters.web_chat;
}

export function normalizeChannelInput(channel: NatalieChannel, raw: string): string {
  return getChannelAdapter(channel).normalizeInput(raw);
}
