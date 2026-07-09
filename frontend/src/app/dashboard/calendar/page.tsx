"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarEventDrawer } from "@/components/calendar/CalendarEventDrawer";
import { CalendarToolbar } from "@/components/calendar/CalendarToolbar";
import { DayTimelineView } from "@/components/calendar/DayTimelineView";
import { MonthCalendarView } from "@/components/calendar/MonthCalendarView";
import { NatalieCalendarActionCenter } from "@/components/calendar/NatalieCalendarActionCenter";
import { NatalieCalendarDailyBrief } from "@/components/calendar/NatalieCalendarDailyBrief";
import { OwnerDecisionQueuePanel } from "@/components/calendar/OwnerDecisionQueuePanel";
import { WeekCalendarEmptyState, WeekCalendarView } from "@/components/calendar/WeekCalendarView";
import {
  AppShell,
  BottomNavigation,
  Button,
  Card,
  CardHeader,
  FloatingActionButton,
  Header,
  MessageBanner,
  StatusBadge,
} from "@/components/natalie-ui";
import { apiFetch, ApiError, getToken } from "@/lib/api";
import { useOrganizationTimezone } from "@/hooks/useOrganizationTimezone";
import { useI18n } from "@/i18n";
import { dateInputValueInTimeZone, timeInputValueInTimeZone } from "@/lib/orgTimezone";
import {
  buildEndAtIso,
  calendarEventsToDisplayItems,
  type CalendarDisplayItem,
  isEngineDisplayItem,
} from "@/lib/calendarEngine/adapters";
import {
  CalendarEngineUnavailableError,
  createCalendarEventDraft,
  fetchCalendarEvents,
  resolveCalendarCreateStrategy,
  resolveCalendarLoadStrategy,
  submitCalendarEventForConfirmation,
  submitConfirmationUserMessage,
} from "@/lib/calendarEngine/api";
import {
  CALENDAR_ENGINE_DISABLED_MESSAGE,
  calendarEventStatusLabel,
  calendarEventStatusTone,
} from "@/lib/calendarEngine";
import {
  effectiveCalendarEngineRead,
  effectiveCalendarEngineWrite,
  fetchSchedulingCapabilities,
  type SchedulingCapabilities,
} from "@/lib/scheduling/capabilities";
import { getDayBounds, getMonthBounds, startOfMonth, addMonths, formatMonthTitle, type CalendarViewMode } from "@/lib/calendarUtils";
import { buildCalendarDailyBrief, type CalendarDailyBrief } from "@/lib/calendar/calendarBrief";
import { openNatalieAssistant } from "@/lib/calendar/openNatalieAssistant";
import { fetchBriefingSchedulingSnapshot, type BriefingSchedulingSnapshot } from "@/lib/scheduling/briefing";
import { firstNameFromLabel } from "@/lib/dashboard/homePageHelpers";
import { Clock, Plus, Trash2, X } from "lucide-react";

type Service = {
  id: string;
  name: string;
  durationMinutes: number;
  price?: number | null;
  color?: string | null;
  isActive: boolean;
};

type ApptClient = {
  id: string;
  name: string;
  whatsappNumber?: string | null;
  color?: string | null;
};

type Appointment = {
  id: string;
  clientId: string;
  serviceId?: string | null;
  startTime: string;
  durationMinutes: number;
  status: string;
  notes?: string | null;
  client: ApptClient;
  service?: { id: string; name: string; color?: string | null; durationMinutes: number } | null;
  googleSyncStatus?: "pending" | "synced" | "failed" | "retrying" | "disabled";
  lastGoogleSyncError?: string | null;
  reminderStatus?: {
    attendanceState: string;
    reminderState: string;
    confirmationStatus: string;
    lastReminderSentAt: string | null;
    lastResponseAt: string | null;
    nextReminderAt: string | null;
  } | null;
};

function appointmentToDisplayItem(appt: Appointment): CalendarDisplayItem {
  return { ...appt, source: "appointment" };
}

type ClientsResponse = {
  clients: ApptClient[];
};

const APPOINTMENT_STATUS_OPTIONS = ["pending", "confirmed", "completed", "cancelled", "no_show"] as const;
const DEFAULT_COLOR = "#3B82F6";

type Task = { id: string; status: string };
type OrganizationSettings = { name?: string | null };

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

const emptyServiceForm = {
  name: "",
  durationMinutes: 30,
  price: "",
  color: DEFAULT_COLOR,
};

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildStartTimeIso(date: string, time: string): string {
  // מחרוזת נאיבית (בלי Z/offset) — ה-backend מפרש אותה ב-timezone של הארגון,
  // לא בשעון הדפדפן ולא בשעון השרת (H3).
  return `${date}T${time}`;
}

function appointmentStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "ממתין",
    confirmed: "מאושר",
    completed: "הושלם",
    cancelled: "בוטל",
    no_show: "לא הגיע",
  };
  return labels[status] ?? status;
}

function appointmentStatusTone(status: string): "success" | "warn" | "danger" | "info" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "confirmed":
      return "info";
    case "pending":
      return "warn";
    case "cancelled":
      return "danger";
    case "no_show":
      return "neutral";
    default:
      return "neutral";
  }
}

function reminderChipLabel(state: string): string {
  const labels: Record<string, string> = {
    reminder_pending: "Pending",
    reminder_sent: "Reminder Sent",
    confirmed: "Confirmed",
    declined: "Declined",
    no_response: "No Response",
    reminder_failed: "Reminder Failed",
  };
  return labels[state] ?? state;
}

function reminderChipTone(state: string): "success" | "warn" | "danger" | "info" | "neutral" {
  if (state === "confirmed") return "success";
  if (state === "declined" || state === "reminder_failed") return "danger";
  if (state === "reminder_sent") return "info";
  if (state === "no_response" || state === "reminder_pending") return "warn";
  return "neutral";
}

function isErrorMessage(text: string) {
  return text.includes("נכשל") || text.includes("חובה") || text.includes("יש לבחור");
}

function messageBannerTone(text: string): "error" | "success" {
  return isErrorMessage(text) ? "error" : "success";
}

