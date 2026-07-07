export type CalendarCommandAction =
  | "create"
  | "update"
  | "move"
  | "cancel"
  | "search"
  | "list"
  | "availability_check"
  | "availability_suggest"
  | "unknown";

export type CalendarCommandConfidence = "high" | "medium" | "low";

/** Structured scheduling intent produced from natural language. */
export type ParsedCalendarCommand = {
  action: CalendarCommandAction;
  rawText: string;
  confidence: CalendarCommandConfidence;
  customer?: string;
  dayReference?: string;
  time?: string;
  startTime?: string;
  durationMinutes?: number;
  schedulingItemId?: string;
  searchQuery?: string;
  limit?: number;
  rangeType?: "day" | "week";
  notes?: string;
};

export type CalendarAIExecutionResult =
  | { ok: true; action: CalendarCommandAction; data: Record<string, unknown> }
  | { ok: false; action: CalendarCommandAction; code: string; message: string; details?: Record<string, unknown> };

export type CalendarAIResponse = {
  parsed: ParsedCalendarCommand;
  result: CalendarAIExecutionResult;
  message: string;
  /** True when the assistant is asking the user to confirm before any DB write. */
  requiresConfirmation?: boolean;
  /** Structured, deterministic extraction shown to the user before creation. */
  extraction?: {
    intent: string;
    customerName: string | null;
    date: string | null;
    dayReference: string | null;
    time: string | null;
    fromDayReference?: string | null;
    fromTime?: string | null;
    durationMinutes: number | null;
    serviceName: string | null;
    notes: string | null;
    confidence: "high" | "medium" | "low";
    missingFields: string[];
  };
  sessionId?: string;
};
