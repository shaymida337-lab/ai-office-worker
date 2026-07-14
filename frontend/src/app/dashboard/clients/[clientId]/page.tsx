"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";
import { AppointmentDetailsDrawer } from "@/components/calendar/AppointmentDetailsDrawer";
import { appointmentStatusLabel, appointmentStatusTone } from "@/components/crm/crmHelpers";
import { apiFetch } from "@/lib/api";
import { useOrganizationTimezone } from "@/hooks/useOrganizationTimezone";
import {
  clientInitials,
  displayOrFallback,
  displayPhone,
  formatAppointmentPrice,
  formatNextAppointment,
  mailtoHref,
  mapsHref,
  orderClientAppointmentsForTab,
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
import { QUOTE_STATUS_LABELS, type SalesDeal, formatIls } from "@/lib/salesUtils";
import { shellLayout } from "@/components/natalie-ui/tokens";

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

type ClientAppointmentDto = {
  id: string;
  clientId: string;
  startTime: string;
  durationMinutes: number;
  status: string;
  notes: string | null;
  serviceName: string | null;
  employeeName: string | null;
  price?: number | null;
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
    phone?: string | null;
    whatsappNumber: string | null;
    address?: string | null;
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

// לשוניות הכרטיס — כל התוכן שהיה בגלילה אחת ארוכה מחולק ללשוניות.
type TabId = "details" | "appointments" | "documents" | "quotes" | "tasks" | "notes" | "whatsapp";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "details", label: "פרטים" },
  { id: "appointments", label: "פגישות" },
  { id: "documents", label: "מסמכים" },
  { id: "quotes", label: "הצעות מחיר" },
  { id: "tasks", label: "משימות" },
  { id: "notes", label: "הערות" },
  { id: "whatsapp", label: "וואטסאפ" },
];

