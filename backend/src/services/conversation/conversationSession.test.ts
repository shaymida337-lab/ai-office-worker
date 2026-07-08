import test from "node:test";
import assert from "node:assert/strict";

import {
  CONVERSATION_SESSION_TTL_MS,
  isConversationSessionExpired,
} from "./conversationSession.js";

test("isConversationSessionExpired returns false when session is fresh", () => {
  const now = Date.now();
  const session = { lastMessageAt: new Date(now - 2 * 60 * 1000).toISOString() };
  assert.equal(isConversationSessionExpired(session, now), false);
});

test("isConversationSessionExpired returns true after ttl", () => {
  const now = Date.now();
  const session = { lastMessageAt: new Date(now - CONVERSATION_SESSION_TTL_MS - 1_000).toISOString() };
  assert.equal(isConversationSessionExpired(session, now), true);
});

test("isConversationSessionExpired is resilient to malformed timestamps", () => {
  const session = { lastMessageAt: "not-a-date" };
  assert.equal(isConversationSessionExpired(session, Date.now()), false);
});
