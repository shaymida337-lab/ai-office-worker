import test from "node:test";
import assert from "node:assert/strict";

import {
  isWhatsAppCalendarCommand,
  maybeHandleWhatsAppCalendarMessage,
  type WhatsAppCalendarDeps,
} from "./whatsappNatalieCalendar.js";
import type { ProcessNatalieTurnResult } from "../conversation/conversationTypes.js";

const ORG = "org-wa-1";
const OWNER_USER = "user-owner-1";

function fakeTurnResult(overrides: Partial<ProcessNatalieTurnResult> = {}): ProcessNatalieTurnResult {
  return {
    answer: "הבנתי: לקבוע תור לשרית מחר בשעה 15:00. לאשר?",
    conversationSessionId: "sess-1",
    displayResponse: "הבנתי: לקבוע תור לשרית מחר בשעה 15:00. לאשר?",
    spokenResponse: "הבנתי: לקבוע תור לשרית מחר בשעה 15:00. לאשר?",
    confirmation: { required: true, allowed: true, confirmationType: "soft" } as never,
    zeroWrongAction: { ready: true, violations: [] } as never,
    reliability: { correlationId: "c", sessionId: "sess-1", turnId: "t", health: "Healthy" } as never,
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<WhatsAppCalendarDeps> & { calls?: unknown[] } = {}
): WhatsAppCalendarDeps {
  return {
    loadOwnerUserId: overrides.loadOwnerUserId ?? (async () => OWNER_USER),
    loadLatestSession: overrides.loadLatestSession ?? (async () => null),
    processTurn: overrides.processTurn,
  };
}

// ---- Intent gate (pure, DB-free) ----

test("isWhatsAppCalendarCommand: create/cancel/move/list/availability → true", () => {
  assert.equal(isWhatsAppCalendarCommand("תקבעי תור לשרית מחר ב-3"), true);
  assert.equal(isWhatsAppCalendarCommand("תבטלי את התור של דני"), true);
  assert.equal(isWhatsAppCalendarCommand("תעבירי את התור של שרית למחר בארבע"), true);
  assert.equal(isWhatsAppCalendarCommand("מה יש לי מחר ביומן?"), true);
  assert.equal(isWhatsAppCalendarCommand("כמה תורים יש לי השבוע?"), true);
  assert.equal(isWhatsAppCalendarCommand("מתי אני פנוי?"), true);
});

test("isWhatsAppCalendarCommand: non-calendar owner chatter → false", () => {
  assert.equal(isWhatsAppCalendarCommand("דוח"), false);
  assert.equal(isWhatsAppCalendarCommand("כמה הכנסות היו לי החודש?"), false);
  assert.equal(isWhatsAppCalendarCommand("כן"), false);
  assert.equal(isWhatsAppCalendarCommand(""), false);
  assert.equal(isWhatsAppCalendarCommand("אולי משהו עם יומן"), false);
});

test("ambiguous calendar-topic message gets one deterministic clarification", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const reply = await maybeHandleWhatsAppCalendarMessage(
    { organizationId: ORG, message: "אולי משהו עם יומן", phone: "+972500000000" },
    makeDeps({
      processTurn: async (input) => {
        calls.push(input as Record<string, unknown>);
        return fakeTurnResult();
      },
    })
  );

  assert.equal(calls.length, 0);
  assert.equal(reply, "לא הבנתי את הבקשה ליומן. אפשר לנסח שוב עם שם, יום ושעה?");
});

// ---- Routing decisions ----

test("calendar command routes through the shared Natalie brain (channel=whatsapp, role=owner)", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const reply = await maybeHandleWhatsAppCalendarMessage(
    { organizationId: ORG, message: "תקבעי תור לשרית מחר ב-3", phone: "+972500000000" },
    makeDeps({
      processTurn: (async (input: Record<string, unknown>) => {
        calls.push(input);
        return fakeTurnResult();
      }) as unknown as WhatsAppCalendarDeps["processTurn"],
    })
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].organizationId, ORG);
  assert.equal(calls[0].userId, OWNER_USER);
  assert.equal(calls[0].channel, "whatsapp");
  assert.equal(calls[0].modality, "text");
  assert.equal(calls[0].role, "owner");
  assert.equal(calls[0].sessionId, null);
  assert.match(reply ?? "", /לאשר\?/);
});

