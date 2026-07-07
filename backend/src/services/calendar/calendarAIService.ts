import { checkSlotAvailability } from "./availability.js";
import { parseCalendarCommand } from "./calendarCommandParser.js";
import type { CalendarAIResponse, ParsedCalendarCommand } from "./calendarCommandTypes.js";
import {
  getFreeSlots,
  getNextAvailableSlot,
  getRemainingAvailabilityToday,
} from "./calendarAvailabilityService.js";
import {
  cancelAppointment,
  createAppointment,
  listAppointments,
  moveAppointment,
  resolveSchedulingItemForCommand,
  searchAppointments,
} from "./calendarSchedulingService.js";
import { validateParsedCommand } from "./calendarValidationService.js";
import { SchedulingFacadeError } from "../scheduling/schedulingErrors.js";

export type ProcessCalendarCommandInput = {
  organizationId: string;
  userId: string;
  text: string;
  now?: Date;
};

function formatDayReference(dayReference?: string): string {
  if (!dayReference) return "היום";
  if (dayReference === "היום" || dayReference === "today") return "היום";
  if (dayReference === "מחר" || dayReference === "tomorrow") return "מחר";
  return dayReference;
}

function formatConflictMessage(params: {
  dayReference?: string;
  time?: string;
  alternativeLabel?: string;
}): string {
  const when = [formatDayReference(params.dayReference), params.time].filter(Boolean).join(" בשעה ");
  if (params.alternativeLabel) {
    return `כבר יש לך תור בזמן הזה. הזמן הפנוי הקרוב ביותר הוא ${params.alternativeLabel}. לקבוע אותו?`;
  }
  return `כבר יש לך תור בזמן ${when || "המבוקש"}.`;
}

function formatCreateSuccess(params: { customer?: string; dayReference?: string; time?: string }): string {
  const when = [formatDayReference(params.dayReference), params.time].filter(Boolean).join(" בשעה ");
  const customer = params.customer ? ` עבור ${params.customer}` : "";
  return `מצאתי זמן פנוי ${when}.${customer} התור נוסף ליומן.`;
}

function formatAvailabilitySuccess(params: { available: boolean; dayReference?: string; time?: string }): string {
  const when = [formatDayReference(params.dayReference), params.time].filter(Boolean).join(" בשעה ");
  if (params.available) return `כן — ${when || "הזמן שביקשת"} פנוי.`;
  return formatConflictMessage({ dayReference: params.dayReference, time: params.time });
}

export async function processCalendarCommand(input: ProcessCalendarCommandInput): Promise<CalendarAIResponse> {
  const parsed = parseCalendarCommand(input.text);
  return executeParsedCalendarCommand({
    organizationId: input.organizationId,
    userId: input.userId,
    parsed,
    now: input.now,
  });
}

