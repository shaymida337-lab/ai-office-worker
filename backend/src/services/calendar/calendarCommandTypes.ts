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
};
