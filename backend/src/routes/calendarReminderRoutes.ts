import { Router } from "express";
import { requirePermissionMiddleware } from "../services/rbac/rbacMiddleware.js";
import {
  getAppointmentReminderStatus,
  listAppointmentReminderEvents,
  manualSendAppointmentReminder,
  updateReminderSettingsForOrganization,
} from "../services/reminders/reminderService.js";

export const calendarReminderRouter = Router();
const requireCalendarView = requirePermissionMiddleware("calendar.view");
const requireCalendarUpdate = requirePermissionMiddleware("calendar.update");
const requireOrgSettings = requirePermissionMiddleware("organization.settings");

function singleParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

calendarReminderRouter.get(
  "/calendar/reminders/appointments/:appointmentId/status",
  requireCalendarView,
  async (req, res) => {
    try {
      const payload = await getAppointmentReminderStatus(req.auth!.organizationId, singleParam(req.params.appointmentId));
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load reminder status" });
    }
  }
);

calendarReminderRouter.get(
  "/calendar/reminders/appointments/:appointmentId/events",
  requireCalendarView,
  async (req, res) => {
    try {
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
      const items = await listAppointmentReminderEvents(
        req.auth!.organizationId,
        singleParam(req.params.appointmentId),
        limit
      );
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load reminder events" });
    }
  }
);

calendarReminderRouter.put("/calendar/reminders/settings", requireOrgSettings, async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const result = await updateReminderSettingsForOrganization(req.auth!.organizationId, {
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      timezone: typeof body.timezone === "string" ? body.timezone : undefined,
      language: typeof body.language === "string" ? body.language : undefined,
      reminder24hEnabled: typeof body.reminder24hEnabled === "boolean" ? body.reminder24hEnabled : undefined,
      sameDayEnabled: typeof body.sameDayEnabled === "boolean" ? body.sameDayEnabled : undefined,
      sameDayOffsetMinutes:
        typeof body.sameDayOffsetMinutes === "number" ? body.sameDayOffsetMinutes : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update reminder settings" });
  }
});

calendarReminderRouter.post(
  "/calendar/reminders/appointments/:appointmentId/manual-send",
  requireCalendarUpdate,
  async (req, res) => {
    try {
      const result = await manualSendAppointmentReminder({
        organizationId: req.auth!.organizationId,
        appointmentId: singleParam(req.params.appointmentId),
        userId: req.auth!.userId,
        locale: typeof req.body?.locale === "string" ? req.body.locale : undefined,
      });
      res.status(202).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Manual reminder send failed";
      if (message.includes("not found")) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(400).json({ error: message });
    }
  }
);
