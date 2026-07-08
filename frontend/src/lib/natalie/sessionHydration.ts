export type WidgetActionName =
  | "create_task"
  | "complete_task"
  | "show_invoice"
  | "issue_invoice"
  | "book_appointment"
  | "cancel_appointment"
  | "reschedule_appointment"
  | "suggest_available_times";

export type WidgetHydrationMessage = {
  id: string;
  sender: "natalie" | "user";
  text: string;
  action?: WidgetActionName;
  proposal?: Record<string, unknown>;
  actionStatus?: "pending" | "creating" | "created" | "cancelled" | "error";
};

export type ConversationTurnSnapshot = {
  id: string;
  role: "user" | "assistant";
  text: string;
  action?: string | null;
  proposal?: Record<string, unknown> | null;
  confirmationState?: "none" | "pending" | "confirmed" | "rejected";
  at: string;
};

export type PendingConfirmationSnapshot = {
  action: string;
  proposal: Record<string, unknown>;
  uiPrompt: string;
};

export type PendingActionSnapshot = {
  action: string;
  proposal: Record<string, unknown>;
};

export function isWidgetActionName(value: unknown): value is WidgetActionName {
  return (
    value === "create_task" ||
    value === "complete_task" ||
    value === "show_invoice" ||
    value === "issue_invoice" ||
    value === "book_appointment" ||
    value === "cancel_appointment" ||
    value === "reschedule_appointment" ||
    value === "suggest_available_times"
  );
}

export function toHydratedWidgetMessages(turns: ConversationTurnSnapshot[]): WidgetHydrationMessage[] {
  return turns.map<WidgetHydrationMessage>((turn) => {
    const message: WidgetHydrationMessage = {
      id: `session-${turn.id}`,
      sender: turn.role === "user" ? "user" : "natalie",
      text: turn.text,
    };
    if (turn.role === "assistant" && isWidgetActionName(turn.action) && turn.proposal && typeof turn.proposal === "object") {
      message.action = turn.action;
      message.proposal = turn.proposal;
      if (turn.confirmationState === "pending") message.actionStatus = "pending";
      if (turn.confirmationState === "confirmed") message.actionStatus = "created";
      if (turn.confirmationState === "rejected") message.actionStatus = "cancelled";
    }
    return message;
  });
}

export function recoverPendingPrompt(
  currentMessages: WidgetHydrationMessage[],
  pendingConfirmation: PendingConfirmationSnapshot | null,
  pendingAction: PendingActionSnapshot | null
): WidgetHydrationMessage[] {
  const hasPendingUi = currentMessages.some((message) => message.sender === "natalie" && message.actionStatus === "pending");
  if (!hasPendingUi && pendingConfirmation?.uiPrompt) {
    return [
      ...currentMessages,
      {
        id: `session-recovery-confirm-${Date.now()}`,
        sender: "natalie",
        text: pendingConfirmation.uiPrompt,
        action: isWidgetActionName(pendingConfirmation.action) ? pendingConfirmation.action : undefined,
        proposal: pendingConfirmation.proposal,
        actionStatus: "pending",
      },
    ];
  }

  const pendingActionQuestion =
    pendingAction?.action === "calendar_intent_continuation" &&
    pendingAction.proposal &&
    typeof pendingAction.proposal === "object"
      ? (pendingAction.proposal as { intent?: { lastAssistantQuestion?: unknown } }).intent?.lastAssistantQuestion
      : null;

  if (
    typeof pendingActionQuestion === "string" &&
    pendingActionQuestion.trim() &&
    !currentMessages.some(
      (message) => message.sender === "natalie" && message.text.trim() === pendingActionQuestion.trim()
    )
  ) {
    return [
      ...currentMessages,
      {
        id: `session-recovery-action-${Date.now()}`,
        sender: "natalie",
        text: pendingActionQuestion.trim(),
      },
    ];
  }
  return currentMessages;
}