function CollapsePanel({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

export default function CalendarPage() {
  const { t, dir } = useI18n();
  const [highlightDecisionId, setHighlightDecisionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("week");
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [appointments, setAppointments] = useState<CalendarDisplayItem[]>([]);
  const [briefingSnapshot, setBriefingSnapshot] = useState<BriefingSchedulingSnapshot | null>(null);
  const [dailyBrief, setDailyBrief] = useState<CalendarDailyBrief | null>(null);
  const [openTasksCount, setOpenTasksCount] = useState(0);
  const [ownerFirstName, setOwnerFirstName] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [briefLoading, setBriefLoading] = useState(true);
  const [selectedEngineEventId, setSelectedEngineEventId] = useState<string | null>(null);
  const [queueRefreshKey, setQueueRefreshKey] = useState(0);
  const [drawerRefreshKey, setDrawerRefreshKey] = useState(0);
  const [engineDisabledBanner, setEngineDisabledBanner] = useState<string | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [clients, setClients] = useState<ApptClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [formClientId, setFormClientId] = useState("");
  const [formServiceId, setFormServiceId] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formTime, setFormTime] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formStatus, setFormStatus] = useState("pending");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [showServiceForm, setShowServiceForm] = useState(false);
  const [serviceForm, setServiceForm] = useState(emptyServiceForm);
  const [savingService, setSavingService] = useState(false);
  const [deletingServiceId, setDeletingServiceId] = useState<string | null>(null);
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null);
  const [connectingCalendar, setConnectingCalendar] = useState(false);
  const [schedulingCapabilities, setSchedulingCapabilities] = useState<SchedulingCapabilities | null>(null);
  const [selectedReminderStatus, setSelectedReminderStatus] = useState<Appointment["reminderStatus"] | null>(null);
  const [selectedReminderEvents, setSelectedReminderEvents] = useState<
    Array<{ id: string; eventType: string; occurredAtUtc: string }>
  >([]);

  const engineReadEnabled = effectiveCalendarEngineRead(schedulingCapabilities);
  const engineWriteEnabled = effectiveCalendarEngineWrite(schedulingCapabilities);
  const orgTimezone = useOrganizationTimezone();

  const activeServices = useMemo(() => services.filter((s) => s.isActive), [services]);

  const selectedServiceDuration = useMemo(() => {
    if (!formServiceId) return null;
    const svc = services.find((s) => s.id === formServiceId);
    return svc?.durationMinutes ?? null;
  }, [formServiceId, services]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const weekLabel = useMemo(() => {
    const weekEnd = addDays(weekStart, 6);
    const locale = dir === "rtl" ? "he-IL" : "en-US";
    const from = weekStart.toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: orgTimezone });
    const to = weekEnd.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: orgTimezone });
    return `${from} – ${to}`;
  }, [weekStart, orgTimezone]);

  const calendarTitle = useMemo(() => {
    if (viewMode === "day") {
      const locale = dir === "rtl" ? "he-IL" : "en-US";
      return selectedDay.toLocaleDateString(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: orgTimezone,
      });
    }
    if (viewMode === "month") {
      return formatMonthTitle(monthAnchor, orgTimezone);
    }
    return weekLabel;
  }, [viewMode, selectedDay, monthAnchor, weekLabel, orgTimezone, dir]);

  const monthPickerValue = useMemo(() => {
    const y = monthAnchor.getFullYear();
    const m = String(monthAnchor.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }, [monthAnchor]);

  const hasWeekAppointments = useMemo(() => {
    if (viewMode !== "week") return true;
    return appointments.some((appt) => {
      const key = toDateInputValue(new Date(appt.startTime));
      return weekDays.some((day) => toDateInputValue(day) === key);
    });
  }, [appointments, viewMode, weekDays]);

  const statusLabelFn = engineReadEnabled ? calendarEventStatusLabel : appointmentStatusLabel;
  const statusToneFn = engineReadEnabled ? calendarEventStatusTone : appointmentStatusTone;

  async function loadCalendarStatus() {
    try {
      const status = await apiFetch<{ connected: boolean; calendarId?: string }>(
        `/api/integrations/calendar/status?t=${Date.now()}`
      );
      setCalendarConnected(status.connected);
    } catch {
      setCalendarConnected(false);
    }
  }

  async function connectCalendar() {
    const token = getToken();
    if (!token) {
      setMessage("צריך להתחבר");
      return;
    }
    setConnectingCalendar(true);
    try {
      const returnTo = encodeURIComponent("/dashboard/calendar");
      const data = await apiFetch<{ url: string }>(`/api/integrations/calendar/connect-url?returnTo=${returnTo}`);
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setMessage("שרת לא החזיר כתובת חיבור ל-Google Calendar");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "חיבור Google Calendar נכשל");
    } finally {
      setConnectingCalendar(false);
    }
  }

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    setEngineDisabledBanner(null);
    try {
      const range =
        viewMode === "day"
          ? getDayBounds(selectedDay)
          : viewMode === "month"
            ? getMonthBounds(monthAnchor)
            : { from: weekStart, to: addDays(weekStart, 7) };
      const from = range.from.toISOString();
      const to = range.to.toISOString();
      const loadStrategy = resolveCalendarLoadStrategy(engineReadEnabled);

      const [svcData, clientData] = await Promise.all([
        apiFetch<Service[]>("/api/services"),
        apiFetch<ClientsResponse>("/api/clients"),
      ]);
      setServices(svcData);
      setClients(clientData.clients);

      if (loadStrategy === "calendar_engine") {
        try {
          const events = await fetchCalendarEvents(from, to);
          setAppointments(calendarEventsToDisplayItems(events));
        } catch (err) {
          if (err instanceof CalendarEngineUnavailableError) {
            setEngineDisabledBanner(CALENDAR_ENGINE_DISABLED_MESSAGE);
            const apptData = await apiFetch<Appointment[]>(
              `/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
            );
            setAppointments(apptData.map(appointmentToDisplayItem));
            return;
          }
          throw err;
        }
      } else {
        const apptData = await apiFetch<Appointment[]>(
          `/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        );
        setAppointments(apptData.map(appointmentToDisplayItem));
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "טעינת היומן נכשלה");
    } finally {
      setLoading(false);
    }
  }, [viewMode, selectedDay, weekStart, monthAnchor, engineReadEnabled]);

  const loadBriefData = useCallback(async () => {
    setBriefLoading(true);
    try {
      const todayBounds = getDayBounds(new Date());
      const from = todayBounds.from.toISOString();
      const to = addDays(todayBounds.from, 1).toISOString();
      const [briefing, tasks, orgSettings] = await Promise.all([
        fetchBriefingSchedulingSnapshot(from, to).catch(() => null),
        apiFetch<Task[]>("/api/tasks").catch(() => [] as Task[]),
        apiFetch<OrganizationSettings>("/api/organization/settings").catch(() => ({ name: null })),
      ]);
      setBriefingSnapshot(briefing);
      setOpenTasksCount(tasks.filter((task) => task.status !== "done" && task.status !== "completed").length);
      setOwnerFirstName(firstNameFromLabel(orgSettings.name));
      setBusinessName(orgSettings.name?.trim() || "");
    } catch {
      setBriefingSnapshot(null);
    } finally {
      setBriefLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSchedulingCapabilities()
      .then(setSchedulingCapabilities)
      .catch(() => setSchedulingCapabilities(null));
  }, []);

  useEffect(() => {
    loadAppointments().catch((err) => setMessage(err instanceof Error ? err.message : "טעינת היומן נכשלה"));
  }, [loadAppointments]);

  useEffect(() => {
    loadBriefData().catch(() => undefined);
  }, [loadBriefData]);

  useEffect(() => {
    setDailyBrief(
      buildCalendarDailyBrief({
        ownerFirstName,
        timeZone: orgTimezone,
        todayAppointments: appointments,
        briefing: briefingSnapshot,
        openTaskCount: openTasksCount,
      })
    );
  }, [appointments, briefingSnapshot, openTasksCount, ownerFirstName, orgTimezone]);

  useEffect(() => {
    const onAppointmentsChanged = () => {
      loadAppointments().catch((err) => setMessage(err instanceof Error ? err.message : "טעינת היומן נכשלה"));
    };
    window.addEventListener("appointments-changed", onAppointmentsChanged);
    return () => window.removeEventListener("appointments-changed", onAppointmentsChanged);
  }, [loadAppointments]);

  useEffect(() => {
    loadCalendarStatus();
  }, []);

  useEffect(() => {
    if (!window.location.search.includes("calendar=connected")) return;
    setMessage("היומן חובר בהצלחה ל-Google Calendar");
    loadCalendarStatus();
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setHighlightDecisionId(params.get("decisionId"));
  }, []);

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setFormClientId("");
    setFormServiceId("");
    setFormDate("");
    setFormTime("");
    setFormNotes("");
    setFormStatus("pending");
    setSelectedReminderStatus(null);
    setSelectedReminderEvents([]);
  }

  function openNewForm() {
    setEditingId(null);
    setFormClientId("");
    setFormServiceId("");
    setFormDate(dateInputValueInTimeZone(new Date(), orgTimezone));
    setFormTime("");
    setFormNotes("");
    setFormStatus("pending");
    setSelectedReminderStatus(null);
    setSelectedReminderEvents([]);
    setShowForm(true);
  }

  function openEditForm(appt: CalendarDisplayItem) {
    if (isEngineDisplayItem(appt)) {
      setSelectedEngineEventId(appt.engineEventId ?? appt.id);
      return;
    }
    const start = new Date(appt.startTime);
    setEditingId(appt.id);
    setFormClientId(appt.clientId);
    setFormServiceId(appt.serviceId ?? "");
    // prefill ב-timezone הארגון — כמו שהשמירה כותבת (round-trip שלם)
    setFormDate(dateInputValueInTimeZone(start, orgTimezone));
    setFormTime(timeInputValueInTimeZone(start, orgTimezone));
    setFormNotes(appt.notes ?? "");
    setFormStatus(appt.status);
    const appointment = appt as Appointment;
    setSelectedReminderStatus(appointment.reminderStatus ?? null);
    void apiFetch<{ items: Array<{ id: string; eventType: string; occurredAtUtc: string }> }>(
      `/api/calendar/reminders/appointments/${appt.id}/events?limit=8`
    )
      .then((data) => setSelectedReminderEvents(data.items))
      .catch(() => setSelectedReminderEvents([]));
    setShowForm(true);
  }

  function refreshEngineSurfaces() {
    setQueueRefreshKey((k) => k + 1);
    setDrawerRefreshKey((k) => k + 1);
  }

  function handleDecisionResolved() {
    refreshEngineSurfaces();
    loadAppointments().catch((err) =>
      setMessage(err instanceof Error ? err.message : "טעינת היומן נכשלה")
    );
  }

  function isTimeConflictError(err: unknown): boolean {
    return err instanceof ApiError && err.status === 409;
  }

  async function saveAppointment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!formClientId || !formDate || !formTime) {
      setMessage("יש לבחור לקוח, תאריך ושעה");
      return;
    }
    setSaving(true);
    try {
      const startTime = buildStartTimeIso(formDate, formTime);
      if (editingId) {
        await apiFetch(`/api/appointments/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify({
            startTime,
            serviceId: formServiceId || null,
            notes: formNotes.trim() || null,
            status: formStatus,
          }),
        });
        setMessage("התור עודכן בהצלחה");
      } else if (resolveCalendarCreateStrategy(engineWriteEnabled) === "calendar_engine_draft") {
        const duration = selectedServiceDuration ?? 30;
        const endAt = buildEndAtIso(startTime, duration);
        const client = clients.find((c) => c.id === formClientId);
        const draft = await createCalendarEventDraft({
          startAt: startTime,
          endAt,
          clientId: formClientId,
          serviceId: formServiceId || null,
          title: client?.name ?? null,
        });
        const result = await submitCalendarEventForConfirmation(draft.id);
        setMessage(submitConfirmationUserMessage(result));
        refreshEngineSurfaces();
      } else {
        await apiFetch("/api/appointments", {
          method: "POST",
          body: JSON.stringify({
            clientId: formClientId,
            serviceId: formServiceId || null,
            startTime,
            notes: formNotes.trim() || null,
          }),
        });
        setMessage("התור נוסף בהצלחה");
      }
      resetForm();
      await loadAppointments();
    } catch (err) {
      if (isTimeConflictError(err)) {
        setMessage("קיים תור אחר בזמן הזה");
        return;
      }
      if (err instanceof CalendarEngineUnavailableError) {
        setMessage(CALENDAR_ENGINE_DISABLED_MESSAGE);
        return;
      }
      setMessage(err instanceof Error ? err.message : "שמירת התור נכשלה");
    } finally {
      setSaving(false);
    }
  }

  async function cancelAppointment() {
    if (!editingId) return;
    setMessage("");
    setSaving(true);
    try {
      await apiFetch(`/api/appointments/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled" }),
      });
      setMessage("התור בוטל");
      resetForm();
      await loadAppointments();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "ביטול התור נכשל");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAppointment() {
    if (!editingId) return;
    if (!window.confirm("למחוק את התור לצמיתות? לא ניתן לשחזר.")) return;
    setMessage("");
    setSaving(true);
    try {
      await apiFetch(`/api/appointments/${editingId}`, { method: "DELETE" });
      setMessage("התור נמחק");
      resetForm();
      await loadAppointments();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "מחיקת התור נכשלה");
    } finally {
      setSaving(false);
    }
  }

  async function createService(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!serviceForm.name.trim()) {
      setMessage("שם השירות הוא שדה חובה");
      return;
    }
    setSavingService(true);
    try {
      const body: { name: string; durationMinutes: number; color: string; price?: number } = {
        name: serviceForm.name.trim(),
        durationMinutes: serviceForm.durationMinutes,
        color: serviceForm.color,
      };
      if (serviceForm.price.trim()) {
        body.price = Number(serviceForm.price);
      }
      await apiFetch("/api/services", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setServiceForm(emptyServiceForm);
      setShowServiceForm(false);
      setMessage("השירות נוסף בהצלחה");
      const svcData = await apiFetch<Service[]>("/api/services");
      setServices(svcData);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שמירת השירות נכשלה");
    } finally {
      setSavingService(false);
    }
  }

  async function deleteService(id: string) {
    setMessage("");
    setDeletingServiceId(id);
    try {
      await apiFetch(`/api/services/${id}`, { method: "DELETE" });
      setMessage("השירות הוסר");
      const svcData = await apiFetch<Service[]>("/api/services");
      setServices(svcData);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "מחיקת השירות נכשלה");
    } finally {
      setDeletingServiceId(null);
    }
  }

  async function quickConfirmAppointment(appt: CalendarDisplayItem) {
    if (isEngineDisplayItem(appt)) {
      setSelectedEngineEventId(appt.engineEventId ?? appt.id);
      return;
    }
    setMessage("");
    try {
      await apiFetch(`/api/appointments/${appt.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "confirmed" }),
      });
      setMessage("התור אושר");
      await loadAppointments();
      await loadBriefData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "אישור התור נכשל");
    }
  }

  function handleCalendarPrev() {
    if (viewMode === "day") {
      setSelectedDay((day) => startOfDay(addDays(day, -1)));
      return;
    }
    if (viewMode === "month") {
      setMonthAnchor((month) => addMonths(month, -1));
      return;
    }
    setWeekStart((week) => addDays(week, -7));
  }

  function handleCalendarNext() {
    if (viewMode === "day") {
      setSelectedDay((day) => startOfDay(addDays(day, 1)));
      return;
    }
    if (viewMode === "month") {
      setMonthAnchor((month) => addMonths(month, 1));
      return;
    }
    setWeekStart((week) => addDays(week, 7));
  }

  function handleCalendarToday() {
    const today = startOfDay(new Date());
    setSelectedDay(today);
    setWeekStart(getWeekStart(today));
    setMonthAnchor(startOfMonth(today));
  }

  function handleMonthPickerChange(value: string) {
    const [year, month] = value.split("-").map(Number);
    if (!year || !month) return;
    setMonthAnchor(new Date(year, month - 1, 1));
  }

  function handleMonthDayClick(day: Date) {
    setSelectedDay(startOfDay(day));
    setViewMode("day");
  }

  const bottomItems = useMemo(
    () => [
      { id: "home", label: t("dashboardDesign.nav.home"), href: "/dashboard" },
      { id: "invoices", label: t("dashboardDesign.nav.invoices"), href: "/dashboard/invoices" },
      { id: "payments", label: t("dashboardDesign.nav.payments"), href: "/payments" },
      { id: "calendar", label: t("dashboardDesign.nav.calendar"), href: "/dashboard/calendar" },
    ],
    [t]
  );

  return (
    <div dir={dir} data-testid="calendar-page">
      <AppShell
        header={
          <Header
            title={businessName || t("calendarDesign.title")}
            subtitle={t("calendarDesign.subtitle")}
            onRefresh={() => window.location.reload()}
            refreshLabel={t("calendarDesign.refresh")}
          />
        }
        bottomNavigation={<BottomNavigation items={bottomItems} />}
        floatingButton={
          <FloatingActionButton
            label={t("calendarDesign.floatingNatalie")}
            onClick={() => openNatalieAssistant()}
            className="xl:hidden"
          />
        }
      >
        <div className="space-y-5">
        <NatalieCalendarDailyBrief
          brief={dailyBrief}
          loading={briefLoading || loading}
          onAskNatalie={() => openNatalieAssistant()}
        />

        {message ? (
          <MessageBanner tone={messageBannerTone(message)} className="animate-[toastSlide_.25s_ease]">
            {message}
          </MessageBanner>
        ) : null}

        {engineDisabledBanner ? (
          <MessageBanner tone="warn" data-testid="engine-disabled-banner">
            {engineDisabledBanner}
          </MessageBanner>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            {engineReadEnabled && (
              <OwnerDecisionQueuePanel
                refreshKey={queueRefreshKey}
                highlightDecisionId={highlightDecisionId}
                onDecisionResolved={handleDecisionResolved}
                onSelectEvent={(eventId) => setSelectedEngineEventId(eventId)}
              />
            )}

            <CalendarEventDrawer
              eventId={selectedEngineEventId}
              refreshKey={drawerRefreshKey}
              onClose={() => setSelectedEngineEventId(null)}
              onMutation={handleDecisionResolved}
            />

            <Card data-testid="calendar-appointments-card">
              <CardHeader
                subtitle={t("calendar.businessCalendar")}
                title={t("calendar.appointmentsCenter")}
                actions={
                  <>
                    {calendarConnected === true && <StatusBadge tone="success">Google Calendar ✓</StatusBadge>}
                    {calendarConnected === false && (
                      <Button variant="secondary" disabled={connectingCalendar} onClick={() => connectCalendar()}>
                        {connectingCalendar ? t("calendar.connecting") : t("calendar.connectGoogleCalendar")}
                      </Button>
                    )}
                    <Button variant="primary" onClick={openNewForm}>
                      <Plus className="h-4 w-4" />
                      {t("calendar.newAppointment")}
                    </Button>
                  </>
                }
              />

              <CollapsePanel open={showForm}>
                <form onSubmit={saveAppointment} className="mb-5 grid gap-3 rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] p-4 md:grid-cols-2">
          <div className="flex items-center justify-between md:col-span-2">
            <h2 className="text-lg font-black text-[#111827]">{editingId ? t("calendar.editAppointment") : t("calendar.newAppointment")}</h2>
            <Button variant="secondary" size="sm" type="button" onClick={resetForm}>
              <X className="h-4 w-4" />
              {t("calendar.cancel")}
            </Button>
          </div>
          <label className="font-semibold text-[#111827]">
            {t("calendar.customer")}
            <select
              required
              className="mt-1 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]"
              value={formClientId}
              disabled={Boolean(editingId)}
              onChange={(e) => setFormClientId(e.target.value)}
            >
              <option value="">{t("calendar.selectCustomer")}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="font-semibold text-[#111827]">
            {t("calendar.service")}
            <select
              className="mt-1 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]"
              value={formServiceId}
              onChange={(e) => setFormServiceId(e.target.value)}
            >
              <option value="">{t("calendar.noService")}</option>
              {activeServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.durationMinutes} דק׳)
                </option>
              ))}
            </select>
          </label>
          {selectedServiceDuration !== null && !editingId && (
            <p className="flex items-center gap-2 text-sm font-semibold text-[#6B7280] md:col-span-2">
              <Clock className="h-4 w-4" />
              {t("calendar.estimatedDuration", { minutes: selectedServiceDuration })}
            </p>
          )}
          <label className="font-semibold text-[#111827]">
            {t("calendar.date")}
            <input
              required
              type="date"
              className="mt-1 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
            />
          </label>
          <label className="font-semibold text-[#111827]">
            {t("calendar.time")}
            <input
              required
              type="time"
              className="mt-1 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]"
              value={formTime}
              onChange={(e) => setFormTime(e.target.value)}
            />
          </label>
          {editingId && (
            <label className="font-semibold text-[#111827] md:col-span-2">
              {t("calendar.status")}
              <select
                className="mt-1 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]"
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value)}
              >
                {APPOINTMENT_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {appointmentStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="font-semibold text-[#111827] md:col-span-2">
            {t("calendar.notes")}
            <textarea
              rows={2}
              className="mt-1 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]"
              placeholder={t("calendar.optionalNotes")}
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
            />
          </label>
          {editingId && selectedReminderStatus && (
            <div className="md:col-span-2 rounded-2xl border border-[#E5E7EB] bg-white p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusBadge tone={reminderChipTone(selectedReminderStatus.reminderState)}>
                  {reminderChipLabel(selectedReminderStatus.reminderState)}
                </StatusBadge>
                {selectedReminderStatus.lastReminderSentAt && (
                  <span className="text-xs font-semibold text-[#6B7280]">
                    Last reminder: {new Date(selectedReminderStatus.lastReminderSentAt).toLocaleString()}
                  </span>
                )}
                {selectedReminderStatus.nextReminderAt && (
                  <span className="text-xs font-semibold text-[#6B7280]">
                    Next reminder: {new Date(selectedReminderStatus.nextReminderAt).toLocaleString()}
                  </span>
                )}
              </div>
              <div className="space-y-1">
                {selectedReminderEvents.length === 0 ? (
                  <p className="text-xs font-semibold text-[#6B7280]">Reminder timeline is empty</p>
                ) : (
                  selectedReminderEvents.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-center justify-between rounded-lg border border-[#EEF2F7] bg-[#F8FAFC] px-2 py-1"
                    >
                      <span className="text-xs font-bold text-[#1F2937]">{event.eventType}</span>
                      <span className="text-xs text-[#6B7280]">{new Date(event.occurredAtUtc).toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <Button variant="primary" type="submit" disabled={saving}>
              {saving
                ? t("calendar.saving")
                : editingId
                  ? t("calendar.updateAppointment")
                  : engineWriteEnabled
                    ? t("calendar.sendForApproval")
                    : t("calendar.save")}
            </Button>
            {editingId && formStatus !== "cancelled" && (
              <Button variant="warn" type="button" disabled={saving} onClick={() => cancelAppointment()}>
                {t("calendar.cancelAppointment")}
              </Button>
            )}
            {editingId && (
              <Button variant="danger" type="button" disabled={saving} onClick={() => deleteAppointment()}>
                <Trash2 className="h-4 w-4" />
                {t("calendar.deleteAppointment")}
              </Button>
            )}
          </div>
        </form>
              </CollapsePanel>

              <CalendarToolbar
                viewMode={viewMode}
                title={calendarTitle}
                onViewModeChange={setViewMode}
                onPrev={handleCalendarPrev}
                onNext={handleCalendarNext}
                onToday={handleCalendarToday}
                monthPickerValue={monthPickerValue}
                onMonthPickerChange={handleMonthPickerChange}
              />

              {viewMode === "day" ? (
                <DayTimelineView
                  date={selectedDay}
                  appointments={appointments}
                  loading={loading}
                  onSelectAppointment={openEditForm}
                  onQuickConfirm={quickConfirmAppointment}
                  onPrevDay={() => setSelectedDay((day) => startOfDay(addDays(day, -1)))}
                  onNextDay={() => setSelectedDay((day) => startOfDay(addDays(day, 1)))}
                  onToday={() => setSelectedDay(startOfDay(new Date()))}
                  statusLabel={statusLabelFn}
                  statusTone={statusToneFn}
                />
              ) : viewMode === "month" ? (
                <MonthCalendarView
                  monthAnchor={monthAnchor}
                  selectedDay={selectedDay}
                  appointments={appointments}
                  loading={loading}
                  onDayClick={handleMonthDayClick}
                  onDayDoubleClick={handleMonthDayClick}
                  onSelectAppointment={openEditForm}
                />
              ) : (
                <>
                  {!loading && !hasWeekAppointments && <WeekCalendarEmptyState onSchedule={openNewForm} />}
                  <WeekCalendarView
                    weekDays={weekDays}
                    appointments={appointments}
                    loading={loading}
                    statusLabel={statusLabelFn}
                    statusTone={statusToneFn}
                    onSelectAppointment={openEditForm}
                    onQuickConfirm={quickConfirmAppointment}
                  />
                </>
              )}
            </Card>

            <Card>
        <CardHeader
          title={t("calendar.myServices")}
          actions={
            <Button variant="secondary" type="button" onClick={() => setShowServiceForm((v) => !v)}>
              <Plus className="h-4 w-4" />
              {t("calendar.newService")}
            </Button>
          }
        />

        <CollapsePanel open={showServiceForm}>
          <form
            onSubmit={createService}
            className="mb-4 grid gap-3 rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-4 md:grid-cols-2"
          >
            <label className="font-semibold text-[#111827]">
              {t("calendar.serviceName")}
              <input
                required
                className="mt-1 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]"
                placeholder={t("calendar.serviceNamePlaceholder")}
                value={serviceForm.name}
                onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })}
              />
            </label>
            <label className="font-semibold text-[#111827]">
              {t("calendar.durationMinutes")}
              <input
                required
                type="number"
                min={1}
                className="mt-1 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]"
                value={serviceForm.durationMinutes}
                onChange={(e) =>
                  setServiceForm({ ...serviceForm, durationMinutes: Number(e.target.value) || 30 })
                }
              />
            </label>
            <label className="font-semibold text-[#111827]">
              {t("calendar.priceOptional")}
              <input
                type="number"
                min={0}
                step="0.01"
                className="mt-1 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]"
                placeholder="₪"
                value={serviceForm.price}
                onChange={(e) => setServiceForm({ ...serviceForm, price: e.target.value })}
              />
            </label>
            <label className="font-semibold text-[#111827]">
              {t("calendar.color")}
              <input
                type="color"
                className="mt-1 h-11 w-full rounded-xl border border-[#E5E7EB] bg-white"
                value={serviceForm.color}
                onChange={(e) => setServiceForm({ ...serviceForm, color: e.target.value })}
              />
            </label>
            <Button variant="primary" className="md:col-span-2" type="submit" disabled={savingService}>
              {savingService ? t("calendar.saving") : t("calendar.saveService")}
            </Button>
          </form>
        </CollapsePanel>

        {activeServices.length === 0 ? (
          <p className="text-sm font-semibold text-[#6B7280]">עדיין אין שירותים. הוסף שירות ראשון כדי לקשר לתורים.</p>
        ) : (
          <ul className="space-y-2">
            {activeServices.map((svc) => (
              <li
                key={svc.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#E5E7EB] bg-white p-3 shadow-sm"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border border-black/10"
                    style={{ backgroundColor: svc.color || DEFAULT_COLOR }}
                  />
                  <div className="min-w-0">
                    <div className="font-black text-[#111827]">{svc.name}</div>
                    <div className="text-sm font-semibold text-[#6B7280]">
                      {svc.durationMinutes} דק׳
                      {svc.price != null ? ` · ₪${svc.price.toLocaleString("he-IL")}` : ""}
                    </div>
                  </div>
                </div>
                <Button
                  variant="danger"
                  type="button"
                  className="!min-h-9 !rounded-xl !px-3"
                  disabled={deletingServiceId === svc.id}
                  onClick={() => deleteService(svc.id)}
                  aria-label={t("calendar.serviceDeleteLabel", { name: svc.name })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
            </Card>
          </div>

          <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            <NatalieCalendarActionCenter
              appointments={appointments}
              pendingDecisions={briefingSnapshot?.pendingDecisions}
              loading={briefLoading || loading}
              onSelectAppointment={(id) => {
                const appt = appointments.find((item) => item.id === id);
                if (appt) openEditForm(appt);
              }}
              onApproveAppointment={(id) => {
                const appt = appointments.find((item) => item.id === id);
                if (appt) void quickConfirmAppointment(appt);
              }}
            />
          </div>
        </div>

        <div className="xl:hidden">
          <NatalieCalendarActionCenter
            appointments={appointments}
            pendingDecisions={briefingSnapshot?.pendingDecisions}
            loading={briefLoading || loading}
            onSelectAppointment={(id) => {
              const appt = appointments.find((item) => item.id === id);
              if (appt) openEditForm(appt);
            }}
            onApproveAppointment={(id) => {
              const appt = appointments.find((item) => item.id === id);
              if (appt) void quickConfirmAppointment(appt);
            }}
          />
        </div>
        </div>
      </AppShell>
    </div>
  );
}
