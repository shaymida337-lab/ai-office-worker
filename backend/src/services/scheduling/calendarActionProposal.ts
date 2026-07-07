import type { NatalieClaudeResponse } from "../claude.js";
import type { UpcomingSchedulingItem } from "./schedulingFacade.js";
import {
  buildAppointmentResolutionMetadata,
  buildFuzzyIdentityConfirmationPrompt,
  readFuzzyIdentityConfirmationPrompt,
  requiresFuzzyIdentityGate,
  type AppointmentResolutionMetadata,
} from "./calendarAppointmentSafety.js";
import type { AppointmentNameResolution } from "./calendarAppointmentResolver.js";
import { calendarMessages } from "../calendar/calendarMessages.js";

export function formatAmbiguousAppointmentMessage(
  spokenName: string,
  candidates: Array<{ appointment: { clientName: string }; matchScore: number }>
): string {
  const list = candidates
    .map((candidate, index) => `${index + 1}. ${candidate.appointment.clientName}`)
    .join("\n");
  return calendarMessages.ambiguousAppointment(spokenName, list);
}

export function buildCalendarActionProposal(input: {
  action: "cancel_appointment" | "reschedule_appointment";
  appointment: UpcomingSchedulingItem;
  nameResolution: AppointmentNameResolution;
  timeZone: string;
  when: string;
  reschedule?: {
    newDayReference: string;
    newTime: string;
    newWhen: string;
  };
  defaultAnswer: string;
}): NatalieClaudeResponse {
  const appointmentResolution = buildAppointmentResolutionMetadata(input.nameResolution);
  const fuzzyPrompt = requiresFuzzyIdentityGate(input.nameResolution)
    ? buildFuzzyIdentityConfirmationPrompt(
        input.nameResolution.clientName,
        input.appointment.startTime,
        input.timeZone
      )
    : null;

  const proposal: Record<string, unknown> = {
    appointmentId: input.appointment.id,
    clientId: input.nameResolution.clientId,
    clientName: input.nameResolution.clientName,
    appointmentResolution,
    ...(fuzzyPrompt ? { fuzzyIdentityConfirmationPrompt: fuzzyPrompt } : {}),
    ...(input.action === "cancel_appointment"
      ? { when: input.when, ...(input.appointment.serviceName ? { serviceName: input.appointment.serviceName } : {}) }
      : {
          newDayReference: input.reschedule!.newDayReference,
          newTime: input.reschedule!.newTime,
          newWhen: input.reschedule!.newWhen,
        }),
  };

  return {
    action: input.action,
    proposal,
    answer: fuzzyPrompt ?? input.defaultAnswer,
  } as NatalieClaudeResponse;
}

export function shouldDeferCalendarActionForFuzzyGate(proposal: Record<string, unknown> | null): boolean {
  if (!proposal) return false;
  const metadata = proposal.appointmentResolution as AppointmentResolutionMetadata | undefined;
  return Boolean(metadata?.fuzzyIdentityConfirmationPending && !metadata.identityConfirmed);
}

export function resolveCalendarConfirmationPrompt(proposal: Record<string, unknown>): string | null {
  return readFuzzyIdentityConfirmationPrompt(proposal);
}