export default function ClientDetailPage() {
  const params = useParams<{ clientId: string }>();
  const router = useRouter();
  const orgTimezone = useOrganizationTimezone();
  const clientId = params.clientId;
  const [data, setData] = useState<ClientDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [nextAppointment, setNextAppointment] = useState<NextAppointmentDto | null>(null);
  const [nextAppointmentLoaded, setNextAppointmentLoaded] = useState(false);
  const [appointments, setAppointments] = useState<ClientAppointmentDto[]>([]);
  const [appointmentsLoaded, setAppointmentsLoaded] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<ClientAppointmentDto | null>(null);
  const [notes, setNotes] = useState<ClientNoteDto[]>([]);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [whatsappMessages, setWhatsappMessages] = useState<WhatsAppMessage[]>([]);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [clientDeals, setClientDeals] = useState<SalesDeal[]>([]);
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
  const [activeTab, setActiveTab] = useState<TabId>("details");

  async function load() {
    // נתוני הלקוח הם מקור האמת של הכרטיס — מחילים אותם מיד עם קבלתם.
    // כשל של קריאה משנית (משימות/וואטסאפ/חשבוניות/תור/הערות/עסקאות) לא יחסום
    // את רענון הכרטיס, ולא ימחק את המידע המשני הקיים (נשמר על catch->null).
    const next = await apiFetch<ClientDetail>(`/api/clients/${clientId}`);
    setData(next);
    setHealth(next.client.health ?? null);
    setLoadError("");
    setLastUpdatedAt(new Date());

    const [taskResult, whatsappResult, invoiceResult, nextAppt, noteResult, appointmentsResult, dealsResult] = await Promise.all([
      apiFetch<{ tasks: TaskItem[] }>(`/api/clients/${clientId}/tasks`).catch(() => null),
      apiFetch<{ messages: WhatsAppMessage[] }>(`/api/clients/${clientId}/whatsapp`).catch(() => null),
      apiFetch<{ invoices: InvoiceItem[] }>(`/api/clients/${clientId}/invoices`).catch(() => null),
      apiFetch<{ appointment: NextAppointmentDto | null }>(`/api/clients/${clientId}/next-appointment`).catch(() => null),
      apiFetch<{ notes: ClientNoteDto[] }>(`/api/clients/${clientId}/notes`).catch(() => null),
      apiFetch<{ appointments: ClientAppointmentDto[] }>(`/api/clients/${clientId}/appointments`).catch(() => null),
      apiFetch<{ deals: SalesDeal[] }>(`/api/deals`).catch(() => null),
    ]);
    if (taskResult) setTasks(taskResult.tasks);
    if (whatsappResult) setWhatsappMessages(whatsappResult.messages);
    if (invoiceResult) setInvoices(invoiceResult.invoices);
    if (nextAppt) setNextAppointment(nextAppt.appointment);
    setNextAppointmentLoaded(true);
    if (noteResult) setNotes(noteResult.notes);
    if (appointmentsResult) setAppointments(appointmentsResult.appointments);
    setAppointmentsLoaded(true);
    // הצעות מחיר של הלקוח: endpoint קיים של עסקאות, מסונן בצד הלקוח בלבד.
    if (dealsResult) setClientDeals(dealsResult.deals.filter((deal) => deal.clientId === clientId));
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
    if (score <= 40) return { label: "אדום", className: "text-red-500" };
    if (score <= 70) return { label: "צהוב", className: "text-amber-500" };
    return { label: "ירוק", className: "text-emerald-600" };
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
    // שדות העריכה חיים בלשונית "פרטים" בלבד — קופצים אליה מכל לשונית.
    setActiveTab("details");
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
        <Link
          href="/dashboard/clients"
          className="relative z-10 mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-accent-primary transition hover:text-accent-secondary hover:underline"
          data-testid="back-to-clients"
        >
          <span aria-hidden>→</span> חזרה ללקוחות
        </Link>
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
  // מעדיפים whatsappNumber, ונופלים ל-phone. קידומת whatsapp: מנוקה ב-helpers.
  const clientPhone = data.client.phone ?? null;
  const phoneLink = telHref(clientPhone || data.client.whatsappNumber);
  const waLink = whatsappHref(data.client.whatsappNumber || clientPhone);
  // אימייל אמיתי בלבד: אימייל placeholder (שנוצר אוטומטית) נחשב כ"לא הוזן"
  // כדי שהתצוגה, הקישור וכפתור "שלח מייל" יהיו עקביים.
  const emailDisplay = formatClientEmailDisplay(data.client.email);
  const hasRealEmail = emailDisplay !== "לא מוגדר";
  const emailLink = hasRealEmail ? mailtoHref(data.client.email) : null;
  // אין שדה כתובת במודל הלקוח כרגע; הפעולה נדלקת אוטומטית אם כתובת קיימת.
  const clientAddress = data.client.address ?? null;
  const mapLink = mapsHref(clientAddress);
  // מקצוע: מוצג רק אם ה-API מחזיר אותו (אין עדיין שדה במודל).
  const clientProfession = (data.client as { profession?: string | null }).profession ?? null;
  const nextView = nextAppointment ? formatNextAppointment(nextAppointment, orgTimezone) : null;

  const clientQuotes = clientDeals.flatMap((deal) =>
    deal.quotes.map((quote) => ({ ...quote, dealTitle: deal.title, dealId: deal.id }))
  );
  const openQuotesValue = clientQuotes
    .filter((quote) => ["draft", "sent", "viewed"].includes(quote.status))
    .reduce((sum, quote) => sum + quote.total, 0);
  const openBalance = invoices
    .filter((invoice) => invoice.status !== "paid")
    .reduce((sum, invoice) => sum + invoice.amount, 0);
  const paidTotal = invoices
    .filter((invoice) => invoice.status === "paid")
    .reduce((sum, invoice) => sum + invoice.amount, 0);
  const futureAppointmentsCount = appointments.filter(
    (appointment) => new Date(appointment.startTime).getTime() >= Date.now() && appointment.status !== "cancelled"
  ).length;
  const { rows: orderedAppointments, nextAppointmentId } = useMemo(
    () => orderClientAppointmentsForTab(appointments),
    [appointments]
  );
  const openTasksCount = tasks.filter((task) => task.status !== "done").length;

  const tabCounts: Partial<Record<TabId, number>> = {
    appointments: appointments.length,
    documents: invoices.length + data.payments.length,
    quotes: clientQuotes.length,
    tasks: openTasksCount,
    notes: notes.length,
    whatsapp: whatsappMessages.length,
  };

  const summaryCardClass =
    "min-w-0 rounded-2xl border border-[var(--border)] bg-white p-3 text-start shadow-card transition hover:border-accent-primary/50 hover:shadow-glow md:p-4";

  return (
    <div className="container overflow-x-clip" dir="rtl">
      <Nav />

      {/* Header: זהות + פעולות. sticky מתחת ל-GlobalHeader הקבוע (לא top-0)
          כדי שכפתורי חזרה/קשר לא ייחסמו ע"י ה-header העליון. */}
      <header
        className={`sticky ${shellLayout.pageTitleTop} z-30 mb-4 rounded-2xl border border-[var(--border)] bg-white/95 p-4 shadow-card backdrop-blur md:p-5`}
        data-testid="client-card-header"
      >
        <Link
          href="/dashboard/clients"
          className="relative z-10 mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-accent-primary transition hover:text-accent-secondary hover:underline md:min-h-0"
          data-testid="back-to-clients"
        >
          <span aria-hidden>→</span> חזרה ללקוחות
        </Link>
        <div className="relative z-10 flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3 md:gap-4">
            <span
              className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-lg font-bold text-white md:h-14 md:w-14"
              style={{ backgroundColor: data.client.color || "#6366F1" }}
              data-testid="client-initials"
            >
              {clientInitials(data.client.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="!mb-0 break-words text-xl font-bold md:text-2xl" data-testid="client-name">
                  {data.client.name}
                </h1>
                <span
                  className={`badge ${data.client.isActive === false ? "badge-error" : "badge-ok"}`}
                  data-testid="client-status"
                >
                  {data.client.isActive === false ? "לא פעיל" : "פעיל"}
                </span>
                {clientProfession && (
                  <span className="text-sm font-medium text-ink-secondary" data-testid="client-profession">
                    {clientProfession}
                  </span>
                )}
              </div>
              <p className="!mb-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-ink-secondary" data-testid="client-contact">
                <span>
                  📞{" "}
                  {phoneLink ? (
                    <a href={phoneLink} dir="ltr" className="font-semibold text-ink-primary underline">
                      {displayPhone(clientPhone || data.client.whatsappNumber)}
                    </a>
                  ) : (
                    "לא הוזן"
                  )}
                </span>
                <span>
                  ✉️{" "}
                  {emailLink ? (
                    <a href={emailLink} dir="ltr" className="font-semibold text-ink-primary underline" data-testid="contact-email">
                      {emailDisplay}
                    </a>
                  ) : (
                    <span data-testid="contact-email-empty">לא הוזן</span>
                  )}
                </span>
                {clientAddress && (
                  <span>
                    🗺️{" "}
                    <a
                      href={mapLink ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-ink-primary underline"
                      data-testid="contact-address"
                    >
                      {clientAddress}
                    </a>
                  </span>
                )}
                <span className="text-ink-muted">עודכן: {lastUpdatedAt ? relativeTime(lastUpdatedAt) : "טוען..."}</span>
              </p>
            </div>
          </div>

          <div className="relative z-10 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap md:shrink-0" data-testid="client-actions">
            {phoneLink ? (
              <a className="btn" href={phoneLink} data-testid="action-call">
                📞 התקשר
              </a>
            ) : (
              <button className="btn" type="button" disabled aria-disabled="true" title="אין מספר טלפון" data-testid="action-call">
                📞 התקשר
              </button>
            )}
            {waLink ? (
              <a className="btn" href={waLink} target="_blank" rel="noreferrer" data-testid="action-whatsapp">
                💬 WhatsApp
              </a>
            ) : (
              <button className="btn" type="button" disabled aria-disabled="true" title="אין מספר טלפון" data-testid="action-whatsapp">
                💬 WhatsApp
              </button>
            )}
            {emailLink ? (
              <a className="btn" href={emailLink} data-testid="action-email">
                ✉️ מייל
              </a>
            ) : (
              <button className="btn" type="button" disabled aria-disabled="true" title="אין כתובת אימייל" data-testid="action-email">
                ✉️ מייל
              </button>
            )}
            <button
              className="btn btn-secondary"
              type="button"
              data-testid="action-book"
              onClick={() => router.push(`/dashboard/calendar?client=${encodeURIComponent(data.client.id)}`)}
            >
              📅 קבע תור
            </button>
            <button className="btn btn-secondary" type="button" data-testid="action-edit" onClick={startClientEdit}>
              ✏️ עריכה
            </button>
          </div>
        </div>
      </header>

      {/* שורת סיכום: תמונת מצב של הלקוח במבט אחד; לחיצה קופצת ללשונית הרלוונטית */}
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="client-summary">
        <button type="button" className={summaryCardClass} onClick={() => setActiveTab("appointments")} data-testid="summary-next-appointment">
          <span className="stat-label">הפגישה הבאה</span>
          {!nextAppointmentLoaded ? (
            <strong className="mt-1 block text-lg font-bold text-ink-muted">טוען...</strong>
          ) : nextView ? (
            <>
              <strong className="mt-1 block truncate text-lg font-bold text-ink-primary">{nextView.dateLabel}</strong>
              <small className="text-ink-secondary">
                בשעה <span dir="ltr">{nextView.timeLabel}</span> · {nextView.serviceLabel}
              </small>
            </>
          ) : (
            <strong className="mt-1 block text-lg font-bold text-ink-muted">אין תור עתידי</strong>
          )}
        </button>
        <button type="button" className={summaryCardClass} onClick={() => setActiveTab("appointments")} data-testid="summary-appointments">
          <span className="stat-label">פגישות</span>
          <strong className="mt-1 block text-lg font-bold text-ink-primary">{appointments.length}</strong>
          <small className="text-ink-secondary">{futureAppointmentsCount} עתידיות</small>
        </button>
        <button type="button" className={summaryCardClass} onClick={() => setActiveTab("quotes")} data-testid="summary-quotes">
          <span className="stat-label">הצעות מחיר</span>
          <strong className="mt-1 block text-lg font-bold text-ink-primary">{clientQuotes.length}</strong>
          {openQuotesValue > 0 && <small className="text-ink-secondary">{formatIls(openQuotesValue)} ממתין לאישור</small>}
        </button>
        {openBalance > 0 && (
          <button type="button" className={summaryCardClass} onClick={() => setActiveTab("documents")} data-testid="summary-open-balance">
            <span className="stat-label">יתרה פתוחה</span>
            <strong className="mt-1 block text-lg font-bold text-amber-600">₪{openBalance.toLocaleString("he-IL")}</strong>
            <small className="text-ink-secondary">חשבוניות ממתינות / באיחור</small>
          </button>
        )}
      </div>

      {saveNotice && (
        <div className="mb-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-700" data-testid="save-success-notice">
          {saveNotice}
        </div>
      )}
      {message && <div className="mb-4 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-600">{message}</div>}

      {/* לשוניות במקום גלילה ארוכה */}
      <div
        role="tablist"
        aria-label="מידע על הלקוח"
        className="mb-4 flex gap-1 overflow-x-auto rounded-2xl border border-[var(--border)] bg-white p-1 shadow-card"
        data-testid="client-tabs"
      >
        {TABS.map((tab) => {
          const active = tab.id === activeTab;
          const count = tabCounts[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`client-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition ${
                active ? "bg-accent-primary text-white shadow-sm" : "text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"
              }`}
            >
              {tab.label}
              {typeof count === "number" && count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none ${
                    active ? "bg-white/25 text-white" : "bg-surface-hover text-ink-secondary"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ===== לשונית פרטים: תצוגת קריאה בלבד; שדות עריכה רק אחרי "עריכה" ===== */}
      {activeTab === "details" && (
        <div role="tabpanel" data-testid="tab-panel-details">
          {editingClient && clientForm ? (
            <form onSubmit={saveClientProfile} className="card grid gap-3 md:grid-cols-2">
              <h2 className="md:col-span-2">עריכת פרטי לקוח</h2>
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
          ) : (
            <div className="card" data-testid="client-details-view">
              <h2>פרטי הלקוח</h2>
              <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <div>
                  <dt className="stat-label">טלפון</dt>
                  <dd className="font-semibold text-ink-primary">
                    {phoneLink ? (
                      <a href={phoneLink} dir="ltr" className="underline">
                        {displayPhone(clientPhone || data.client.whatsappNumber)}
                      </a>
                    ) : (
                      "לא הוזן"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="stat-label">אימייל</dt>
                  <dd className="break-words font-semibold text-ink-primary">
                    {emailLink ? (
                      <a href={emailLink} dir="ltr" className="underline">
                        {emailDisplay}
                      </a>
                    ) : (
                      "לא הוזן"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="stat-label">וואטסאפ</dt>
                  <dd className="font-semibold text-ink-primary" dir="ltr">
                    {displayPhone(data.client.whatsappNumber)}
                  </dd>
                </div>
                <div>
                  <dt className="stat-label">כתובת</dt>
                  <dd className="font-semibold text-ink-primary">
                    {clientAddress ? (
                      <a href={mapLink ?? "#"} target="_blank" rel="noreferrer" className="underline">
                        {clientAddress} 🗺️
                      </a>
                    ) : (
                      "לא הוזנה"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="stat-label">סטטוס</dt>
                  <dd>
                    <span className={`badge ${data.client.isActive === false ? "badge-error" : "badge-ok"}`}>
                      {data.client.isActive === false ? "לא פעיל" : "פעיל"}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="stat-label">חיבור Gmail</dt>
                  <dd>
                    <span className={`badge ${data.client.gmailConnected ? "badge-ok" : "badge-warn"}`}>
                      {data.client.gmailConnected ? "מחובר" : "לא מחובר"}
                    </span>
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-4">
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
            </div>
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
        </div>
      )}

      {/* ===== לשונית פגישות ===== */}
      {activeTab === "appointments" && (
        <div role="tabpanel" data-testid="tab-panel-appointments">
          <div className="card" data-testid="client-appointments">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="!mb-0 text-base">פגישות</h2>
              <button
                className="btn"
                type="button"
                onClick={() => router.push(`/dashboard/calendar?client=${encodeURIComponent(data.client.id)}`)}
              >
                📅 קבע תור
              </button>
            </div>
            {!appointmentsLoaded ? (
              <p>טוען פגישות...</p>
            ) : orderedAppointments.length === 0 ? (
              <p data-testid="client-appointments-empty">עדיין אין פגישות ללקוח זה</p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]" data-testid="client-appointments-list">
                {orderedAppointments.map((appointment) => {
                  const start = new Date(appointment.startTime);
                  const isNext = appointment.id === nextAppointmentId;
                  const tone = appointmentStatusTone(appointment.status);
                  const statusClass =
                    tone === "success"
                      ? "text-emerald-600"
                      : tone === "danger"
                        ? "text-red-500"
                        : tone === "warn"
                          ? "text-amber-600"
                          : "text-sky-600";
                  const dateLabel = start.toLocaleDateString("he-IL", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    timeZone: orgTimezone,
                  });
                  const timeLabel = start.toLocaleTimeString("he-IL", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                    timeZone: orgTimezone,
                  });
                  return (
                    <li key={appointment.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedAppointment(appointment)}
                        className={`block w-full py-3 text-start transition hover:bg-surface-hover ${
                          appointment.status === "cancelled" ? "opacity-70" : ""
                        }`}
                        data-testid="client-appointment-row"
                        data-next={isNext ? "true" : "false"}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {isNext ? (
                            <span
                              className="rounded-full bg-[#EEF2FF] px-2 py-0.5 text-xs font-black text-[#1E40AF]"
                              data-testid="next-appointment-badge"
                            >
                              הפגישה הבאה
                            </span>
                          ) : null}
                          <span className={`text-sm font-bold ${statusClass}`}>
                            {appointmentStatusLabel(appointment.status)}
                          </span>
                        </div>
                        <div className={`mt-1 grid gap-1 text-sm ${appointment.status === "cancelled" ? "line-through" : ""}`}>
                          <div>
                            <span className="text-ink-secondary">תאריך: </span>
                            <strong>{dateLabel}</strong>
                            <span className="text-ink-secondary"> · שעה: </span>
                            <strong dir="ltr">{timeLabel}</strong>
                          </div>
                          <div>
                            <span className="text-ink-secondary">שירות: </span>
                            <strong>{displayOrFallback(appointment.serviceName)}</strong>
                            <span className="text-ink-secondary"> · עובד: </span>
                            <strong>{appointment.employeeName?.trim() || "בעל העסק"}</strong>
                          </div>
                          <div>
                            <span className="text-ink-secondary">מחיר: </span>
                            <strong>{formatAppointmentPrice(appointment.price)}</strong>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ===== לשונית מסמכים: חשבוניות + תשלומים ומסמכים קודמים ===== */}
      {activeTab === "documents" && (
        <div role="tabpanel" data-testid="tab-panel-documents">
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="!mb-0">חשבוניות</h2>
              <div className="flex flex-wrap gap-2">
                <button className="btn" onClick={scanInvoices} disabled={loading}>
                  {loading ? "סורק..." : "סרוק חשבוניות"}
                </button>
                {data.client.driveFolderUrl && (
                  <a className="btn btn-secondary" href={data.client.driveFolderUrl} target="_blank" rel="noreferrer">
                    פתח דרייב
                  </a>
                )}
                {data.client.invoiceSheetUrl && (
                  <a className="btn btn-secondary" href={data.client.invoiceSheetUrl} target="_blank" rel="noreferrer">
                    פתח שיטס
                  </a>
                )}
              </div>
            </div>
            <p className="mt-3">
              שולם: ₪{paidTotal.toLocaleString("he-IL")} · ממתין: ₪{openBalance.toLocaleString("he-IL")}
            </p>
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
      )}

      {/* ===== לשונית הצעות מחיר ===== */}
      {activeTab === "quotes" && (
        <div role="tabpanel" data-testid="tab-panel-quotes">
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="!mb-0">הצעות מחיר</h2>
              <button className="btn btn-secondary" type="button" onClick={() => router.push("/dashboard/sales")}>
                מעבר למכירות
              </button>
            </div>
            {clientQuotes.length === 0 ? (
              <p className="mt-3" data-testid="client-quotes-empty">
                אין הצעות מחיר ללקוח הזה. אפשר ליצור עסקה והצעת מחיר במסך המכירות.
              </p>
            ) : (
              clientQuotes.map((quote) => (
                <div key={quote.id} className="border-t border-[var(--border)] py-3" data-testid="client-quote-row">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>{quote.dealTitle}</strong>
                    <span className="badge badge-ok">{QUOTE_STATUS_LABELS[quote.status] ?? quote.status}</span>
                  </div>
                  <p>
                    גרסה v{quote.version} · {formatCurrency(quote.total, quote.currency)}
                    {" · נוצרה: "}
                    {new Date(quote.createdAt).toLocaleDateString("he-IL")}
                    {quote.validUntil && ` · בתוקף עד: ${new Date(quote.validUntil).toLocaleDateString("he-IL")}`}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ===== לשונית משימות + הצעות חכמות ===== */}
      {activeTab === "tasks" && (
        <div role="tabpanel" data-testid="tab-panel-tasks">
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
              <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
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
                  <span> · {taskStatusLabels[task.status]}</span>
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
        </div>
      )}

      {/* ===== לשונית הערות ===== */}
      {activeTab === "notes" && (
        <div role="tabpanel" data-testid="tab-panel-notes">
          <div className="card" data-testid="client-notes">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="!mb-0">הערות</h2>
              <button
                className="btn"
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
            {notes.length === 0 ? (
              <p className="mt-3">אין הערות ללקוח הזה עדיין.</p>
            ) : (
              <div className="mt-3">
                {notes.map((note) => (
                  <p key={note.id} className="border-t border-[var(--border-subtle)] py-2">
                    {note.body}
                    <small className="block text-ink-muted">{new Date(note.createdAt).toLocaleDateString("he-IL")}</small>
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== לשונית וואטסאפ ===== */}
      {activeTab === "whatsapp" && (
        <div role="tabpanel" data-testid="tab-panel-whatsapp">
          <div className="card">
            <h2>וואטסאפ</h2>
            <p className="mt-2 text-sm text-ink-secondary">
              השיחה מוצגת מתוך WhatsApp Business. הודעות נכנסות נשמרות אוטומטית, משויכות ללקוח לפי מספר הטלפון, ומופיעות כאן לאחר שהלקוח שולח הודעה.
            </p>
            <div className="mt-4 grid gap-2">
              {whatsappMessages.map((item) => (
                <div
                  key={item.id}
                  className={`w-fit max-w-full rounded-2xl px-4 py-3 text-sm sm:max-w-[75%] ${item.direction === "inbound" ? "justify-self-start rounded-tr-md bg-emerald-400/15 text-emerald-900" : "justify-self-end rounded-tl-md bg-accent-primary/20 text-ink-primary"}`}
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
        </div>
      )}

      {/* לחיצה על פגישה פותחת את חלון פרטי התור הקיים (אותו רכיב כמו ביומן) */}
      <AppointmentDetailsDrawer
        appointment={
          selectedAppointment
            ? {
                id: selectedAppointment.id,
                clientId: selectedAppointment.clientId,
                startTime: selectedAppointment.startTime,
                durationMinutes: selectedAppointment.durationMinutes,
                status: selectedAppointment.status,
                notes: selectedAppointment.notes,
                client: {
                  id: data.client.id,
                  name: data.client.name,
                  whatsappNumber: data.client.whatsappNumber,
                },
                service: selectedAppointment.serviceName ? { name: selectedAppointment.serviceName } : null,
                employee: selectedAppointment.employeeName ? { name: selectedAppointment.employeeName } : null,
              }
            : null
        }
        statusLabel={appointmentStatusLabel}
        statusTone={appointmentStatusTone}
        onClose={() => setSelectedAppointment(null)}
        onEdit={() => router.push("/dashboard/calendar")}
      />
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
