import type { NatalieClaudeResponse } from "../claude.js";

export const NATALIE_CHANNELS = ["web_chat", "web_voice", "whatsapp", "email", "api"] as const;
export type NatalieChannel = (typeof NATALIE_CHANNELS)[number];

export const NATALIE_MODALITIES = ["text", "voice"] as const;
export type NatalieModality = (typeof NATALIE_MODALITIES)[number];

export const CONFIRMATION_STATES = ["none", "pending", "confirmed", "rejected"] as const;
export type ConfirmationState = (typeof CONFIRMATION_STATES)[number];

export const CONFIRMATION_TYPES = ["none", "soft", "hard"] as const;
export type ConfirmationType = (typeof CONFIRMATION_TYPES)[number];

export type ConversationActionName = Exclude<
  Extract<NatalieClaudeResponse, { action: string }>["action"],
  never
>;

export type ConversationTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  action?: string | null;
  proposal?: Record<string, unknown> | null;
  confirmationState?: ConfirmationState;
  channel: NatalieChannel;
  at: string;
};

export type PendingConfirmation = {
  action: string;
  proposal: Record<string, unknown>;
  confirmationType: ConfirmationType;
  spokenPrompt: string;
  uiPrompt: string;
  createdAt: string;
};

export type ConversationInterruptionState = {
  interrupted: boolean;
  interruptedAt?: string | null;
  lastSpokenChunk?: string | null;
  resumeHint?: string | null;
};

export type ConversationSessionRecord = {
  id: string;
  organizationId: string;
  userId: string;
  currentChannel: NatalieChannel;
  structuredHistory: ConversationTurn[];
  pendingAction: { action: string; proposal: Record<string, unknown> } | null;
  pendingConfirmation: PendingConfirmation | null;
  interruptionState: ConversationInterruptionState | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
};

export type ProcessNatalieTurnInput = {
  organizationId: string;
  userId: string;
  channel: NatalieChannel;
  modality: NatalieModality;
  message: string;
  sessionId?: string | null;
  legacyHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  role?: string | null;
  permissions?: string[];
};

export type ConfirmationPolicyResult = {
  required: boolean;
  confirmationType: ConfirmationType;
  riskLevel: "read_only" | "reversible" | "financial" | "destructive" | "external";
  spokenPrompt: string;
  uiPrompt: string;
  allowed: boolean;
  denialReason?: string | null;
};

export type ZeroWrongActionResult = {
  ready: boolean;
  violations: string[];
  followUpQuestion?: string | null;
};

export type NatalieTurnReliabilityMetadata = {
  correlationId: string;
  sessionId: string;
  turnId: string;
  health: "Healthy" | "Degraded" | "Failed" | "Unknown";
};

export type ProcessNatalieTurnResult = NatalieClaudeResponse & {
  conversationSessionId: string;
  displayResponse: string;
  spokenResponse: string;
  confirmation: ConfirmationPolicyResult;
  zeroWrongAction: ZeroWrongActionResult;
  reliability: NatalieTurnReliabilityMetadata;
};

export type ConversationMetricsSnapshot = {
  sessionId: string;
  channel: NatalieChannel;
  turnCount: number;
  confirmationRequired: boolean;
  recoveryCount: number;
  interruptionCount: number;
  durationMs: number;
  success: boolean;
};
