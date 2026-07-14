"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";
import { useOrganizationTimezone } from "@/hooks/useOrganizationTimezone";
import {
  clientInitials,
  displayPhone,
  formatNextAppointment,
  mailtoHref,
  mapsHref,
  telHref,
  whatsappHref,
} from "@/lib/clients/clientCard";
import {
  buildClientUpdatePayload,
  clientToFormValues,
  formatClientEmailDisplay,
  type ClientFormValues,
  validateClientForm,
} from "@/lib/clients/clientForm";
import { formatAmount } from "@/lib/format/amount";

type TaskStatus = "todo" | "in-progress" | "done" | "open";
type TaskPriority = "low" | "medium" | "high";

type TaskItem = {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string | null;
};

type HealthScore = {
  score: number;
  status: "good" | "warning" | "risk";
  breakdown: {
    gmailActivity: number;
    driveUsage: number;
    sheetsData: number;
    taskCompletionRate: number;
  };
};

type Suggestion = {
  title: string;
  description: string;
  priority: TaskPriority;
};

type WhatsAppMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  aiGenerated: boolean;
  createdAt: string;
};

type InvoiceItem = {
  id: string;
  invoiceNumber: string | null;
  amount: number;
  currency: string;
  date: string;
  dueDate: string | null;
  status: "paid" | "pending" | "overdue";
  description: string | null;
  driveUrl: string | null;
};

type NextAppointmentDto = {
  id: string;
  startTime: string;
  durationMinutes: number;
  status: string;
  serviceName: string | null;
  employeeName: string | null;
};

type ClientNoteDto = {
  id: string;
  body: string;
  createdAt: string;
};

type ClientDetail = {
  client: {
    id: string;
    name: string;
    email: string | null;
    whatsappNumber: string | null;
    color: string | null;
    isActive?: boolean;
    gmailConnected: boolean;
    invoiceSheetUrl: string | null;
    taskSheetUrl: string | null;
    driveFolderUrl: string | null;
    health?: HealthScore;
  };
  payments: Array<{
    id: string;
    supplier: string;
    amount: number;
    currency: string;
    date: string;
    invoiceLink: string | null;
    documentLink: string | null;
  }>;
  tasks: TaskItem[];
};

const emptyTask = {
  title: "",
  description: "",
  dueDate: "",
  priority: "medium" as TaskPriority,
  status: "todo" as TaskStatus,
};

const suggestionCache = new Map<string, Suggestion[]>();
const taskStatusLabels: Record<TaskStatus, string> = {
  todo: "לביצוע",
  "in-progress": "בתהליך",
  done: "בוצע",
  open: "פתוח",
};
const taskPriorityLabels: Record<TaskPriority, string> = {
  low: "נמוכה",
  medium: "בינונית",
  high: "גבוהה",
};
const invoiceStatusLabels: Record<InvoiceItem["status"], string> = {
  paid: "שולם",
  pending: "ממתין",
  overdue: "באיחור",
};

