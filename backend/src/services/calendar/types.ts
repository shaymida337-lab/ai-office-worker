export type TimeInterval = {
  start: Date;
  end: Date;
};

export type BusyBlockSource = "appointment" | "calendar_event" | "google_calendar";

export type BusyBlock = TimeInterval & {
  source: BusyBlockSource;
  id: string;
  clientName?: string;
  serviceName?: string;
  durationMinutes?: number;
  googleEventId?: string | null;
};

export type CalendarRules = {
  timeZone: string;
  workingStartHour: number;
  workingEndHour: number;
  defaultDurationMinutes: number;
  slotStepMinutes: number;
  allowBackToBack: boolean;
};

export type AvailabilityReason =
  | "time_conflict"
  | "outside_working_hours"
  | "past"
  | "bad_datetime"
  | "google_unavailable";

export type EngineAvailabilityResult = {
  available: boolean;
  reason?: AvailabilityReason;
  conflict?: BusyBlock;
};

export type SlotCandidate = TimeInterval & {
  durationMinutes: number;
};

export type AvailabilityConflictResponse = {
  appointmentId: string;
  clientName?: string;
  serviceName?: string;
  startTime: string;
  endTime: string;
};

export type CheckSlotAvailabilityResult = {
  available: boolean;
  reason?: AvailabilityReason;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  timeZone: string;
  conflict?: AvailabilityConflictResponse;
  googleReadStatus?: "full" | "partial" | "local_only" | "unavailable";
  googleReadDegraded?: boolean;
  googleReadReason?: string;
  googleReadStatusCode?: number;
  googleReadMessageHe?: string;
};

export type SuggestedSlot = {
  startTime: string;
  endTime: string;
  label: string;
};

export type FindAvailableSlotsResult = {
  timeZone: string;
  durationMinutes: number;
  searchedFrom: string;
  searchedTo: string;
  slots: SuggestedSlot[];
  empty: boolean;
  googleReadStatus?: "full" | "partial" | "local_only" | "unavailable";
  googleReadDegraded?: boolean;
  googleReadReason?: string;
  googleReadStatusCode?: number;
  googleReadMessageHe?: string;
};
