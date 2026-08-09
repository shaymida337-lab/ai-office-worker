/**
 * Temporary chat-window routing diagnostics for Natalie ask turns.
 * Logs + response metadata: message, endpoint, selectedHandler, fallbackUsed.
 */

export const NATALIE_CHAT_ENDPOINT = "/api/natalie/ask" as const;

export type NatalieAskSelectedHandler =
  | "calendar_read"
  | "calendar_write"
  | "crm"
  | "business_memory"
  | "claude_fallback";

export type NatalieAskRoutingMeta = {
  message: string;
  endpoint: typeof NATALIE_CHAT_ENDPOINT;
  selectedHandler: NatalieAskSelectedHandler;
  fallbackUsed: boolean;
};

export function buildNatalieAskRoutingMeta(params: {
  message: string;
  selectedHandler: NatalieAskSelectedHandler;
  fallbackUsed?: boolean;
}): NatalieAskRoutingMeta {
  return {
    message: params.message,
    endpoint: NATALIE_CHAT_ENDPOINT,
    selectedHandler: params.selectedHandler,
    fallbackUsed: params.fallbackUsed ?? params.selectedHandler === "claude_fallback",
  };
}

export function logNatalieAskRouting(meta: NatalieAskRoutingMeta): void {
  console.info("[natalie/ask-routing]", {
    message: meta.message,
    endpoint: meta.endpoint,
    selectedHandler: meta.selectedHandler,
    fallbackUsed: meta.fallbackUsed,
  });
}
