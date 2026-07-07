import {
  bookAppointmentViaNatalie,
  cancelAppointmentViaNatalie,
  findUpcomingSchedulingForClient,
  findUpcomingSchedulingForOrganization,
  rescheduleAppointmentViaNatalie,
  type NatalieBookResult,
  type NatalieCancelResult,
  type NatalieRescheduleResult,
  type UpcomingSchedulingItem,
} from "../scheduling/schedulingFacade.js";
import { resolveSchedulingCustomerMatches } from "../scheduling/schedulingCustomer.js";
import { SchedulingFacadeError } from "../scheduling/schedulingErrors.js";
import {
  resolveValidatedStartTime,
  validateParsedCommand,
  validateSlotRequest,
} from "./calendarValidationService.js";
import type { ParsedCalendarCommand } from "./calendarCommandTypes.js";

export type SchedulingActor = {
  organizationId: string;
  userId: string;
};

export type CreateAppointmentInput = SchedulingActor & {
  clientName: string;
  clientId?: string;
  dayReference?: string;
  time?: string;
  startTime?: string;
  durationMinutes?: number;
  serviceName?: string;
  notes?: string;
};

export type MoveAppointmentInput = SchedulingActor & {
  schedulingItemId: string;
  newDayReference?: string;
  newTime?: string;
  newStartTime?: string;
};

export type CancelAppointmentInput = SchedulingActor & {
  schedulingItemId: string;
};

export type SearchAppointmentsInput = SchedulingActor & {
  query: string;
  limit?: number;
};

export type ListAppointmentsInput = SchedulingActor & {
  limit?: number;
};

async function resolveSchedulingItemIdForCustomer(params: {
  organizationId: string;
  customerName: string;
}): Promise<string> {
  const matches = await resolveSchedulingCustomerMatches({
    organizationId: params.organizationId,
    name: params.customerName,
  });
  if (matches.length === 0) {
    throw new SchedulingFacadeError("customer_not_found", `לא מצאתי לקוח בשם ${params.customerName}`);
  }
  if (matches.length > 1) {
    throw new SchedulingFacadeError("multiple_clients", `נמצאו כמה לקוחות בשם ${params.customerName}`);
  }

  const upcoming = await findUpcomingSchedulingForClient({
    organizationId: params.organizationId,
    clientId: matches[0].id,
    limit: 1,
  });
  if (upcoming.length === 0) {
    throw new SchedulingFacadeError("appointment_not_found", `לא מצאתי תור קרוב עבור ${params.customerName}`);
  }
  return upcoming[0].id;
}

export async function createAppointment(input: CreateAppointmentInput): Promise<NatalieBookResult> {
  const command: ParsedCalendarCommand = {
    action: "create",
    rawText: "",
    confidence: "high",
    customer: input.clientName,
    dayReference: input.dayReference,
    time: input.time,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
  };
  const validation = await validateParsedCommand(command, input.organizationId);
  if (!validation.valid) {
    throw new SchedulingFacadeError(
      validation.issues[0]?.code ?? "VALIDATION_FAILED",
      validation.issues[0]?.message ?? "Validation failed"
    );
  }

  // bookAppointmentViaNatalie already opens its own org scheduling-lock transaction.
  return bookAppointmentViaNatalie({
    organizationId: input.organizationId,
    userId: input.userId,
    clientName: input.clientName,
    clientId: input.clientId,
    dayReference: input.dayReference,
    time: input.time,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
    serviceName: input.serviceName,
    notes: input.notes,
  });
}

export async function moveAppointment(input: MoveAppointmentInput): Promise<NatalieRescheduleResult> {
  const start = await resolveValidatedStartTime({
    organizationId: input.organizationId,
    dayReference: input.newDayReference,
    time: input.newTime,
    startTime: input.newStartTime,
  });
  if (start) {
    const validation = await validateSlotRequest({
      organizationId: input.organizationId,
      startTime: start,
      excludeAppointmentId: input.schedulingItemId,
      excludeCalendarEventId: input.schedulingItemId,
    });
    if (!validation.valid) {
      throw new SchedulingFacadeError(
        validation.issues[0]?.code ?? "VALIDATION_FAILED",
        validation.issues[0]?.message ?? "Validation failed",
        { slot: validation.slot }
      );
    }
  }

  return rescheduleAppointmentViaNatalie({
    organizationId: input.organizationId,
    userId: input.userId,
    schedulingItemId: input.schedulingItemId,
    newDayReference: input.newDayReference,
    newTime: input.newTime,
    newStartTime: input.newStartTime,
  });
}

export async function cancelAppointment(input: CancelAppointmentInput): Promise<NatalieCancelResult> {
  return cancelAppointmentViaNatalie({
    organizationId: input.organizationId,
    userId: input.userId,
    schedulingItemId: input.schedulingItemId,
  });
}

export async function searchAppointments(
  input: SearchAppointmentsInput
): Promise<Array<UpcomingSchedulingItem & { clientId: string }>> {
  const upcoming = await findUpcomingSchedulingForOrganization({
    organizationId: input.organizationId,
    limit: input.limit ?? 50,
  });
  const query = input.query.trim().toLowerCase();
  if (!query) return upcoming;
  return upcoming.filter((item) => item.clientName.toLowerCase().includes(query));
}

export async function listAppointments(
  input: ListAppointmentsInput
): Promise<Array<UpcomingSchedulingItem & { clientId: string }>> {
  return findUpcomingSchedulingForOrganization({
    organizationId: input.organizationId,
    limit: input.limit ?? 20,
  });
}

export async function resolveSchedulingItemForCommand(params: {
  organizationId: string;
  customerName?: string;
  schedulingItemId?: string;
}): Promise<string> {
  if (params.schedulingItemId) return params.schedulingItemId;
  if (!params.customerName) {
    throw new SchedulingFacadeError("appointment_not_found", "לא צוין לקוח או תור לעדכון");
  }
  return resolveSchedulingItemIdForCustomer({
    organizationId: params.organizationId,
    customerName: params.customerName,
  });
}
