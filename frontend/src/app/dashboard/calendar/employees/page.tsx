"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AppShell,
  Button,
  Card,
  CardHeader,
  FormLabel,
  Input,
  MessageBanner,
  PageTitle,
  StatusBadge,
} from "@/components/natalie-ui";
import { apiFetch } from "@/lib/api";
import { ArrowRight, Pencil, Plus, Trash2, X } from "lucide-react";

/**
 * Calendar Phase 1 — ניהול עובדים ביומן: הוספה, עריכה, השבתה ומחיקה,
 * שעות עבודה שבועיות (כולל הפסקות) וימי חופשה לכל עובד.
 */

type WorkingHoursEntry = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  breaksJson?: Array<{ start: string; end: string }>;
};

type Vacation = {
  id: string;
  startDate: string;
  endDate: string;
  note?: string | null;
};

type Employee = {
  id: string;
  name: string;
  phone?: string | null;
  color: string;
  photoUrl?: string | null;
  isActive: boolean;
  workingHours: WorkingHoursEntry[];
  vacations: Vacation[];
  serviceIds?: string[];
};

type DayScheduleDraft = {
  enabled: boolean;
  startTime: string;
  endTime: string;
  breaks: Array<{ start: string; end: string }>;
};

const WEEKDAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const DEFAULT_COLOR = "#3B82F6";
const MAX_PHOTO_BYTES = 200 * 1024;

const emptyForm = { name: "", phone: "", color: DEFAULT_COLOR, photoUrl: "" };

function emptyScheduleDraft(): DayScheduleDraft[] {
  return WEEKDAY_NAMES.map(() => ({ enabled: false, startTime: "09:00", endTime: "17:00", breaks: [] }));
}

function scheduleDraftFromEmployee(employee: Employee): DayScheduleDraft[] {
  const draft = emptyScheduleDraft();
  for (const entry of employee.workingHours ?? []) {
    if (entry.dayOfWeek < 0 || entry.dayOfWeek > 6) continue;
    draft[entry.dayOfWeek] = {
      enabled: true,
      startTime: entry.startTime,
      endTime: entry.endTime,
      breaks: Array.isArray(entry.breaksJson) ? entry.breaksJson.map((b) => ({ ...b })) : [],
    };
  }
  return draft;
}

function isErrorMessage(text: string) {
  return text.includes("נכשל") || text.includes("חובה") || text.includes("לא ") || text.includes("שגיאה");
}

