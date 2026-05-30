"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";

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

type ClientDetail = {
  client: {
    id: string;
    name: string;
    email: string;
    whatsappNumber: string | null;
    color: string | null;
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
  const clientId = params.clientId;
  const [data, setData] = useState<ClientDetail | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [whatsappMessages, setWhatsappMessages] = useState<WhatsAppMessage[]>([]);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [whatsappText, setWhatsappText] = useState("");
  const [form, setForm] = useState(emptyTask);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    const next = await apiFetch<ClientDetail>(`/api/clients/${clientId}`);
    const taskResult = await apiFetch<{ tasks: TaskItem[] }>(`/api/clients/${clientId}/tasks`);
    const whatsappResult = await apiFetch<{ messages: WhatsAppMessage[] }>(`/api/clients/${clientId}/whatsapp`);
    const invoiceResult = await apiFetch<{ invoices: InvoiceItem[] }>(`/api/clients/${clientId}/invoices`);
    setData(next);
    setTasks(taskResult.tasks);
    setWhatsappMessages(whatsappResult.messages);
    setInvoices(invoiceResult.invoices);
    setHealth(next.client.health ?? null);
    setLastUpdatedAt(new Date());
  }

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : "טעינת לקוח נכשלה"));
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
      <div className="container">
        <Nav />
        <p>{message || "טוען לקוח..."}</p>
      </div>
    );
  }

  return (
    <div className="container">
      <Nav />
      <div className="mb-8 flex items-start gap-4">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-[linear-gradient(135deg,#6366F1,#8B5CF6)] text-lg font-bold text-white">{data.client.name.slice(0, 2)}</span>
        <div className="min-w-0">
          <div className="page-kicker">מרכז לקוח</div>
          <h1 className="break-words">{data.client.name}</h1>
          <p><strong className="text-emerald-300">● פעיל</strong> · עודכן לאחרונה: {lastUpdatedAt ? relativeTime(lastUpdatedAt) : "טוען..."}</p>
          <p className="break-words">ג׳ימייל: {data.client.email} · וואטסאפ: {data.client.whatsappNumber || "לא מוגדר"}</p>
        </div>
      </div>
      {message && <div className="mb-6 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{message}</div>}

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

function formatCurrency(amount: number, currency: string) {
  const symbols: Record<string, string> = { ILS: "₪", USD: "$", EUR: "€", GBP: "£" };
  return `${symbols[currency] ?? currency} ${amount.toLocaleString("he-IL")}`;
}
