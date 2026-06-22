import { prisma } from "../../lib/prisma.js";
import type { CalendarRules } from "./types.js";

export const DEFAULT_TIMEZONE = "Asia/Jerusalem";
export const DEFAULT_WORKING_START_HOUR = 7;
export const DEFAULT_WORKING_END_HOUR = 21;
export const DEFAULT_DURATION_MINUTES = 30;
export const DEFAULT_SLOT_STEP_MINUTES = 30;

export const DEFAULT_CALENDAR_RULES: Omit<CalendarRules, "timeZone"> = {
  workingStartHour: DEFAULT_WORKING_START_HOUR,
  workingEndHour: DEFAULT_WORKING_END_HOUR,
  defaultDurationMinutes: DEFAULT_DURATION_MINUTES,
  slotStepMinutes: DEFAULT_SLOT_STEP_MINUTES,
  allowBackToBack: true,
};

export async function getCalendarRulesForOrganization(organizationId: string): Promise<CalendarRules> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });

  const timeZone = organization?.timezone?.trim() || DEFAULT_TIMEZONE;

  return {
    timeZone,
    ...DEFAULT_CALENDAR_RULES,
  };
}