test("non-calendar message with no pending confirmation → null (falls back to owner engine)", async () => {
  let called = false;
  const reply = await maybeHandleWhatsAppCalendarMessage(
    { organizationId: ORG, message: "כמה הכנסות היו לי החודש?" },
    makeDeps({
      processTurn: (async () => {
        called = true;
        return fakeTurnResult();
      }) as unknown as WhatsAppCalendarDeps["processTurn"],
    })
  );
  assert.equal(reply, null);
  assert.equal(called, false);
});

test("'כן' WITH a pending confirmation routes to the brain (confirmation continuation)", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const reply = await maybeHandleWhatsAppCalendarMessage(
    { organizationId: ORG, message: "כן" },
    makeDeps({
      loadLatestSession: async () => ({ id: "sess-42", hasPendingConfirmation: true }),
      processTurn: (async (input: Record<string, unknown>) => {
        calls.push(input);
        return fakeTurnResult({ displayResponse: "התור נקבע עבור שרית.", answer: "התור נקבע עבור שרית." });
      }) as unknown as WhatsAppCalendarDeps["processTurn"],
    })
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionId, "sess-42");
  assert.match(reply ?? "", /נקבע/);
});

test("'כן' WITHOUT a pending confirmation routes to the brain for a clarification (never silent)", async () => {
  // Spec: a lone "כן" must produce a terminal outcome (the brain asks what to
  // confirm) — it must NOT be silently dropped. The bareYesWithoutPending guard
  // lives in the shared brain, so the bridge routes and returns its reply.
  let called = false;
  const reply = await maybeHandleWhatsAppCalendarMessage(
    { organizationId: ORG, message: "כן" },
    makeDeps({
      loadLatestSession: async () => ({
        id: "sess-9",
        hasPendingConfirmation: false,
        hasPendingCalendarIntent: false,
      }),
      processTurn: (async () => {
        called = true;
        return fakeTurnResult({
          answer: "כדי לאשר צריך קודם בקשה. מה תרצה שאעשה ביומן?",
          displayResponse: "כדי לאשר צריך קודם בקשה. מה תרצה שאעשה ביומן?",
        });
      }) as unknown as WhatsAppCalendarDeps["processTurn"],
    })
  );
  assert.equal(called, true);
  assert.notEqual(reply, null);
  assert.match(reply ?? "", /תרצה|לאשר/);
});

test("existing whatsapp session is reused so multi-turn confirmation works", async () => {
  const calls: Array<Record<string, unknown>> = [];
  await maybeHandleWhatsAppCalendarMessage(
    { organizationId: ORG, message: "תבטלי את התור של שרית מחר" },
    makeDeps({
      loadLatestSession: async () => ({ id: "sess-77", hasPendingConfirmation: false }),
      processTurn: (async (input: Record<string, unknown>) => {
        calls.push(input);
        return fakeTurnResult();
      }) as unknown as WhatsAppCalendarDeps["processTurn"],
    })
  );
  assert.equal(calls[0].sessionId, "sess-77");
});

test("no resolvable owner userId → null (never routes without identity)", async () => {
  let called = false;
  const reply = await maybeHandleWhatsAppCalendarMessage(
    { organizationId: ORG, message: "תקבעי תור לשרית מחר ב-3" },
    makeDeps({
      loadOwnerUserId: async () => null,
      processTurn: (async () => {
        called = true;
        return fakeTurnResult();
      }) as unknown as WhatsAppCalendarDeps["processTurn"],
    })
  );
  assert.equal(reply, null);
  assert.equal(called, false);
});
