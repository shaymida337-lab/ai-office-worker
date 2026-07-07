/**
 * WhatsApp → Natalie calendar brain bridge.
 *
 * WhatsApp is NOT a second calendar system. Every calendar command that arrives
 * over WhatsApp (create / cancel / move / list / availability) is routed through
 * the SAME brain the web chat and voice channels use: `processNatalieTurn`, which
 * in turn uses the deterministic calendarIntentParser, schedulingFacade,
 * validation, and centralized Hebrew templates (calendarMessages).
 *
 * There is intentionally no WhatsApp-specific parser or confirmation flow here —
 * only channel plumbing (owner identity + session continuity) so the existing
 * confirmation-before-write behavior works across two WhatsApp turns.
 */
import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma.js";
import { parseCalendarIntent } from "../calendar/calendarIntentParser.js";
import { isAvailabilityQuestion } from "../natalieAvailability.js";
import { parseVoiceConfirmationIntent } from "../conversation/voice/voiceConfirmation.js";
import { processNatalieTurn } from "../conversation/conversationRuntime.js";
import { isCalendarFollowUpPhrase } from "../calendar/calendarPendingIntent.js";
import { calendarMessages } from "../calendar/calendarMessages.js";
import { sanitizeWhatsAppText } from "./natalieWhatsAppUx.js";

/** Hard cap on how long a single WhatsApp calendar turn may take before we send
 *  a friendly "try again" message instead of silently hanging. */
export const WHATSAPP_CALENDAR_TURN_TIMEOUT_MS = 25_000;

class WhatsAppCalendarTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new WhatsAppCalendarTimeoutError(`calendar turn exceeded ${ms}ms`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** Minimal shape of the persisted Natalie session this bridge needs. */
type WhatsAppNatalieSession = {
  id: string;
  hasPendingConfirmation: boolean;
  hasPendingCalendarIntent: boolean;
};

export type WhatsAppCalendarDeps = {
  processTurn?: typeof processNatalieTurn;
  loadOwnerUserId?: (organizationId: string) => Promise<string | null>;
  loadLatestSession?: (
    organizationId: string,
    userId: string
  ) => Promise<WhatsAppNatalieSession | null>;
};

/**
 * True when the message is a calendar command the deterministic brain supports
 * (create / cancel / move / list) or an availability question. Pure + DB-free so
 * the webhook can cheaply decide whether to route to the calendar brain.
 */
export function isWhatsAppCalendarCommand(message: string): boolean {
  const text = message?.trim();
  if (!text) return false;
  if (parseCalendarIntent(text).intent !== "unknown") return true;
  return isAvailabilityQuestion(text);
}

function mentionsCalendarTopic(message: string): boolean {
  return /יומן|תורים?|תור\b|פגישה|פנוי/i.test(message.trim());
}

async function defaultLoadOwnerUserId(organizationId: string): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { userId: true },
  });
  return org?.userId ?? null;
}

async function defaultLoadLatestSession(
  organizationId: string,
  userId: string
): Promise<WhatsAppNatalieSession | null> {
  const row = await prisma.natalieConversationSession.findFirst({
    where: { organizationId, userId, currentChannel: "whatsapp" },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, pendingConfirmation: true, pendingAction: true },
  });
  if (!row) return null;
  const pending = row.pendingConfirmation;
  const hasPendingConfirmation =
    !!pending && typeof pending === "object" && !Array.isArray(pending);
  const pendingAction = row.pendingAction;
  const hasPendingCalendarIntent =
    !!pendingAction &&
    typeof pendingAction === "object" &&
    !Array.isArray(pendingAction) &&
    (pendingAction as { action?: string }).action === "calendar_intent_continuation";
  return { id: row.id, hasPendingConfirmation, hasPendingCalendarIntent };
}

/**
 * Route an owner WhatsApp message through the Natalie calendar brain when it is a
 * calendar command, or a confirmation reply (כן/לא/בטל) to a pending WhatsApp
 * calendar proposal. Returns the reply text to send back, or `null` when the
 * message should be handled by the existing owner chat engine instead.
 */
export async function maybeHandleWhatsAppCalendarMessage(
  input: { organizationId: string; message: string; phone?: string; correlationId?: string },
  deps: WhatsAppCalendarDeps = {}
): Promise<string | null> {
  const message = input.message?.trim();
  if (!message) return null;

  const correlationId = input.correlationId ?? randomUUID();
  const log = (event: string, extra: Record<string, unknown> = {}) =>
    console.log(`[whatsapp-calendar] ${event}`, {
      correlationId,
      organizationId: input.organizationId,
      ...extra,
    });

  const loadOwnerUserId = deps.loadOwnerUserId ?? defaultLoadOwnerUserId;
  const loadLatestSession = deps.loadLatestSession ?? defaultLoadLatestSession;
  const processTurn = deps.processTurn ?? processNatalieTurn;

  log("start", { messageLength: message.length });

  const userId = await loadOwnerUserId(input.organizationId);
  if (!userId) {
    log("skip: no owner user resolved");
    return null;
  }

  const session = await loadLatestSession(input.organizationId, userId);

  const isCalendarCommand = isWhatsAppCalendarCommand(message);
  const isConfirmationReply =
    !!session?.hasPendingConfirmation && parseVoiceConfirmationIntent(message) !== "none";
  const isCalendarTopic = mentionsCalendarTopic(message);

  const shouldRoute =
    isCalendarCommand ||
    isConfirmationReply ||
    session?.hasPendingCalendarIntent ||
    isCalendarFollowUpPhrase(message) ||
    (isCalendarTopic && !isCalendarCommand && !isConfirmationReply);

  log("routing decision", {
    userId,
    sessionId: session?.id ?? null,
    isCalendarCommand,
    isConfirmationReply,
    hasPendingCalendarIntent: session?.hasPendingCalendarIntent ?? false,
    isCalendarTopic,
    shouldRoute,
  });

  if (!shouldRoute) return null;

  if (isCalendarTopic && !isCalendarCommand && !isConfirmationReply && !session?.hasPendingCalendarIntent) {
    log("resolved: calendar-topic clarification");
    return sanitizeWhatsAppText(calendarMessages.unsupportedCalendar());
  }

  // The webhook already wraps this in safeReply, but we add a dedicated guard so
  // a slow/failed brain turn ALWAYS yields a friendly Hebrew reply (never silent)
  // and is logged with the correlation id for tracing.
  try {
    const result = await withTimeout(
      processTurn({
        organizationId: input.organizationId,
        userId,
        channel: "whatsapp",
        modality: "text",
        message,
        sessionId: session?.id ?? null,
        role: "owner",
      }),
      WHATSAPP_CALENDAR_TURN_TIMEOUT_MS
    );

    const reply = result.displayResponse || result.answer || "";
    if (!reply.trim()) {
      log("resolved: empty brain reply → error fallback");
      return sanitizeWhatsAppText(calendarMessages.processingError());
    }
    log("resolved: brain reply", { replyLength: reply.length });
    return sanitizeWhatsAppText(reply);
  } catch (err) {
    if (err instanceof WhatsAppCalendarTimeoutError) {
      log("error: timeout", { message: err.message });
      return sanitizeWhatsAppText(calendarMessages.processingTimeout());
    }
    log("error: brain turn failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return sanitizeWhatsAppText(calendarMessages.processingError());
  }
}
