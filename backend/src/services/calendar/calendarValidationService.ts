import { prisma } from "../../lib/prisma.js";
import { appointmentEnd } from "./engine.js";
import { resolveSlotTime } from "./datetime.js";
import { getCalendarRulesForOrganization } from "./rules.js";
import { checkSlotAvailability } from "./availability.js";
import { validateEvent } from "./calendarEngineValidation.js";
import type { CalendarEngineEventInput } from "./calendarEngineTypes.js";
import type { ParsedCalendarCommand } from "./calendarCommandTypes.js";
import type { CheckSlotAvailabilityResult } from "./types.js";

export type SchedulingValidationIssue = {
  code: string;
  message: string;
  field?: string;
};

export type SchedulingValidationResult = {
  valid: boolean;
  issues: SchedulingValidationIssue[];
};

function fail(code: string, message: string, field?: string): SchedulingValidationResult {
  return { valid: false, issues: [{ code, message, field }] };
}

function ok(): SchedulingValidationResult {
  return { valid: true, issues: [] };
}

export async function assertOrganizationExists(organizationId: string): Promise<SchedulingValidationResult> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!org) return fail("ORG_NOT_FOUND", "Organization not found");
  return ok();
}

export async function assertClientBelongsToOrganization(
  organizationId: string,
  clientId: string
): Promise<SchedulingValidationResult> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId },
    select: { id: true },
  });
  if (!client) return fail("CLIENT_NOT_IN_ORG", "Client does not belong to organization", "clientId");
  return ok();
}

export async function validateSlotRequest(params: {
  organizationId: string;
  dayReference?: string;
  time?: string;
  startTime?: Date;
  durationMinutes?: number;
  excludeAppointmentId?: string;
  excludeCalendarEventId?: string;
  now?: Date;
}): Promise<SchedulingValidationResult & { slot?: CheckSlotAvailabilityResult }> {
  const orgCheck = await assertOrganizationExists(params.organizationId);
  if (!orgCheck.valid) return orgCheck;

  const slot = await checkSlotAvailability({
    organizationId: params.organizationId,
    dayReference: params.dayReference,
    time: params.time,
    startTime: params.startTime,
    durationMinutes: params.durationMinutes,
    excludeAppointmentId: params.excludeAppointmentId,
    excludeCalendarEventId: params.excludeCalendarEventId,
    now: params.now,
  });

  if (!slot.available) {
    return {
      valid: false,
      issues: [
        {
          code: slot.reason ?? "SLOT_UNAVAILABLE",
          message:
            slot.reason === "time_conflict"
              ? "Time slot conflicts with an existing appointment"
              : slot.reason === "outside_working_hours"
                ? "Time is outside working hours"
                : slot.reason === "past"
                  ? "Time must be in the future"
                  : "Requested time is not available",
          field: "startTime",
        },
      ],
      slot,
    };
  }

  return { ...ok(), slot };
}

export async function validateEngineEventInput(params: {
  organizationId: string;
  input: CalendarEngineEventInput;
  excludeCalendarEventId?: string;
  now?: Date;
}): Promise<SchedulingValidationResult> {
  const orgCheck = await assertOrganizationExists(params.organizationId);
  if (!orgCheck.valid) return orgCheck;

  const result = await validateEvent({
    organizationId: params.organizationId,
    input: params.input,
    excludeCalendarEventId: params.excludeCalendarEventId,
    now: params.now,
  });

  if (result.valid) return ok();
  return {
    valid: false,
    issues: result.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      field: issue.field,
    })),
  };
}

export async function validateParsedCommand(
  command: ParsedCalendarCommand,
  organizationId: string,
  now = new Date()
): Promise<SchedulingValidationResult> {
  const orgCheck = await assertOrganizationExists(organizationId);
  if (!orgCheck.valid) return orgCheck;

  switch (command.action) {
    case "create":
    case "move":
      if (!command.customer && command.action === "create") {
        return fail("MISSING_CUSTOMER", "Customer name is required", "customer");
      }
      if (!command.dayReference && !command.time && !command.startTime) {
        return fail("MISSING_DATETIME", "Date or time is required", "dayReference");
      }
      return validateSlotRequest({
        organizationId,
        dayReference: command.dayReference,
        time: command.time,
        startTime: command.startTime ? new Date(command.startTime) : undefined,
        durationMinutes: command.durationMinutes,
        now,
      });
    case "cancel":
    case "search":
    case "list":
    case "availability_check":
    case "availability_suggest":
      return ok();
    default:
      return fail("UNKNOWN_COMMAND", "Could not understand scheduling command");
  }
}

export async function resolveValidatedStartTime(params: {
  organizationId: string;
  dayReference?: string;
  time?: string;
  startTime?: string;
  now?: Date;
}): Promise<Date | null> {
  if (params.startTime) {
    const parsed = new Date(params.startTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const rules = await getCalendarRulesForOrganization(params.organizationId);
  return resolveSlotTime({
    dayReference: params.dayReference,
    time: params.time,
    timeZone: rules.timeZone,
    now: params.now,
  });
}

export function buildEngineInputFromSlot(params: {
  startTime: Date;
  durationMinutes: number;
  clientId?: string;
  serviceId?: string | null;
  assignedUserId?: string | null;
}): CalendarEngineEventInput {
  return {
    startAt: params.startTime,
    endAt: appointmentEnd(params.startTime, params.durationMinutes),
    clientId: params.clientId,
    serviceId: params.serviceId ?? null,
    assignedUserId: params.assignedUserId ?? null,
    source: "ai_chat",
  };
}