export default function CalendarEmployeesPage() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // עורך שעות עבודה/חופשות — נפתח לעובד אחד בכל רגע
  const [scheduleEmployeeId, setScheduleEmployeeId] = useState<string | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<DayScheduleDraft[]>(emptyScheduleDraft());
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [vacationForm, setVacationForm] = useState({ startDate: "", endDate: "", note: "" });
  const [savingVacation, setSavingVacation] = useState(false);

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Employee[]>("/api/employees");
      setEmployees(data);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "טעינת העובדים נכשלה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEmployees().catch(() => undefined);
  }, [loadEmployees]);

  function openNewForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEditForm(employee: Employee) {
    setEditingId(employee.id);
    setForm({
      name: employee.name,
      phone: employee.phone ?? "",
      color: employee.color || DEFAULT_COLOR,
      photoUrl: employee.photoUrl ?? "",
    });
    setShowForm(true);
  }

  async function handlePhotoFile(file: File | null) {
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      setMessage("התמונה גדולה מדי — עד 200KB");
      return;
    }
    const dataUri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setForm((prev) => ({ ...prev, photoUrl: dataUri }));
  }

  async function saveEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!form.name.trim()) {
      setMessage("שם העובד הוא שדה חובה");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        color: form.color,
        photoUrl: form.photoUrl || null,
      };
      if (editingId) {
        await apiFetch(`/api/employees/${editingId}`, { method: "PATCH", body: JSON.stringify(body) });
        setMessage("פרטי העובד עודכנו");
      } else {
        await apiFetch("/api/employees", { method: "POST", body: JSON.stringify(body) });
        setMessage("העובד נוסף בהצלחה");
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      await loadEmployees();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שמירת העובד נכשלה");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(employee: Employee) {
    setMessage("");
    try {
      await apiFetch(`/api/employees/${employee.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !employee.isActive }),
      });
      setMessage(employee.isActive ? "העובד הושבת — לא ניתן לקבוע לו תורים חדשים" : "העובד הופעל מחדש");
      await loadEmployees();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "עדכון העובד נכשל");
    }
  }

  async function deleteEmployee(employee: Employee) {
    if (!window.confirm(`למחוק את ${employee.name} לצמיתות? אפשר גם להשבית במקום.`)) return;
    setMessage("");
    try {
      await apiFetch(`/api/employees/${employee.id}`, { method: "DELETE" });
      setMessage("העובד נמחק");
      if (scheduleEmployeeId === employee.id) setScheduleEmployeeId(null);
      await loadEmployees();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "מחיקת העובד נכשלה");
    }
  }

  function openScheduleEditor(employee: Employee) {
    setScheduleEmployeeId(employee.id);
    setScheduleDraft(scheduleDraftFromEmployee(employee));
    setVacationForm({ startDate: "", endDate: "", note: "" });
  }

  function updateDay(dayIndex: number, patch: Partial<DayScheduleDraft>) {
    setScheduleDraft((prev) => prev.map((day, index) => (index === dayIndex ? { ...day, ...patch } : day)));
  }

  function updateBreak(dayIndex: number, breakIndex: number, patch: Partial<{ start: string; end: string }>) {
    setScheduleDraft((prev) =>
      prev.map((day, index) =>
        index === dayIndex
          ? { ...day, breaks: day.breaks.map((b, i) => (i === breakIndex ? { ...b, ...patch } : b)) }
          : day
      )
    );
  }

  async function saveSchedule() {
    if (!scheduleEmployeeId) return;
    setMessage("");
    setSavingSchedule(true);
    try {
      const workingHours = scheduleDraft
        .map((day, dayOfWeek) => ({ day, dayOfWeek }))
        .filter(({ day }) => day.enabled)
        .map(({ day, dayOfWeek }) => ({
          dayOfWeek,
          startTime: day.startTime,
          endTime: day.endTime,
          breaks: day.breaks.filter((b) => b.start && b.end),
        }));
      await apiFetch(`/api/employees/${scheduleEmployeeId}/working-hours`, {
        method: "PUT",
        body: JSON.stringify({ workingHours }),
      });
      setMessage("שעות העבודה נשמרו");
      await loadEmployees();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שמירת שעות העבודה נכשלה");
    } finally {
      setSavingSchedule(false);
    }
  }

  async function addVacation() {
    if (!scheduleEmployeeId) return;
    if (!vacationForm.startDate) {
      setMessage("יש לבחור תאריך התחלה לחופשה");
      return;
    }
    setMessage("");
    setSavingVacation(true);
    try {
      await apiFetch(`/api/employees/${scheduleEmployeeId}/vacations`, {
        method: "POST",
        body: JSON.stringify({
          startDate: vacationForm.startDate,
          endDate: vacationForm.endDate || vacationForm.startDate,
          note: vacationForm.note.trim() || null,
        }),
      });
      setMessage("החופשה נוספה");
      setVacationForm({ startDate: "", endDate: "", note: "" });
      await loadEmployees();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "הוספת החופשה נכשלה");
    } finally {
      setSavingVacation(false);
    }
  }

  async function removeVacation(vacationId: string) {
    setMessage("");
    try {
      await apiFetch(`/api/employees/vacations/${vacationId}`, { method: "DELETE" });
      setMessage("החופשה הוסרה");
      await loadEmployees();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "הסרת החופשה נכשלה");
    }
  }

  const scheduleEmployee = employees.find((employee) => employee.id === scheduleEmployeeId) ?? null;

  return (
    <div dir="rtl" data-testid="calendar-employees-page">
      <AppShell
        pageTitle={<PageTitle title="עובדים ביומן" subtitle="ניהול צוות, שעות עבודה וחופשות — לכל עובד יומן משלו" />}
      >
        <div className="space-y-5">
          {message ? (
            <MessageBanner tone={isErrorMessage(message) ? "error" : "success"}>{message}</MessageBanner>
          ) : null}

          <Card data-testid="employees-card">
            <CardHeader
              title="העובדים שלי"
              subtitle="תור בלי עובד שייך ליומן של בעל העסק"
              actions={
                <>
                  <Button variant="secondary" type="button" onClick={() => router.push("/dashboard/calendar")}>
                    <ArrowRight className="h-4 w-4" />
                    חזרה ליומן
                  </Button>
                  <Button variant="primary" type="button" onClick={openNewForm} data-testid="add-employee-button">
                    <Plus className="h-4 w-4" />
                    עובד חדש
                  </Button>
                </>
              }
            />

            {showForm && (
              <form
                onSubmit={saveEmployee}
                className="mb-4 grid gap-3 rounded-2xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-bg-page,#F3F6FF)] p-4 md:grid-cols-2"
                data-testid="employee-form"
              >
                <div className="flex items-center justify-between md:col-span-2">
                  <h2 className="text-lg font-black text-[var(--natalie-text-primary,#0F172A)]">
                    {editingId ? "עריכת עובד" : "עובד חדש"}
                  </h2>
                  <Button variant="secondary" size="sm" type="button" onClick={() => setShowForm(false)}>
                    <X className="h-4 w-4" />
                    ביטול
                  </Button>
                </div>
                <FormLabel>
                  שם העובד
                  <Input
                    required
                    className="mt-1"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    data-testid="employee-name-input"
                  />
                </FormLabel>
                <FormLabel>
                  טלפון
                  <Input
                    type="tel"
                    className="mt-1"
                    placeholder="050-0000000"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </FormLabel>
                <FormLabel>
                  צבע ביומן
                  <Input
                    type="color"
                    className="mt-1 h-11 w-full rounded-xl p-1"
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                  />
                </FormLabel>
                <FormLabel>
                  תמונה (אופציונלי)
                  <Input
                    type="file"
                    accept="image/jpeg,image/png"
                    className="mt-1"
                    onChange={(e) => void handlePhotoFile(e.target.files?.[0] ?? null)}
                  />
                </FormLabel>
                {form.photoUrl ? (
                  <div className="flex items-center gap-3 md:col-span-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={form.photoUrl} alt="תמונת העובד" className="h-12 w-12 rounded-full border object-cover" />
                    <Button variant="secondary" size="sm" type="button" onClick={() => setForm({ ...form, photoUrl: "" })}>
                      הסר תמונה
                    </Button>
                  </div>
                ) : null}
                <Button variant="primary" className="md:col-span-2" type="submit" disabled={saving} data-testid="save-employee-button">
                  {saving ? "שומר..." : editingId ? "עדכן עובד" : "הוסף עובד"}
                </Button>
              </form>
            )}

            {loading ? (
              <p className="text-sm font-semibold text-[#6B7280]">טוען עובדים...</p>
            ) : employees.length === 0 ? (
              <p className="text-sm font-semibold text-[#6B7280]">
                עדיין אין עובדים. הוסף עובד ראשון כדי לנהל יומן נפרד לכל אחד מהצוות.
              </p>
            ) : (
              <ul className="space-y-2" data-testid="employees-list">
                {employees.map((employee) => (
                  <li
                    key={employee.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E7EB] bg-white p-3 shadow-sm"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {employee.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={employee.photoUrl} alt={employee.name} className="h-10 w-10 rounded-full border object-cover" />
                      ) : (
                        <span
                          className="flex h-10 w-10 items-center justify-center rounded-full font-black text-white"
                          style={{ backgroundColor: employee.color || DEFAULT_COLOR }}
                        >
                          {employee.name.slice(0, 1)}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 shrink-0 rounded-full border border-black/10"
                            style={{ backgroundColor: employee.color || DEFAULT_COLOR }}
                          />
                          <span className="font-black text-[#111827]">{employee.name}</span>
                          <StatusBadge tone={employee.isActive ? "success" : "neutral"}>
                            {employee.isActive ? "פעיל" : "מושבת"}
                          </StatusBadge>
                        </div>
                        <div className="text-sm font-semibold text-[#6B7280]">
                          {employee.phone || "ללא טלפון"}
                          {" · "}
                          {employee.workingHours?.length
                            ? `${employee.workingHours.length} ימי עבודה מוגדרים`
                            : "לא הוגדרו שעות עבודה"}
                          {employee.vacations?.length ? ` · ${employee.vacations.length} חופשות` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" type="button" className="!min-h-9 !rounded-xl !px-3" onClick={() => openScheduleEditor(employee)}>
                        שעות וחופשות
                      </Button>
                      <Button variant="secondary" type="button" className="!min-h-9 !rounded-xl !px-3" onClick={() => openEditForm(employee)} aria-label={`עריכת ${employee.name}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="warn" type="button" className="!min-h-9 !rounded-xl !px-3" onClick={() => void toggleActive(employee)}>
                        {employee.isActive ? "השבת" : "הפעל"}
                      </Button>
                      <Button variant="danger" type="button" className="!min-h-9 !rounded-xl !px-3" onClick={() => void deleteEmployee(employee)} aria-label={`מחיקת ${employee.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {scheduleEmployee && (
            <Card data-testid="employee-schedule-card">
              <CardHeader
                title={`שעות עבודה — ${scheduleEmployee.name}`}
                subtitle="תורים ייקבעו רק בתוך שעות העבודה, מחוץ להפסקות ולא בימי חופשה"
                actions={
                  <Button variant="secondary" size="sm" type="button" onClick={() => setScheduleEmployeeId(null)}>
                    <X className="h-4 w-4" />
                    סגור
                  </Button>
                }
              />
              <div className="space-y-2">
                {WEEKDAY_NAMES.map((dayName, dayIndex) => {
                  const day = scheduleDraft[dayIndex]!;
                  return (
                    <div key={dayName} className="rounded-xl border border-[#E5E7EB] bg-white p-3">
                      <div className="flex flex-wrap items-center gap-3">
                        {/* ה-CSS הגלובלי נותן לכל input רוחב מלא וגובה 44px —
                            checkbox חשוף מתנפח ונערם על שם היום. מקבעים גודל
                            checkbox אמיתי ושורה אופקית מיושרת (RTL נשמר מה-dir). */}
                        <label className="flex w-24 shrink-0 cursor-pointer flex-row items-center gap-2 font-bold text-[#111827]">
                          <input
                            type="checkbox"
                            className="h-5 w-5 min-h-0 shrink-0 cursor-pointer p-0 accent-[#1D4ED8]"
                            checked={day.enabled}
                            onChange={(e) => updateDay(dayIndex, { enabled: e.target.checked })}
                          />
                          <span className="whitespace-nowrap">{dayName}</span>
                        </label>
                        {day.enabled ? (
                          <>
                            <Input
                              type="time"
                              className="!min-h-9 max-w-[8rem]"
                              value={day.startTime}
                              onChange={(e) => updateDay(dayIndex, { startTime: e.target.value })}
                              aria-label={`שעת התחלה ${dayName}`}
                            />
                            <span className="text-sm font-semibold text-[#6B7280]">עד</span>
                            <Input
                              type="time"
                              className="!min-h-9 max-w-[8rem]"
                              value={day.endTime}
                              onChange={(e) => updateDay(dayIndex, { endTime: e.target.value })}
                              aria-label={`שעת סיום ${dayName}`}
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              type="button"
                              onClick={() => updateDay(dayIndex, { breaks: [...day.breaks, { start: "12:00", end: "12:30" }] })}
                            >
                              <Plus className="h-4 w-4" />
                              הפסקה
                            </Button>
                          </>
                        ) : (
                          <span className="text-sm font-semibold text-[#6B7280]">יום חופשי</span>
                        )}
                      </div>
                      {day.enabled && day.breaks.length > 0 && (
                        <div className="mt-2 space-y-2">
                          {day.breaks.map((breakItem, breakIndex) => (
                            <div key={breakIndex} className="flex flex-wrap items-center gap-2 pr-6">
                              <span className="text-sm font-semibold text-[#6B7280]">הפסקה:</span>
                              <Input
                                type="time"
                                className="!min-h-9 max-w-[8rem]"
                                value={breakItem.start}
                                onChange={(e) => updateBreak(dayIndex, breakIndex, { start: e.target.value })}
                              />
                              <span className="text-sm font-semibold text-[#6B7280]">עד</span>
                              <Input
                                type="time"
                                className="!min-h-9 max-w-[8rem]"
                                value={breakItem.end}
                                onChange={(e) => updateBreak(dayIndex, breakIndex, { end: e.target.value })}
                              />
                              <Button
                                variant="danger"
                                size="sm"
                                type="button"
                                onClick={() =>
                                  updateDay(dayIndex, { breaks: day.breaks.filter((_, i) => i !== breakIndex) })
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <Button variant="primary" type="button" disabled={savingSchedule} onClick={() => void saveSchedule()} data-testid="save-schedule-button">
                  {savingSchedule ? "שומר..." : "שמור שעות עבודה"}
                </Button>
              </div>

              <div className="mt-6">
                <h3 className="mb-2 text-base font-black text-[#111827]">ימי חופשה</h3>
                {scheduleEmployee.vacations?.length ? (
                  <ul className="mb-3 space-y-2">
                    {scheduleEmployee.vacations.map((vacation) => (
                      <li key={vacation.id} className="flex items-center justify-between rounded-xl border border-[#E5E7EB] bg-white p-3">
                        <span className="font-semibold text-[#111827]">
                          {vacation.startDate === vacation.endDate
                            ? vacation.startDate
                            : `${vacation.startDate} עד ${vacation.endDate}`}
                          {vacation.note ? ` · ${vacation.note}` : ""}
                        </span>
                        <Button variant="danger" size="sm" type="button" onClick={() => void removeVacation(vacation.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mb-3 text-sm font-semibold text-[#6B7280]">אין חופשות מתוכננות.</p>
                )}
                <div className="flex flex-wrap items-end gap-2">
                  <FormLabel>
                    מתאריך
                    <Input
                      type="date"
                      className="mt-1 !min-h-9"
                      value={vacationForm.startDate}
                      onChange={(e) => setVacationForm({ ...vacationForm, startDate: e.target.value })}
                    />
                  </FormLabel>
                  <FormLabel>
                    עד תאריך
                    <Input
                      type="date"
                      className="mt-1 !min-h-9"
                      value={vacationForm.endDate}
                      onChange={(e) => setVacationForm({ ...vacationForm, endDate: e.target.value })}
                    />
                  </FormLabel>
                  <FormLabel className="min-w-40">
                    הערה
                    <Input
                      className="mt-1 !min-h-9"
                      placeholder="אופציונלי"
                      value={vacationForm.note}
                      onChange={(e) => setVacationForm({ ...vacationForm, note: e.target.value })}
                    />
                  </FormLabel>
                  <Button variant="secondary" type="button" disabled={savingVacation} onClick={() => void addVacation()}>
                    {savingVacation ? "שומר..." : "הוסף חופשה"}
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      </AppShell>
    </div>
  );
}