export async function executeParsedCalendarCommand(params: {
  organizationId: string;
  userId: string;
  parsed: ParsedCalendarCommand;
  now?: Date;
}): Promise<CalendarAIResponse> {
  const { organizationId, userId, parsed } = params;

  try {
    switch (parsed.action) {
      case "create": {
        const validation = await validateParsedCommand(parsed, organizationId, params.now);
        if (!validation.valid) {
          if (validation.issues[0]?.code === "time_conflict" || validation.issues[0]?.code === "SLOT_UNAVAILABLE") {
            const alternative = await getNextAvailableSlot({
              organizationId,
              dayReference: parsed.dayReference,
              durationMinutes: parsed.durationMinutes,
              now: params.now,
            });
            return {
              parsed,
              result: {
                ok: false,
                action: parsed.action,
                code: validation.issues[0]?.code ?? "time_conflict",
                message: validation.issues[0]?.message ?? "Conflict",
                details: alternative ? { alternative } : undefined,
              },
              message: formatConflictMessage({
                dayReference: parsed.dayReference,
                time: parsed.time,
                alternativeLabel: alternative?.label,
              }),
            };
          }
          return {
            parsed,
            result: {
              ok: false,
              action: parsed.action,
              code: validation.issues[0]?.code ?? "VALIDATION_FAILED",
              message: validation.issues[0]?.message ?? "Validation failed",
            },
            message: validation.issues[0]?.message ?? "לא הצלחתי לקבוע את התור.",
          };
        }

        const booked = await createAppointment({
          organizationId,
          userId,
          clientName: parsed.customer ?? "לקוח",
          dayReference: parsed.dayReference,
          time: parsed.time,
          startTime: parsed.startTime,
          durationMinutes: parsed.durationMinutes,
          notes: parsed.notes,
        });
        return {
          parsed,
          result: { ok: true, action: parsed.action, data: { booked } },
          message: formatCreateSuccess(parsed),
        };
      }
      case "move": {
        const schedulingItemId = await resolveSchedulingItemForCommand({
          organizationId,
          customerName: parsed.customer,
          schedulingItemId: parsed.schedulingItemId,
        });
        const moved = await moveAppointment({
          organizationId,
          userId,
          schedulingItemId,
          newDayReference: parsed.dayReference,
          newTime: parsed.time,
          newStartTime: parsed.startTime,
        });
        return {
          parsed,
          result: { ok: true, action: parsed.action, data: { moved } },
          message: `העברתי את התור ל${formatDayReference(parsed.dayReference)}${parsed.time ? ` בשעה ${parsed.time}` : ""}.`,
        };
      }
      case "cancel": {
        const schedulingItemId = await resolveSchedulingItemForCommand({
          organizationId,
          customerName: parsed.customer,
          schedulingItemId: parsed.schedulingItemId,
        });
        const cancelled = await cancelAppointment({ organizationId, userId, schedulingItemId });
        return {
          parsed,
          result: { ok: true, action: parsed.action, data: { cancelled } },
          message: parsed.customer ? `ביטלתי את התור של ${parsed.customer}.` : "ביטלתי את התור.",
        };
      }
      case "search": {
        const items = await searchAppointments({
          organizationId,
          userId,
          query: parsed.searchQuery ?? "",
          limit: parsed.limit,
        });
        return {
          parsed,
          result: { ok: true, action: parsed.action, data: { appointments: items } },
          message:
            items.length > 0
              ? `מצאתי ${items.length} תורים קרובים.`
              : "לא מצאתי תורים תואמים.",
        };
      }
      case "list": {
        const items = await listAppointments({ organizationId, userId, limit: parsed.limit });
        return {
          parsed,
          result: { ok: true, action: parsed.action, data: { appointments: items } },
          message: items.length > 0 ? `יש לך ${items.length} תורים קרובים.` : "אין תורים קרובים ביומן.",
        };
      }
      case "availability_check": {
        const slot = await checkSlotAvailability({
          organizationId,
          dayReference: parsed.dayReference,
          time: parsed.time,
          durationMinutes: parsed.durationMinutes,
          now: params.now,
        });
        if (!slot.available) {
          const alternative = await getNextAvailableSlot({
            organizationId,
            dayReference: parsed.dayReference,
            durationMinutes: parsed.durationMinutes,
            now: params.now,
          });
          return {
            parsed,
            result: {
              ok: false,
              action: parsed.action,
              code: slot.reason ?? "time_conflict",
              message: "Slot unavailable",
              details: alternative ? { alternative } : undefined,
            },
            message: formatConflictMessage({
              dayReference: parsed.dayReference,
              time: parsed.time,
              alternativeLabel: alternative?.label,
            }),
          };
        }
        return {
          parsed,
          result: { ok: true, action: parsed.action, data: { slot } },
          message: formatAvailabilitySuccess({
            available: true,
            dayReference: parsed.dayReference,
            time: parsed.time,
          }),
        };
      }
      case "availability_suggest": {
        const slots =
          parsed.rangeType === "week"
            ? (
                await getFreeSlots({
                  organizationId,
                  rangeType: "week",
                  dayReference: parsed.dayReference,
                  durationMinutes: parsed.durationMinutes,
                  limit: parsed.limit ?? 3,
                  now: params.now,
                })
              ).slots
            : (
                await getRemainingAvailabilityToday({
                  organizationId,
                  dayReference: parsed.dayReference,
                  durationMinutes: parsed.durationMinutes,
                  limit: parsed.limit ?? 3,
                  now: params.now,
                })
              ).slots;
        return {
          parsed,
          result: { ok: true, action: parsed.action, data: { slots } },
          message:
            slots.length > 0
              ? `מצאתי ${slots.length} זמנים פנויים: ${slots.map((s) => s.label).join(", ")}.`
              : "לא מצאתי זמנים פנויים בטווח שביקשת.",
        };
      }
      default:
        return {
          parsed,
          result: {
            ok: false,
            action: "unknown",
            code: "UNKNOWN_COMMAND",
            message: "Could not understand scheduling command",
          },
          message: "לא הבנתי את הבקשה ליומן. אפשר לנסח שוב?",
        };
    }
  } catch (err) {
    const message =
      err instanceof SchedulingFacadeError
        ? err.message
        : err instanceof Error
          ? err.message
          : "אירעה שגיאה בניהול היומן";
    return {
      parsed,
      result: {
        ok: false,
        action: parsed.action,
        code: err instanceof SchedulingFacadeError ? err.code : "CALENDAR_AI_ERROR",
        message,
      },
      message,
    };
  }
}
