"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AppointmentDetailsDrawer } from "@/components/calendar/AppointmentDetailsDrawer";
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
  Button,
  Card,
  CardHeader,
  FloatingActionButton,
  FormLabel,
  Input,
  MessageBanner,
  PageTitle,
  Select,
  StatusBadge,
  Textarea,
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
import { CheckCircle2, Clock, Plus, Trash2, X } from "lucide-react";

type Service = {
  id: string;
  name: string;
  durationMinutes: number;
  price?: number | null;
  color?: string | null;
  isActive: boolean;
  /** אילו עובדים מבצעים את השירות; ריק = כולם */
  employeeIds?: string[];
};

type CalendarEmployee = {
  id: string;
  name: string;
  phone?: string | null;
  color: string;
  photoUrl?: string | null;
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
  employeeId?: string | null;
  startTime: string;
  durationMinutes: number;
  status: string;
  notes?: string | null;
  client: ApptClient;
  service?: { id: string; name: string; color?: string | null; durationMinutes: number } | null;
  employee?: { id: string; name: string; color?: string | null; isActive?: boolean } | null;
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
  /** אילו עובדים מבצעים את השירות; ריק = כל העובדים */
  employeeIds: [] as string[],
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
  const router = useRouter();
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
  const [detailsAppointment, setDetailsAppointment] = useState<Appointment | null>(null);
  const [detailsRefreshKey, setDetailsRefreshKey] = useState(0);
  // Toast הצלחה קבוע (fixed) — נראה מעל ה-Drawer וסרגל הניווט, נעלם אוטומטית.
  const [saveToast, setSaveToast] = useState<string | null>(null);
  // פרטי קשר של הלקוח בטופס עריכת תור — נשמרים על ה-Client, לא על התור.
  const emptyContact = { phone: "", whatsapp: "", email: "", address: "" };
  const [formContact, setFormContact] = useState(emptyContact);
  const [contactLoaded, setContactLoaded] = useState(false);
  const [contactSnapshot, setContactSnapshot] = useState("");
  const [queueRefreshKey, setQueueRefreshKey] = useState(0);
  const [drawerRefreshKey, setDrawerRefreshKey] = useState(0);
  const [engineDisabledBanner, setEngineDisabledBanner] = useState<string | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [clients, setClients] = useState<ApptClient[]>([]);
  // Calendar Phase 1 — עובדים: רשימה, סינון תצוגה ושיוך תור לעובד.
  // בלי עובדים מוגדרים — שום דבר במסך לא משתנה.
  const [employees, setEmployees] = useState<CalendarEmployee[]>([]);
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [formClientId, setFormClientId] = useState("");
  const [formServiceId, setFormServiceId] = useState("");
  const [formEmployeeId, setFormEmployeeId] = useState("");
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

  const activeEmployees = useMemo(() => employees.filter((employee) => employee.isActive), [employees]);

  // עובדים שמותר לבחור לתור: אם לשירות הנבחר מוגדרים עובדים — רק הם;
  // שירות בלי הגדרה פתוח לכל העובדים. בעל העסק תמיד זמין.
  const employeesForSelectedService = useMemo(() => {
    if (!formServiceId) return activeEmployees;
    const service = services.find((s) => s.id === formServiceId);
    if (!service?.employeeIds?.length) return activeEmployees;
    return activeEmployees.filter((employee) => service.employeeIds!.includes(employee.id));
  }, [formServiceId, services, activeEmployees]);

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

      const [svcData, clientData, employeeData] = await Promise.all([
        apiFetch<Service[]>("/api/services"),
        apiFetch<ClientsResponse>("/api/clients"),
        // כשל בטעינת עובדים לא מפיל את היומן — פשוט אין סינון עובדים
        apiFetch<CalendarEmployee[]>("/api/employees").catch(() => [] as CalendarEmployee[]),
      ]);
      setServices(svcData);
      setClients(clientData.clients);
      setEmployees(employeeData);

      const employeeQuery = employeeFilter !== "all" ? `&employeeId=${encodeURIComponent(employeeFilter)}` : "";

      if (loadStrategy === "calendar_engine") {
        try {
          const events = await fetchCalendarEvents(from, to);
          // אירועי מנוע היומן שייכים לבעל העסק — מוסתרים בסינון עובד ספציפי
          const engineItems = calendarEventsToDisplayItems(events);
          setAppointments(
            employeeFilter === "all" || employeeFilter === "owner" ? engineItems : []
          );
        } catch (err) {
          if (err instanceof CalendarEngineUnavailableError) {
            setEngineDisabledBanner(CALENDAR_ENGINE_DISABLED_MESSAGE);
            const apptData = await apiFetch<Appointment[]>(
              `/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${employeeQuery}`
            );
            setAppointments(apptData.map(appointmentToDisplayItem));
            return;
          }
          throw err;
        }
      } else {
        const apptData = await apiFetch<Appointment[]>(
          `/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${employeeQuery}`
        );
        setAppointments(apptData.map(appointmentToDisplayItem));
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "טעינת היומן נכשלה");
    } finally {
      setLoading(false);
    }
  }, [viewMode, selectedDay, weekStart, monthAnchor, engineReadEnabled, employeeFilter]);

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
    if (!saveToast) return;
    const timer = window.setTimeout(() => setSaveToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [saveToast]);

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

  // "קבע תור" מכרטיס הלקוח: ?client=<id> פותח את טופס התור הקיים עם
  // הלקוח כבר נבחר. לא נוגע בלוגיקת היומן — רק prefill של הטופס.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const clientParam = params.get("client");
    if (!clientParam) return;
    setEditingId(null);
    setFormClientId(clientParam);
    setFormServiceId("");
    setFormEmployeeId("");
    setFormDate(dateInputValueInTimeZone(new Date(), orgTimezone));
    setFormTime("");
    setFormNotes("");
    setFormStatus("pending");
    setShowForm(true);
    window.history.replaceState({}, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgTimezone]);

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setFormClientId("");
    setFormServiceId("");
    setFormEmployeeId("");
    setFormDate("");
    setFormTime("");
    setFormNotes("");
    setFormStatus("pending");
    setSelectedReminderStatus(null);
    setSelectedReminderEvents([]);
    setFormContact(emptyContact);
    setContactLoaded(false);
    setContactSnapshot("");
  }

  function openNewForm() {
    setEditingId(null);
    setFormClientId("");
    setFormServiceId("");
    // תור חדש נפתח על העובד המסונן כרגע (אם נבחר עובד ספציפי)
    setFormEmployeeId(employeeFilter !== "all" && employeeFilter !== "owner" ? employeeFilter : "");
    setFormDate(dateInputValueInTimeZone(new Date(), orgTimezone));
    setFormTime("");
    setFormNotes("");
    setFormStatus("pending");
    setSelectedReminderStatus(null);
    setSelectedReminderEvents([]);
    setShowForm(true);
  }

  /**
   * לחיצה על תור בתצוגת השבוע: תור-מנוע נפתח ב-CalendarEventDrawer הקיים;
   * תור מהיומן הקיים נפתח בחלון פרטי התור (לא בטופס העריכה שבראש הדף,
   * שנמצא מחוץ למסך כשגוללים בגריד).
   */
  function openAppointmentDetails(appt: CalendarDisplayItem) {
    if (isEngineDisplayItem(appt)) {
      setSelectedEngineEventId(appt.engineEventId ?? appt.id);
      return;
    }
    setDetailsAppointment(appt as Appointment);
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
    setFormEmployeeId((appt as Appointment).employeeId ?? "");
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
    // פרטי קשר של הלקוח — נטענים מה-Client עצמו; נשמרים רק אם הטעינה הצליחה
    // (contactLoaded) כדי לא לדרוס נתונים קיימים בשמירה עיוורת.
    setFormContact(emptyContact);
    setContactLoaded(false);
    setContactSnapshot("");
    void apiFetch<{
      client?: {
        phone?: string | null;
        whatsappNumber?: string | null;
        email?: string | null;
        emailIsPlaceholder?: boolean;
        address?: string | null;
      };
    }>(`/api/clients/${appt.clientId}`)
      .then((result) => {
        const contact = {
          phone: result.client?.phone ?? "",
          whatsapp: result.client?.whatsappNumber ?? "",
          email: result.client?.emailIsPlaceholder ? "" : (result.client?.email ?? ""),
          address: result.client?.address ?? "",
        };
        setFormContact(contact);
        setContactSnapshot(JSON.stringify(contact));
        setContactLoaded(true);
      })
      .catch(() => setContactLoaded(false));
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
    if (saving) return; // מניעת שליחה כפולה — גם מהכפתור וגם מ-Enter
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
            employeeId: formEmployeeId || null,
            notes: formNotes.trim() || null,
            status: formStatus,
          }),
        });
        // פרטי הקשר נשמרים על ה-Client עצמו (לא על התור), רק אם נטענו
        // בהצלחה ורק כשבאמת השתנו.
        const contactChanged = contactLoaded && JSON.stringify(formContact) !== contactSnapshot;
        if (contactChanged) {
          await apiFetch(`/api/clients/${formClientId}`, {
            method: "PUT",
            body: JSON.stringify({
              phone: formContact.phone,
              whatsappNumber: formContact.whatsapp,
              email: formContact.email,
              address: formContact.address,
            }),
          });
          setDetailsRefreshKey((k) => k + 1);
          setMessage("פרטי התור והלקוח נשמרו בהצלחה");
          setSaveToast("פרטי התור והלקוח נשמרו בהצלחה");
        } else {
          setDetailsRefreshKey((k) => k + 1);
          setMessage("התור עודכן בהצלחה");
          setSaveToast("התור עודכן בהצלחה");
        }
      } else if (!formEmployeeId && resolveCalendarCreateStrategy(engineWriteEnabled) === "calendar_engine_draft") {
        // תור לעובד תמיד נשמר במסלול הישיר — מנוע היומן (טיוטות) מכיר רק
        // את היומן של בעל העסק בשלב הזה.
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
            employeeId: formEmployeeId || null,
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
      const body: { name: string; durationMinutes: number; color: string; price?: number; employeeIds?: string[] } = {
        name: serviceForm.name.trim(),
        durationMinutes: serviceForm.durationMinutes,
        color: serviceForm.color,
      };
      if (serviceForm.price.trim()) {
        body.price = Number(serviceForm.price);
      }
      if (employees.length > 0) {
        body.employeeIds = serviceForm.employeeIds;
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

  return (
    <div dir={dir} data-testid="calendar-page">
      {saveToast ? (
        <div
          className="fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[130] flex justify-center px-4"
          role="status"
          aria-live="polite"
          data-testid="calendar-save-toast"
        >
          <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-[#34D399] bg-[#ECFDF5] px-4 py-3 text-sm font-black text-[#065F46] shadow-[0_10px_30px_rgba(6,95,70,0.25)] dark:border-[#065F46] dark:bg-[#052E24] dark:text-[#6EE7B7]">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span>{saveToast}</span>
          </div>
        </div>
      ) : null}
      <AppShell
        pageTitle={
          <PageTitle
            title={businessName || t("calendarDesign.title")}
            subtitle={t("calendarDesign.subtitle")}
          />
        }
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

            <AppointmentDetailsDrawer
              appointment={detailsAppointment}
              refreshKey={detailsRefreshKey}
              statusLabel={statusLabelFn}
              statusTone={statusToneFn}
              onClose={() => setDetailsAppointment(null)}
              onEdit={() => {
                const appt = detailsAppointment;
                setDetailsAppointment(null);
                if (appt) {
                  openEditForm(appointmentToDisplayItem(appt));
                  // טופס העריכה יושב בראש הדף — בלי גלילה הוא נשאר מחוץ למסך
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
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
                    <Button variant="secondary" onClick={() => router.push("/dashboard/calendar/employees")} data-testid="manage-employees-button">
                      עובדים
                    </Button>
                    <Button variant="primary" onClick={openNewForm}>
                      <Plus className="h-4 w-4" />
                      {t("calendar.newAppointment")}
                    </Button>
                  </>
                }
              />

              {employees.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="employee-filter">
                  <span className="text-sm font-bold text-[var(--natalie-text-muted,#64748B)]">הצג יומן:</span>
                  <Select
                    className="!min-h-9 max-w-56"
                    value={employeeFilter}
                    onChange={(e) => setEmployeeFilter(e.target.value)}
                    aria-label="סינון לפי עובד"
                  >
                    <option value="all">כל העובדים</option>
                    <option value="owner">בעל העסק</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name}
                        {employee.isActive ? "" : " (מושבת)"}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              <CollapsePanel open={showForm}>
                <form onSubmit={saveAppointment} className="mb-5 grid gap-3 rounded-2xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-bg-page,#F3F6FF)] p-4 md:grid-cols-2">
          <div className="flex items-center justify-between md:col-span-2">
            <h2 className="text-lg font-black text-[var(--natalie-text-primary,#0F172A)]">{editingId ? t("calendar.editAppointment") : t("calendar.newAppointment")}</h2>
            <Button variant="secondary" size="sm" type="button" onClick={resetForm}>
              <X className="h-4 w-4" />
              {t("calendar.cancel")}
            </Button>
          </div>
          <FormLabel>
            {t("calendar.customer")}
            <Select
              required
              className="mt-1"
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
            </Select>
          </FormLabel>
          <FormLabel>
            {t("calendar.service")}
            <Select
              className="mt-1"
              value={formServiceId}
              onChange={(e) => {
                setFormServiceId(e.target.value);
                // אם העובד הנבחר לא מבצע את השירות החדש — מאפסים לבעל העסק
                const nextService = services.find((s) => s.id === e.target.value);
                if (
                  formEmployeeId &&
                  nextService?.employeeIds?.length &&
                  !nextService.employeeIds.includes(formEmployeeId)
                ) {
                  setFormEmployeeId("");
                }
              }}
            >
              <option value="">{t("calendar.noService")}</option>
              {activeServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.durationMinutes} דק׳)
                </option>
              ))}
            </Select>
          </FormLabel>
          {employees.length > 0 && (
            <FormLabel>
              עובד
              <Select
                className="mt-1"
                value={formEmployeeId}
                onChange={(e) => setFormEmployeeId(e.target.value)}
                data-testid="appointment-employee-select"
              >
                <option value="">בעל העסק</option>
                {employeesForSelectedService.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </Select>
            </FormLabel>
          )}
          {selectedServiceDuration !== null && !editingId && (
            <p className="flex items-center gap-2 text-sm font-semibold text-[var(--natalie-text-muted,#64748B)] md:col-span-2">
              <Clock className="h-4 w-4" />
              {t("calendar.estimatedDuration", { minutes: selectedServiceDuration })}
            </p>
          )}
          <FormLabel>
            {t("calendar.date")}
            <Input
              required
              type="date"
              className="mt-1"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
            />
          </FormLabel>
          <FormLabel>
            {t("calendar.time")}
            <Input
              required
              type="time"
              className="mt-1"
              value={formTime}
              onChange={(e) => setFormTime(e.target.value)}
            />
          </FormLabel>
          {editingId && (
            <FormLabel className="md:col-span-2">
              {t("calendar.status")}
              <Select
                className="mt-1"
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value)}
              >
                {APPOINTMENT_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {appointmentStatusLabel(status)}
                  </option>
                ))}
              </Select>
            </FormLabel>
          )}
          <FormLabel className="md:col-span-2">
            {t("calendar.notes")}
            <Textarea
              rows={2}
              className="mt-1"
              placeholder={t("calendar.optionalNotes")}
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
            />
          </FormLabel>
          {editingId && (
            <div className="md:col-span-2 rounded-2xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-card-bg,#ffffff)] p-3">
              <h3 className="mb-2 text-sm font-black text-[var(--natalie-text-primary,#0F172A)]">
                פרטי קשר של הלקוח
              </h3>
              {!contactLoaded ? (
                <p className="text-xs font-semibold text-[var(--natalie-text-muted,#64748B)]">
                  טוען פרטי קשר...
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <FormLabel>
                    טלפון
                    <Input
                      dir="ltr"
                      type="tel"
                      value={formContact.phone}
                      onChange={(e) => setFormContact((c) => ({ ...c, phone: e.target.value }))}
                      placeholder="050-1234567 או +972..."
                    />
                  </FormLabel>
                  <FormLabel>
                    WhatsApp
                    <Input
                      dir="ltr"
                      type="tel"
                      value={formContact.whatsapp}
                      onChange={(e) => setFormContact((c) => ({ ...c, whatsapp: e.target.value }))}
                      placeholder="050-1234567 או +972..."
                    />
                  </FormLabel>
                  <FormLabel>
                    אימייל
                    <Input
                      dir="ltr"
                      type="email"
                      value={formContact.email}
                      onChange={(e) => setFormContact((c) => ({ ...c, email: e.target.value }))}
                      placeholder="client@example.com"
                    />
                  </FormLabel>
                  <FormLabel>
                    כתובת
                    <Input
                      value={formContact.address}
                      onChange={(e) => setFormContact((c) => ({ ...c, address: e.target.value }))}
                      placeholder="רחוב, מספר, עיר"
                    />
                  </FormLabel>
                </div>
              )}
            </div>
          )}
          {editingId && selectedReminderStatus && (
            <div className="md:col-span-2 rounded-2xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-card-bg,#ffffff)] p-3">
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
                    onSelectAppointment={openAppointmentDetails}
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
            className="mb-4 grid gap-3 rounded-2xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-bg-page,#F3F6FF)] p-4 md:grid-cols-2"
          >
            <FormLabel>
              {t("calendar.serviceName")}
              <Input
                required
                className="mt-1"
                placeholder={t("calendar.serviceNamePlaceholder")}
                value={serviceForm.name}
                onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })}
              />
            </FormLabel>
            <FormLabel>
              {t("calendar.durationMinutes")}
              <Input
                required
                type="number"
                min={1}
                className="mt-1"
                value={serviceForm.durationMinutes}
                onChange={(e) =>
                  setServiceForm({ ...serviceForm, durationMinutes: Number(e.target.value) || 30 })
                }
              />
            </FormLabel>
            <FormLabel>
              {t("calendar.priceOptional")}
              <Input
                type="number"
                min={0}
                step="0.01"
                className="mt-1"
                placeholder="₪"
                value={serviceForm.price}
                onChange={(e) => setServiceForm({ ...serviceForm, price: e.target.value })}
              />
            </FormLabel>
            <FormLabel>
              {t("calendar.color")}
              <Input
                type="color"
                className="mt-1 h-11 w-full rounded-xl p-1"
                value={serviceForm.color}
                onChange={(e) => setServiceForm({ ...serviceForm, color: e.target.value })}
              />
            </FormLabel>
            {activeEmployees.length > 0 && (
              <div className="md:col-span-2">
                <span className="text-sm font-bold text-[var(--natalie-text-muted,#64748B)]">
                  אילו עובדים מבצעים את השירות? (ללא בחירה — כולם)
                </span>
                <div className="mt-1 flex flex-wrap gap-3">
                  {activeEmployees.map((employee) => (
                    <label key={employee.id} className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
                      <input
                        type="checkbox"
                        checked={serviceForm.employeeIds.includes(employee.id)}
                        onChange={(e) =>
                          setServiceForm({
                            ...serviceForm,
                            employeeIds: e.target.checked
                              ? [...serviceForm.employeeIds, employee.id]
                              : serviceForm.employeeIds.filter((id) => id !== employee.id),
                          })
                        }
                      />
                      {employee.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
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