export default function ClientDetailPage() {
  const params = useParams<{ clientId: string }>();
  const router = useRouter();
  const orgTimezone = useOrganizationTimezone();
  const clientId = params.clientId;
  const [data, setData] = useState<ClientDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [nextAppointment, setNextAppointment] = useState<NextAppointmentDto | null>(null);
  const [nextAppointmentLoaded, setNextAppointmentLoaded] = useState(false);
  const [notes, setNotes] = useState<ClientNoteDto[]>([]);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [whatsappMessages, setWhatsappMessages] = useState<WhatsAppMessage[]>([]);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [whatsappText, setWhatsappText] = useState("");
  const [form, setForm] = useState(emptyTask);
  const [editingClient, setEditingClient] = useState(false);
  const [clientForm, setClientForm] = useState<ClientFormValues | null>(null);
  const [savingClient, setSavingClient] = useState(false);
  // "שמור פרטים": הודעת הצלחה ירוקה שנעלמת לבד אחרי ~2.5 שניות
  const [saveNotice, setSaveNotice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    // נתוני הלקוח הם מקור האמת של הכרטיס — מחילים אותם מיד עם קבלתם.
    // כשל של קריאה משנית (משימות/וואטסאפ/חשבוניות/תור/הערות) לא יחסום
    // את רענון הכרטיס, ולא ימחק את המידע המשני הקיים (נשמר על catch->null).
    const next = await apiFetch<ClientDetail>(`/api/clients/${clientId}`);
    setData(next);
    setHealth(next.client.health ?? null);
    setLoadError("");
    setLastUpdatedAt(new Date());

    const [taskResult, whatsappResult, invoiceResult, nextAppt, noteResult] = await Promise.all([
      apiFetch<{ tasks: TaskItem[] }>(`/api/clients/${clientId}/tasks`).catch(() => null),
      apiFetch<{ messages: WhatsAppMessage[] }>(`/api/clients/${clientId}/whatsapp`).catch(() => null),
      apiFetch<{ invoices: InvoiceItem[] }>(`/api/clients/${clientId}/invoices`).catch(() => null),
      apiFetch<{ appointment: NextAppointmentDto | null }>(`/api/clients/${clientId}/next-appointment`).catch(() => null),
      apiFetch<{ notes: ClientNoteDto[] }>(`/api/clients/${clientId}/notes`).catch(() => null),
    ]);
    if (taskResult) setTasks(taskResult.tasks);
    if (whatsappResult) setWhatsappMessages(whatsappResult.messages);
    if (invoiceResult) setInvoices(invoiceResult.invoices);
    if (nextAppt) setNextAppointment(nextAppt.appointment);
    setNextAppointmentLoaded(true);
    if (noteResult) setNotes(noteResult.notes);
  }

  useEffect(() => {
    load().catch((err) => setLoadError(err instanceof Error ? err.message : "טעינת הלקוח נכשלה — נסה לרענן"));
    const cached = suggestionCache.get(clientId);
    if (cached) setSuggestions(cached);
    const interval = window.setInterval(() => {
      load()
        .catch(() => undefined);
    }, 2 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [clientId]);

  const healthTone = useMemo(() => {
    const score = health?.score ?? 0;
    if (score <= 40) return { label: "אדום", className: "text-red-300" };
    if (score <= 70) return { label: "צהוב", className: "text-amber-300" };
    return { label: "ירוק", className: "text-emerald-300" };
  }, [health?.score]);

  async function scanInvoices() {
    setMessage("");
    setLoading(true);
    try {
      const result = await apiFetch<{ found: number; saved: number; errors: Array<{ error: string }> }>(`/api/clients/${clientId}/scan/invoices`, {
        method: "POST",
      });
      await load();
      setMessage(result.errors.length ? `נשמרו ${result.saved} חשבוניות. שגיאות: ${result.errors.map((item) => item.error).join("; ")}` : `נמצאו ${result.saved} חשבוניות חדשות`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "סריקת חשבוניות נכשלה");
    } finally {
      setLoading(false);
    }
  }
  async function scanClient() {
    setMessage("");
    setLoading(true);
    try {
      const response = await apiFetch<{ result?: { message?: string } }>(`/api/clients/${clientId}/scan`, {
        method: "POST",
      });
      await load();
      setMessage(response.result?.message ?? "הסריקה הסתיימה");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "סריקה נכשלה");
    } finally {
      setLoading(false);
    }
  }

  async function saveTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = form.title.trim();
    if (!title) {
      setMessage("חובה להזין כותרת למשימה");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const body = JSON.stringify({
        title,
        description: form.description.trim() || null,
        dueDate: form.dueDate || null,
        priority: form.priority,
        status: form.status,
      });
      if (editingId) {
        await apiFetch(`/api/tasks/${editingId}`, { method: "PUT", body });
      } else {
        await apiFetch(`/api/clients/${clientId}/tasks`, { method: "POST", body });
      }
      setForm(emptyTask);
      setEditingId(null);
      setShowForm(false);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שמירת המשימה נכשלה");
    } finally {
      setLoading(false);
    }
  }

  function editTask(task: TaskItem) {
    setEditingId(task.id);
    setForm({
      title: task.title,
      description: task.description ?? "",
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : "",
      priority: task.priority,
      status: task.status,
    });
    setShowForm(true);
  }

  async function deleteTask(taskId: string) {
    setLoading(true);
    setMessage("");
    try {
      await apiFetch(`/api/tasks/${taskId}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "מחיקת המשימה נכשלה");
    } finally {
      setLoading(false);
    }
  }

  async function toggleStatus(task: TaskItem) {
    const order: TaskStatus[] = ["todo", "in-progress", "done"];
    const current = task.status === "open" ? "todo" : task.status;
    const status = order[(order.indexOf(current) + 1) % order.length];
    await apiFetch(`/api/tasks/${task.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...task, status }),
    });
    await load();
  }

  async function generateSuggestions() {
    setSuggestionsLoading(true);
    setMessage("");
    try {
      const response = await apiFetch<{ suggestions: Suggestion[] }>(`/api/clients/${clientId}/ai-suggestions`, {
        method: "POST",
      });
      const next = response.suggestions.slice(0, 5);
      suggestionCache.set(clientId, next);
      setSuggestions(next);
    } catch {
      setMessage("יצירת הצעות נכשלה, נסה שוב");
    } finally {
      setSuggestionsLoading(false);
    }
  }

  async function addSuggestion(suggestion: Suggestion) {
    await apiFetch(`/api/clients/${clientId}/tasks`, {
      method: "POST",
      body: JSON.stringify({
        title: suggestion.title,
        description: suggestion.description,
        priority: suggestion.priority,
        status: "todo",
      }),
    });
    await load();
  }

  async function recalculateHealth() {
    const next = await apiFetch<HealthScore>(`/api/clients/${clientId}/health-score/recalculate`, {
      method: "POST",
    });
    setHealth(next);
  }

  async function saveNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!noteText.trim()) {
      setMessage("הערה ריקה — יש לכתוב תוכן");
      return;
    }
    setSavingNote(true);
    setMessage("");
    try {
      await apiFetch(`/api/clients/${clientId}/notes`, {
        method: "POST",
        body: JSON.stringify({ body: noteText.trim() }),
      });
      setNoteText("");
      setShowNoteForm(false);
      const noteResult = await apiFetch<{ notes: ClientNoteDto[] }>(`/api/clients/${clientId}/notes`);
      setNotes(noteResult.notes);
      setMessage("ההערה נשמרה");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שמירת ההערה נכשלה");
    } finally {
      setSavingNote(false);
    }
  }

  async function saveClientProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientForm || savingClient) return; // מניעת שליחה כפולה גם מ-Enter
    const validation = validateClientForm(clientForm);
    if (!validation.ok) {
      setMessage(validation.error);
      return;
    }
    setSavingClient(true);
    setMessage("");
    try {
      // עדכון אופטימי מיידי מתגובת השרת — מקור האמת של הכרטיס מתעדכן מיד,
      // ללא תלות ברענון המשני שאחריו (שעלול להיכשל על endpoint משני).
      const saved = await apiFetch<{ client: Partial<ClientDetail["client"]> }>(`/api/clients/${clientId}`, {
        method: "PUT",
        body: JSON.stringify(buildClientUpdatePayload(clientForm)),
      });
      if (saved?.client) {
        setData((prev) => (prev ? { ...prev, client: { ...prev.client, ...saved.client } } : prev));
      }
      // הכרטיס נשאר פתוח אחרי שמירה — נסגר רק בלחיצה על ✕
      setSaveNotice("הפרטים נשמרו בהצלחה");
      window.setTimeout(() => setSaveNotice(""), 2500);
      // רענון מלא לסנכרון שאר החלקים; כשל שלו לא מבטל את העדכון האופטימי
      await load().catch(() => undefined);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שמירת פרטי הלקוח נכשלה — נסה שוב");
    } finally {
      setSavingClient(false);
    }
  }

  function startClientEdit() {
    if (!data) return;
    setClientForm(clientToFormValues(data.client));
    setEditingClient(true);
  }

  async function sendWhatsAppMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = whatsappText.trim();
    if (!body) return;
    setMessage("");
    try {
      await apiFetch(`/api/clients/${clientId}/whatsapp/send`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setWhatsappText("");
      const result = await apiFetch<{ messages: WhatsAppMessage[] }>(`/api/clients/${clientId}/whatsapp`);
      setWhatsappMessages(result.messages);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שליחת הודעת וואטסאפ נכשלה");
    }
  }

  if (!data) {
    return (
      <div className="container" dir="rtl">
        <Nav />
        {loadError ? (
          <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-red-200" data-testid="client-card-error">
            {loadError}
          </div>
        ) : (
          <p data-testid="client-card-loading">טוען את כרטיס הלקוח...</p>
        )}
      </div>
    );
  }

  // טלפון: מעדיפים את שדה phone הייעודי, ונופלים ל-whatsappNumber. WhatsApp:
  // מעדיפים whatsappNumber, ונופלים ל-phone.
  const clientPhone = (data.client as { phone?: string | null }).phone ?? null;
  const phoneLink = telHref(clientPhone || data.client.whatsappNumber);
  const waLink = whatsappHref(data.client.whatsappNumber || clientPhone);
  // אימייל אמיתי בלבד: אימייל placeholder (שנוצר אוטומטית) נחשב כ"לא הוזן"
  // כדי שהתצוגה, הקישור וכפתור "שלח מייל" יהיו עקביים.
  const emailDisplay = formatClientEmailDisplay(data.client.email);
  const hasRealEmail = emailDisplay !== "לא מוגדר";
  const emailLink = hasRealEmail ? mailtoHref(data.client.email) : null;
  // אין שדה כתובת במודל הלקוח כרגע; הפעולה נדלקת אוטומטית אם כתובת קיימת.
  const clientAddress = (data.client as { address?: string | null }).address ?? null;
  const mapLink = mapsHref(clientAddress);
  const nextView = nextAppointment ? formatNextAppointment(nextAppointment, orgTimezone) : null;

  return (
    <div className="container" dir="rtl">
      <Nav />
      <div className="card mb-6" data-testid="client-card-header">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span
            className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-lg font-bold text-white"
            style={{ backgroundColor: data.client.color || "#6366F1" }}
            data-testid="client-initials"
          >
            {clientInitials(data.client.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="page-kicker">כרטיס לקוח</div>
            <h1 className="break-words" data-testid="client-name">{data.client.name}</h1>
            <p>
              <strong className={data.client.isActive === false ? "text-red-300" : "text-emerald-300"}>
                ● {data.client.isActive === false ? "לא פעיל" : "פעיל"}
              </strong>
              {" · עודכן: "}
              {lastUpdatedAt ? relativeTime(lastUpdatedAt) : "טוען..."}
            </p>
            <p className="break-words" data-testid="client-contact">
              טלפון:{" "}
              {phoneLink ? (
                <a href={phoneLink} dir="ltr" className="font-bold underline">
                  {displayPhone(clientPhone || data.client.whatsappNumber)}
                </a>
              ) : (
                "לא הוזן"
              )}
              {" · אימייל: "}
              {emailLink ? (
                <a href={emailLink} dir="ltr" className="font-bold underline" data-testid="contact-email">
                  {emailDisplay}
                </a>
              ) : (
                <span data-testid="contact-email-empty">לא הוזן</span>
              )}
              {clientAddress ? (
                <>
                  {" · כתובת: "}
                  <a
                    href={mapLink ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="font-bold underline"
                    data-testid="contact-address"
                  >
                    {clientAddress}
                  </a>
                </>
              ) : null}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" data-testid="client-actions">
          {phoneLink ? (
            <a className="btn" href={phoneLink} data-testid="action-call">📞 חיוג</a>
          ) : (
            <button className="btn" type="button" disabled title="אין מספר טלפון">📞 חיוג</button>
          )}
          {waLink ? (
            <a className="btn" href={waLink} target="_blank" rel="noreferrer" data-testid="action-whatsapp">
              💬 WhatsApp
            </a>
          ) : (
            <button className="btn" type="button" disabled title="אין מספר טלפון">💬 WhatsApp</button>
          )}
          {emailLink ? (
            <a className="btn" href={emailLink} data-testid="action-email">✉️ שלח מייל</a>
          ) : (
            <button className="btn" type="button" disabled title="אין כתובת אימייל">✉️ שלח מייל</button>
          )}
          {mapLink ? (
            <a className="btn" href={mapLink} target="_blank" rel="noreferrer" data-testid="action-navigate">🗺️ ניווט</a>
          ) : (
            <button className="btn" type="button" disabled title="אין כתובת">🗺️ ניווט</button>
          )}
          <button
            className="btn"
            type="button"
            data-testid="action-book"
            onClick={() => router.push(`/dashboard/calendar?client=${encodeURIComponent(data.client.id)}`)}
          >
            📅 קבע תור
          </button>
          <button className="btn btn-secondary" type="button" data-testid="action-edit" onClick={startClientEdit}>
            ✏️ ערוך לקוח
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            data-testid="action-add-note"
            onClick={() => setShowNoteForm((value) => !value)}
          >
            📝 הוסף הערה
          </button>
        </div>

        {showNoteForm && (
          <form onSubmit={saveNote} className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]" data-testid="note-form">
            <input
              placeholder="למשל: מעדיפה תורים בבוקר"
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              maxLength={2000}
            />
            <button className="btn" type="submit" disabled={savingNote}>
              {savingNote ? "שומר..." : "שמור הערה"}
            </button>
          </form>
        )}

        <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4" data-testid="next-appointment">
          <h2 className="text-base">התור הבא</h2>
          {!nextAppointmentLoaded ? (
            <p>טוען את התור הבא...</p>
          ) : nextView ? (
            <p data-testid="next-appointment-details">
              <strong>{nextView.dateLabel}</strong> בשעה <strong dir="ltr">{nextView.timeLabel}</strong>
              {" · שירות: "}
              {nextView.serviceLabel}
              {" · אצל: "}
              {nextView.employeeLabel}
            </p>
          ) : (
            <p data-testid="next-appointment-empty">אין תור עתידי. אפשר לקבוע תור חדש בלחיצה על "קבע תור".</p>
          )}
        </div>

        {notes.length > 0 && (
          <div className="mt-4" data-testid="client-notes">
            <h2 className="text-base">הערות אחרונות</h2>
            {notes.slice(0, 5).map((note) => (
              <p key={note.id} className="border-t border-[var(--border-subtle)] py-2">
                {note.body}
                <small className="block text-ink-muted">{new Date(note.createdAt).toLocaleDateString("he-IL")}</small>
              </p>
            ))}
          </div>
        )}
      </div>
      {saveNotice && (
        <div className="mb-6 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-200" data-testid="save-success-notice">
          {saveNotice}
        </div>
      )}
      {message && <div className="mb-6 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{message}</div>}

      {editingClient && clientForm && (
        <form onSubmit={saveClientProfile} className="card mb-6 grid gap-3 md:grid-cols-2">
          <label>
            שם לקוח
            <input
              required
              value={clientForm.name}
              onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
            />
          </label>
          <label>
            אימייל (אופציונלי)
            <input
              dir="ltr"
              type="email"
              value={clientForm.email}
              onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })}
            />
          </label>
          <label>
            וואטסאפ
            <input
              dir="ltr"
              value={clientForm.whatsappNumber}
              onChange={(e) => setClientForm({ ...clientForm, whatsappNumber: e.target.value })}
            />
          </label>
          <div className="flex gap-2 md:col-span-2">
            <button className="btn" type="submit" disabled={savingClient}>
              {savingClient ? "שומר..." : "שמור פרטים"}
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              aria-label="סגור את כרטיס העריכה"
              data-testid="close-edit-card"
              onClick={() => setEditingClient(false)}
            >
              ✕ סגור
            </button>
          </div>
        </form>
      )}

      <div className="card">
        <h2>ציון בריאות לקוח</h2>
        <strong className={`stat-value block ${healthTone.className}`}>{health?.score ?? 0}/100</strong>
        <p>{healthTone.label}</p>
        <button className="btn btn-secondary" onClick={() => setShowBreakdown((v) => !v)}>
          פירוט
        </button>
        <button className="btn btn-secondary" onClick={recalculateHealth}>
          חשב מחדש
        </button>
        {showBreakdown && health && (
          <ul>
            <li>פעילות ג׳ימייל: {health.breakdown.gmailActivity}</li>
            <li>שימוש בדרייב: {health.breakdown.driveUsage}</li>
            <li>נתוני שיטס: {health.breakdown.sheetsData}</li>
            <li>שיעור השלמת משימות: {health.breakdown.taskCompletionRate}</li>
          </ul>
        )}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <button className="btn" onClick={scanClient} disabled={loading}>
          {loading ? "טוען..." : "סרוק נתוני לקוח"}
        </button>
        {data.client.invoiceSheetUrl && (
          <a className="btn btn-secondary" href={data.client.invoiceSheetUrl} target="_blank" rel="noreferrer">
            פתח שיטס חשבוניות
          </a>
        )}
        {data.client.taskSheetUrl && (
          <a className="btn btn-secondary" href={data.client.taskSheetUrl} target="_blank" rel="noreferrer">
            פתח שיטס משימות
          </a>
        )}
        {data.client.driveFolderUrl && (
          <a className="btn btn-secondary" href={data.client.driveFolderUrl} target="_blank" rel="noreferrer">
            פתח דרייב
          </a>
        )}
      </div>

      <div className="card">
        <h2>וואטסאפ</h2>
        <p className="mt-2 text-sm text-ink-secondary">
          השיחה מוצגת מתוך WhatsApp Business. הודעות נכנסות נשמרות אוטומטית, משויכות ללקוח לפי מספר הטלפון, ומופיעות כאן לאחר שהלקוח שולח הודעה.
        </p>
        <div className="mt-4 grid gap-2">
          {whatsappMessages.map((item) => (
            <div
              key={item.id}
              className={`w-fit max-w-full rounded-2xl px-4 py-3 text-sm sm:max-w-[75%] ${item.direction === "inbound" ? "justify-self-start rounded-tr-md bg-emerald-400/15 text-emerald-100" : "justify-self-end rounded-tl-md bg-accent-primary/20 text-ink-primary"}`}
            >
              <div>{item.body}</div>
              <small className="mt-1 block text-ink-muted">
                {item.direction === "inbound" ? "התקבל מהלקוח" : item.aiGenerated ? "מענה חכם" : "נשלח מהמערכת"} · {new Date(item.createdAt).toLocaleString("he-IL")}
              </small>
            </div>
          ))}
          {whatsappMessages.length === 0 && (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
              <p>עדיין אין הודעות וואטסאפ ללקוח הזה. ודא שמספר הוואטסאפ שמור בכרטיס הלקוח, ואז שלח הודעת בדיקה או בקש מהלקוח לשלוח הודעה.</p>
            </div>
          )}
        </div>
        <form onSubmit={sendWhatsAppMessage} className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            value={whatsappText}
            onChange={(event) => setWhatsappText(event.target.value)}
            placeholder="כתוב הודעת וואטסאפ"
          />
          <button className="btn" type="submit">
            שלח
          </button>
        </form>
      </div>

      <div className="card">
        <h2>משימות</h2>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          הוסף משימה
        </button>
        {showForm && (
          <form onSubmit={saveTask} className="mt-4 grid gap-3">
            <input
              placeholder="כותרת"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <textarea
              placeholder="תיאור"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
              <option value="low">נמוכה</option>
              <option value="medium">בינונית</option>
              <option value="high">גבוהה</option>
            </select>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}>
              <option value="todo">לביצוע</option>
              <option value="in-progress">בתהליך</option>
              <option value="done">בוצע</option>
            </select>
            <button className="btn" type="submit" disabled={loading}>
              {editingId ? "שמור שינויים" : "צור משימה"}
            </button>
          </form>
        )}
        {tasks.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
            <p>אין משימות ללקוח הזה. אפשר להוסיף משימה ידנית או ליצור הצעות חכמות.</p>
          </div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="border-t border-[var(--border)] py-3">
              <strong>{task.title}</strong>
              <p>{task.description}</p>
              <button className="btn btn-secondary" onClick={() => toggleStatus(task)}>
                {nextTaskStatusAction(task.status)}
              </button>
              <span> {taskPriorityLabels[task.priority]}</span>
              {task.dueDate && <span> · {new Date(task.dueDate).toLocaleDateString("he-IL")}</span>}
              <button className="btn btn-secondary" onClick={() => editTask(task)}>
                ערוך
              </button>
              <button className="btn btn-secondary" onClick={() => deleteTask(task.id)}>
                מחק משימה
              </button>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2>הצעות חכמות</h2>
        <button className="btn" onClick={generateSuggestions} disabled={suggestionsLoading}>
          {suggestionsLoading ? "מייצר..." : "צור הצעות חכמות"}
        </button>
        {suggestions.map((suggestion) => (
          <div key={`${suggestion.title}-${suggestion.priority}`} className="border-t border-[var(--border)] py-3">
            <strong>{suggestion.title}</strong>
            <p>{suggestion.description}</p>
            <span>{taskPriorityLabels[suggestion.priority]}</span>
            <button className="btn btn-secondary" onClick={() => addSuggestion(suggestion)}>
              הוסף כמשימה
            </button>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>חשבוניות</h2>
        <button className="btn" onClick={scanInvoices} disabled={loading}>
          {loading ? "סורק..." : "סרוק חשבוניות"}
        </button>
        <p>
          שולם: ₪{invoices.filter((invoice) => invoice.status === "paid").reduce((sum, invoice) => sum + invoice.amount, 0).toLocaleString("he-IL")} · ממתין: ₪{invoices.filter((invoice) => invoice.status !== "paid").reduce((sum, invoice) => sum + invoice.amount, 0).toLocaleString("he-IL")}
        </p>
        {data.client.driveFolderUrl && <a className="btn btn-secondary" href={data.client.driveFolderUrl} target="_blank" rel="noreferrer">פתח דרייב</a>}
        {data.client.invoiceSheetUrl && <a className="btn btn-secondary" href={data.client.invoiceSheetUrl} target="_blank" rel="noreferrer">פתח שיטס</a>}
        {invoices.length === 0 ? (
          <p>לא נמצאו חשבוניות ללקוח. אפשר לסרוק חשבוניות או לפתוח את תיקיית הדרייב אם היא מחוברת.</p>
        ) : (
          invoices.map((invoice) => (
            <div key={invoice.id} className="border-t border-[var(--border)] py-3">
              <strong>{invoice.invoiceNumber ?? "ללא מספר"}</strong>
              <p>{new Date(invoice.date).toLocaleDateString("he-IL")} · {formatCurrency(invoice.amount, invoice.currency)} · {invoiceStatusLabels[invoice.status]}</p>
              {invoice.description && <p>{invoice.description}</p>}
              {invoice.driveUrl && <a href={invoice.driveUrl} target="_blank" rel="noreferrer">פתח קובץ בדרייב</a>}
            </div>
          ))
        )}
      </div>
      <div className="card">
        <h2>תשלומים ומסמכים קודמים</h2>
        {data.payments.length === 0 ? (
          <p>אין תשלומים או מסמכים קודמים להצגה.</p>
        ) : (
          data.payments.map((payment) => (
            <p key={payment.id}>
              {payment.supplier} · ₪{payment.amount} · {new Date(payment.date).toLocaleDateString("he-IL")}{" "}
              {(payment.invoiceLink || payment.documentLink) && (
                <a href={payment.invoiceLink ?? payment.documentLink ?? ""} target="_blank" rel="noreferrer">
                  פתח בדרייב
                </a>
              )}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

function relativeTime(date: Date) {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes === 0) return "עכשיו";
  if (minutes === 1) return "לפני דקה";
  return `לפני ${minutes} דקות`;
}

function nextTaskStatusAction(status: TaskStatus) {
  if (status === "todo" || status === "open") return "העבר לתהליך";
  if (status === "in-progress") return "סמן כבוצע";
  return "פתח מחדש";
}

function formatCurrency(amount: number | null | undefined, currency: string) {
  return formatAmount(amount, currency, "סכום חסר");
}
