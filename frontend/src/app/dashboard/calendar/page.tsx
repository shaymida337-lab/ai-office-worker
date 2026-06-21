"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch, getToken } from "@/lib/api";
import { StatusPill } from "@/components/ui/StatusPill";
import { Calendar, ChevronLeft, ChevronRight, Clock, Plus, Trash2, X } from "lucide-react";

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
};

type ClientsResponse = {
  clients: ApptClient[];
};

const DAY_NAMES = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];
const DEFAULT_COLOR = "#3B82F6";

const panelClass = "rounded-2xl border border-[#E5E7EB] bg-white p-4 text-[#111827] shadow-sm";
const btnPrimary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#1D4ED8] bg-[#DBEAFE] px-4 py-3 text-base font-black text-[#111827] transition hover:bg-[#BFDBFE] disabled:cursor-not-allowed disabled:opacity-60";
const btnSecondary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 text-base font-black text-[#111827] transition hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-60";
const btnSecondarySm =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-black text-[#111827] transition hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-60";
const btnDanger =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#B91C1C] bg-[#FEE2E2] px-4 py-3 text-base font-black text-[#111827] transition hover:bg-[#FECACA] disabled:cursor-not-allowed disabled:opacity-60";

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

function toTimeInputValue(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function buildStartTimeIso(date: string, time: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const dt = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return dt.toISOString();
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function colorWithAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return `rgba(59, 130, 246, ${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

function isErrorMessage(text: string) {
  return text.includes("נכשל") || text.includes("חובה") || text.includes("יש לבחור");
}

function messageBannerClass(text: string) {
  if (isErrorMessage(text)) {
    return "mb-6 animate-[toastSlide_.25s_ease] rounded-2xl border border-[#B91C1C] bg-[#FEE2E2] p-4 text-base font-semibold leading-7 text-[#7F1D1D]";
  }
  return "mb-6 animate-[toastSlide_.25s_ease] rounded-2xl border border-[#059669] bg-[#ECFDF5] p-4 text-base font-semibold leading-7 text-[#065F46]";
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
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [showServiceForm, setShowServiceForm] = useState(false);
  const [serviceForm, setServiceForm] = useState(emptyServiceForm);
  const [savingService, setSavingService] = useState(false);
  const [deletingServiceId, setDeletingServiceId] = useState<string | null>(null);
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null);
  const [connectingCalendar, setConnectingCalendar] = useState(false);

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
    const from = weekStart.toLocaleDateString("he-IL", { day: "numeric", month: "short" });
    const to = weekEnd.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
    return `${from} – ${to}`;
  }, [weekStart]);

  const appointmentsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const day of weekDays) {
      map.set(toDateInputValue(day), []);
    }
    for (const appt of appointments) {
      const key = toDateInputValue(new Date(appt.startTime));
      if (map.has(key)) {
        map.get(key)!.push(appt);
      }
    }
    for (const [, list] of map) {
      list.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }
    return map;
  }, [appointments, weekDays]);

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
      const data = await apiFetch<{ url: string }>("/api/integrations/calendar/connect-url");
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

  async function loadWeek() {
    setLoading(true);
    try {
      const weekEnd = addDays(weekStart, 7);
      const from = weekStart.toISOString();
      const to = weekEnd.toISOString();
      const [apptData, svcData, clientData] = await Promise.all([
        apiFetch<Appointment[]>(`/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
        apiFetch<Service[]>("/api/services"),
        apiFetch<ClientsResponse>("/api/clients"),
      ]);
      setAppointments(apptData);
      setServices(svcData);
      setClients(clientData.clients);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "טעינת היומן נכשלה");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWeek().catch((err) => setMessage(err instanceof Error ? err.message : "טעינת היומן נכשלה"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  useEffect(() => {
    loadCalendarStatus();
  }, []);

  useEffect(() => {
    if (!window.location.search.includes("calendar=connected")) return;
    setMessage("היומן חובר בהצלחה ל-Google Calendar");
    loadCalendarStatus();
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setFormClientId("");
    setFormServiceId("");
    setFormDate("");
    setFormTime("");
    setFormNotes("");
  }

  function openNewForm() {
    setEditingId(null);
    setFormClientId("");
    setFormServiceId("");
    setFormDate(toDateInputValue(new Date()));
    setFormTime("");
    setFormNotes("");
    setShowForm(true);
  }

  function openEditForm(appt: Appointment) {
    const start = new Date(appt.startTime);
    setEditingId(appt.id);
    setFormClientId(appt.clientId);
    setFormServiceId(appt.serviceId ?? "");
    setFormDate(toDateInputValue(start));
    setFormTime(toTimeInputValue(start));
    setFormNotes(appt.notes ?? "");
    setShowForm(true);
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
          }),
        });
        setMessage("התור עודכן בהצלחה");
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
      await loadWeek();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שמירת התור נכשלה");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAppointment() {
    if (!editingId) return;
    setMessage("");
    setSaving(true);
    try {
      await apiFetch(`/api/appointments/${editingId}`, { method: "DELETE" });
      setMessage("התור נמחק");
      resetForm();
      await loadWeek();
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

  return (
    <div className="container">
      <Nav />

      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="page-kicker">יומן</div>
          <h1 className="font-black text-[#111827]">היומן שלי</h1>
          <p className="font-semibold text-[#6B7280]">ניהול תורים ושירותים — תצוגת שבוע, יצירה ועריכה במקום אחד.</p>
          {calendarConnected === true && (
            <div className="mt-3">
              <StatusPill tone="success">מחובר ל-Google Calendar ✓</StatusPill>
            </div>
          )}
          {calendarConnected === false && (
            <div className="mt-3">
              <button
                type="button"
                className={btnSecondary}
                disabled={connectingCalendar}
                onClick={() => connectCalendar()}
              >
                {connectingCalendar ? "מתחבר..." : "חבר Google Calendar"}
              </button>
            </div>
          )}
        </div>
        <button type="button" className={btnPrimary} onClick={openNewForm}>
          <Plus className="h-4 w-4" />
          תור חדש
        </button>
      </div>

      {message && <div className={messageBannerClass(message)}>{message}</div>}

      <CollapsePanel open={showForm}>
        <form onSubmit={saveAppointment} className={`${panelClass} mb-5 grid gap-3 md:grid-cols-2`}>
          <div className="flex items-center justify-between md:col-span-2">
            <h2 className="text-lg font-black text-[#111827]">{editingId ? "עריכת תור" : "תור חדש"}</h2>
            <button type="button" className={btnSecondarySm} onClick={resetForm}>
              <X className="h-4 w-4" />
              ביטול
            </button>
          </div>
          <label className="font-semibold text-[#111827]">
            לקוח
            <select
              required
              className="mt-1 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]"
              value={formClientId}
              disabled={Boolean(editingId)}
              onChange={(e) => setFormClientId(e.target.value)}
            >
              <option value="">בחר לקוח</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="font-semibold text-[#111827]">
            שירות
            <select
              className="mt-1 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]"
              value={formServiceId}
              onChange={(e) => setFormServiceId(e.target.value)}
            >
              <option value="">ללא שירות</option>
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
              משך משוער: {selectedServiceDuration} דקות
            </p>
          )}
          <label className="font-semibold text-[#111827]">
            תאריך
            <input
              required
              type="date"
              className="mt-1 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
            />
          </label>
          <label className="font-semibold text-[#111827]">
            שעה
            <input
              required
              type="time"
              className="mt-1 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]"
              value={formTime}
              onChange={(e) => setFormTime(e.target.value)}
            />
          </label>
          <label className="font-semibold text-[#111827] md:col-span-2">
            הערות
            <textarea
              rows={2}
              className="mt-1 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]"
              placeholder="הערות לתור (אופציונלי)"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <button className={btnPrimary} type="submit" disabled={saving}>
              {saving ? "שומר..." : editingId ? "עדכן תור" : "שמור תור"}
            </button>
            {editingId && (
              <button type="button" className={btnDanger} disabled={saving} onClick={() => deleteAppointment()}>
                <Trash2 className="h-4 w-4" />
                מחק תור
              </button>
            )}
          </div>
        </form>
      </CollapsePanel>

      <div className={`${panelClass} mb-5`}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-[#1D4ED8]" />
            <h2 className="text-lg font-black text-[#111827]">{weekLabel}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnSecondarySm}
              onClick={() => setWeekStart((w) => addDays(w, -7))}
              aria-label="שבוע קודם"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button type="button" className={btnSecondarySm} onClick={() => setWeekStart(getWeekStart(new Date()))}>
              היום
            </button>
            <button
              type="button"
              className={btnSecondarySm}
              onClick={() => setWeekStart((w) => addDays(w, 7))}
              aria-label="שבוע הבא"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="skeleton h-48 rounded-2xl" />
        ) : (
          <div
            key={weekStart.toISOString()}
            className="transition-opacity duration-200 animate-[toastSlide_.25s_ease]"
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" dir="rtl">
              {weekDays.map((day, index) => {
                const key = toDateInputValue(day);
                const dayAppts = appointmentsByDay.get(key) ?? [];
                const today = isSameDay(day, new Date());
                return (
                  <div
                    key={key}
                    className={`min-h-[120px] rounded-xl border p-2 ${
                      today
                        ? "border-[#1D4ED8]/40 bg-[#EFF6FF]"
                        : "border-[#E5E7EB] bg-[#F8FAFC]"
                    }`}
                  >
                    <div
                      className={`mb-2 text-center text-sm font-black ${
                        today ? "text-[#1D4ED8]" : "text-[#111827]"
                      }`}
                    >
                      <div>{DAY_NAMES[index]}</div>
                      <div className="text-xs font-semibold text-[#6B7280]">
                        {day.toLocaleDateString("he-IL", { day: "numeric", month: "numeric" })}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {dayAppts.length === 0 ? (
                        <div className="h-2" />
                      ) : (
                        dayAppts.map((appt) => {
                          const color = appt.service?.color || DEFAULT_COLOR;
                          const time = new Date(appt.startTime).toLocaleTimeString("he-IL", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          });
                          return (
                            <button
                              key={appt.id}
                              type="button"
                              onClick={() => openEditForm(appt)}
                              className="w-full rounded-xl border p-2 text-right text-xs transition-all duration-200 ease-out hover:-translate-y-[1px] hover:opacity-90 hover:shadow-md"
                              style={{
                                backgroundColor: colorWithAlpha(color, 0.15),
                                borderColor: colorWithAlpha(color, 0.35),
                              }}
                            >
                              <div className="mb-1 flex items-center justify-between gap-1">
                                <span className="font-black" dir="ltr">
                                  {time}
                                </span>
                                <StatusPill tone={appointmentStatusTone(appt.status)}>
                                  {appointmentStatusLabel(appt.status)}
                                </StatusPill>
                              </div>
                              <div className="truncate font-black text-[#111827]">{appt.client.name}</div>
                              {appt.service && (
                                <div className="truncate font-semibold text-[#6B7280]">{appt.service.name}</div>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <section className={panelClass}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-black text-[#111827]">השירותים שלי</h2>
          <button type="button" className={btnSecondary} onClick={() => setShowServiceForm((v) => !v)}>
            <Plus className="h-4 w-4" />
            שירות חדש
          </button>
        </div>

        <CollapsePanel open={showServiceForm}>
          <form
            onSubmit={createService}
            className="mb-4 grid gap-3 rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-4 md:grid-cols-2"
          >
            <label className="font-semibold text-[#111827]">
              שם שירות
              <input
                required
                className="mt-1 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]"
                placeholder="למשל: ייעוץ ראשוני"
                value={serviceForm.name}
                onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })}
              />
            </label>
            <label className="font-semibold text-[#111827]">
              משך (דקות)
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
              מחיר (אופציונלי)
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
              צבע
              <input
                type="color"
                className="mt-1 h-11 w-full rounded-xl border border-[#E5E7EB] bg-white"
                value={serviceForm.color}
                onChange={(e) => setServiceForm({ ...serviceForm, color: e.target.value })}
              />
            </label>
            <button className={`${btnPrimary} md:col-span-2`} type="submit" disabled={savingService}>
              {savingService ? "שומר..." : "שמור שירות"}
            </button>
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
                <button
                  type="button"
                  className={`${btnDanger} !min-h-9 !rounded-xl !px-3`}
                  disabled={deletingServiceId === svc.id}
                  onClick={() => deleteService(svc.id)}
                  aria-label={`מחק ${svc.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
