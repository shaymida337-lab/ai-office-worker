import type { AppointmentNameResolution } from "./calendarAppointmentResolver.js";

export const FUZZY_AUTO_EXECUTE_THRESHOLD = 0.85;

export type AppointmentResolutionMetadata = {
  source: AppointmentNameResolution["resolutionSource"];
  matchScore: number;
  spokenName: string;
  matchedName: string;
  fuzzyIdentityConfirmationPending: boolean;
  identityConfirmed: boolean;
};

export function requiresFuzzyIdentityGate(resolution: Pick<AppointmentNameResolution, "resolutionSource" | "matchScore">): boolean {
  return resolution.resolutionSource === "fuzzy" && resolution.matchScore < FUZZY_AUTO_EXECUTE_THRESHOLD;
}

export function buildAppointmentResolutionMetadata(
  resolution: AppointmentNameResolution
): AppointmentResolutionMetadata {
  return {
    source: resolution.resolutionSource,
    matchScore: resolution.matchScore,
    spokenName: resolution.spokenName,
    matchedName: resolution.matchedName,
    fuzzyIdentityConfirmationPending: requiresFuzzyIdentityGate(resolution),
    identityConfirmed: false,
  };
}

export function buildFuzzyIdentityConfirmationPrompt(
  clientName: string,
  startTime: Date,
  timeZone: string
): string {
  const dateLabel = new Intl.DateTimeFormat("he-IL", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(startTime);
  const timeLabel = new Intl.DateTimeFormat("he-IL", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(startTime);
  return `התכוונת ל-${clientName} בתאריך ${dateLabel} בשעה ${timeLabel}?`;
}

export function isCalendarProposalExecutable(proposal: Record<string, unknown>): boolean {
  const metadata = proposal.appointmentResolution as AppointmentResolutionMetadata | undefined;
  if (!metadata?.fuzzyIdentityConfirmationPending) return true;
  return metadata.identityConfirmed === true;
}

export function withIdentityConfirmedProposal(proposal: Record<string, unknown>): Record<string, unknown> {
  const metadata = proposal.appointmentResolution as AppointmentResolutionMetadata | undefined;
  if (!metadata?.fuzzyIdentityConfirmationPending) return proposal;
  return {
    ...proposal,
    appointmentResolution: {
      ...metadata,
      identityConfirmed: true,
    },
  };
}

export function readFuzzyIdentityConfirmationPrompt(proposal: Record<string, unknown>): string | null {
  const prompt = proposal.fuzzyIdentityConfirmationPrompt;
  return typeof prompt === "string" && prompt.trim() ? prompt.trim() : null;
}
