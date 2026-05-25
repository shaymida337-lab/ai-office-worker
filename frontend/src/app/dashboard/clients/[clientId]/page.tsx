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

type ClientWhatsAppStatus = {
  connected: boolean;
  phoneNumber: string | null;
  lastSync: string | null;
  messagesScanned: number;
};

type ClientWhatsAppMessage = {
  id: string;
  from: string;
  to: string | null;
  body: string;
  timestamp: string;
  hasInvoice: boolean;
  hasTask: boolean;
  processed: boolean;
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

export default function ClientDetailPage() {
  const params = useParams<{ clientId: string }>();
  const clientId = params.clientId;
  const [data, setData] = useState<ClientDetail | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [whatsappMessages, setWhatsappMessages] = useState<WhatsAppMessage[]>([]);
  const [clientWhatsAppStatus, setClientWhatsAppStatus] = useState<ClientWhatsAppStatus | null>(null);
  const [clientWhatsAppMessages, setClientWhatsAppMessages] = useState<ClientWhatsAppMessage[]>([]);
  const [clientWhatsAppQr, setClientWhatsAppQr] = useState<string | null>(null);
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
    const clientWhatsApp = await apiFetch<ClientWhatsAppStatus>(`/api/clients/${clientId}/whatsapp/status`);
    const clientWhatsAppMessageResult = await apiFetch<{ messages: ClientWhatsAppMessage[] }>(`/api/clients/${clientId}/whatsapp/messages`);
    setData(next);
    setTasks(taskResult.tasks);
    setWhatsappMessages(whatsappResult.messages);
    setClientWhatsAppStatus(clientWhatsApp);
    setClientWhatsAppMessages(clientWhatsAppMessageResult.messages);
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
      setMessage("Task title is required");
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
      setMessage(err instanceof Error ? err.message : "Could not save task");
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
      setMessage(err instanceof Error ? err.message : "Could not delete task");
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
      setMessage("Could not generate suggestions, try again");
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
      setMessage(err instanceof Error ? err.message : "Failed to send WhatsApp message");
    }
  }

  async function connectClientWhatsApp() {
    setMessage("מכין QR לחיבור WhatsApp...");
    try {
      const result = await apiFetch<{ qrCode?: string; status: string }>(`/api/clients/${clientId}/whatsapp/connect`, { method: "POST" });
      setClientWhatsAppQr(result.qrCode ?? null);
      setMessage(result.status === "connected" ? "WhatsApp מחובר" : "סרוק את ה-QR עם WhatsApp");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "חיבור WhatsApp נכשל");
    }
  }

  async function scanClientWhatsApp() {
    setMessage("סורק היסטוריית WhatsApp...");
    try {
      const result = await apiFetch<{ processed: number }>(`/api/clients/${clientId}/whatsapp/scan`, {
        method: "POST",
        body: JSON.stringify({ daysBack: 30 }),
      });
      setMessage(`נסרקו ${result.processed} הודעות WhatsApp`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "סריקת WhatsApp נכשלה");
    }
  }

  async function disconnectClientWhatsApp() {
    await apiFetch(`/api/clients/${clientId}/whatsapp/disconnect`, { method: "DELETE" });
    setClientWhatsAppQr(null);
    await load();
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
      <div className="mb-8 flex items-center gap-4">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-[linear-gradient(135deg,#6366F1,#8B5CF6)] text-lg font-bold text-white">{data.client.name.slice(0, 2)}</span>
        <div>
          <div className="page-kicker">Client cockpit</div>
          <h1>{data.client.name}</h1>
          <p><strong className="text-emerald-300">● Live</strong> · עודכן לאחרונה: {lastUpdatedAt ? relativeTime(lastUpdatedAt) : "טוען..."}</p>
          <p>gmail: {data.client.email} · WhatsApp: {data.client.whatsappNumber || "לא מוגדר"}</p>
        </div>
      </div>
      {message && <div className="mb-6 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{message}</div>}

      <div className="card">
        <h2>Health Score</h2>
        <strong className={`stat-value block ${healthTone.className}`}>{health?.score ?? 0}/100</strong>
        <p>{healthTone.label}</p>
        <button className="btn btn-secondary" onClick={() => setShowBreakdown((v) => !v)}>
          Breakdown
        </button>
        <button className="btn btn-secondary" onClick={recalculateHealth}>
          Recalculate
        </button>
        {showBreakdown && health && (
          <ul>
            <li>Gmail activity: {health.breakdown.gmailActivity}</li>
            <li>Drive usage: {health.breakdown.driveUsage}</li>
            <li>Sheets data: {health.breakdown.sheetsData}</li>
            <li>Task completion rate: {health.breakdown.taskCompletionRate}</li>
          </ul>
        )}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <button className="btn" onClick={scanClient} disabled={loading}>
          {loading ? "טוען..." : "סרוק"}
        </button>
        {data.client.invoiceSheetUrl && (
          <a className="btn btn-secondary" href={data.client.invoiceSheetUrl} target="_blank" rel="noreferrer">
            פתח Sheets חשבוניות
          </a>
        )}
        {data.client.taskSheetUrl && (
          <a className="btn btn-secondary" href={data.client.taskSheetUrl} target="_blank" rel="noreferrer">
            פתח Sheets משימות
          </a>
        )}
        {data.client.driveFolderUrl && (
          <a className="btn btn-secondary" href={data.client.driveFolderUrl} target="_blank" rel="noreferrer">
            פתח Drive
          </a>
        )}
      </div>

      <div className="card">
        <h2>WhatsApp</h2>
        <div className="mt-4 grid gap-2">
          {whatsappMessages.map((item) => (
            <div
              key={item.id}
              className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm ${item.direction === "inbound" ? "justify-self-start rounded-tr-md bg-emerald-400/15 text-emerald-100" : "justify-self-end rounded-tl-md bg-accent-primary/20 text-ink-primary"}`}
            >
              <div>{item.body}</div>
              {item.aiGenerated && <small>AI reply</small>}
            </div>
          ))}
          {whatsappMessages.length === 0 && <p>No WhatsApp messages yet</p>}
        </div>
        <form onSubmit={sendWhatsAppMessage} className="mt-4 flex gap-2">
          <input
            value={whatsappText}
            onChange={(event) => setWhatsappText(event.target.value)}
            placeholder="Type WhatsApp message"
          />
          <button className="btn" type="submit">
            Send
          </button>
        </form>
      </div>

      <div className="card">
        <h2>WhatsApp אישי של הלקוח</h2>
        <p>סטטוס: {clientWhatsAppStatus?.connected ? "מחובר" : "לא מחובר"}</p>
        <p>נסרקו: {clientWhatsAppStatus?.messagesScanned ?? 0} הודעות</p>
        {clientWhatsAppStatus?.lastSync && <p>סנכרון אחרון: {new Date(clientWhatsAppStatus.lastSync).toLocaleString("he-IL")}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn" onClick={connectClientWhatsApp}>חבר WhatsApp עם QR</button>
          <button className="btn btn-secondary" onClick={scanClientWhatsApp}>סרוק 30 ימים</button>
          <button className="btn btn-secondary" onClick={disconnectClientWhatsApp}>נתק</button>
        </div>
        {clientWhatsAppQr && (
          <div className="mt-4">
            <p>סרוק את הקוד באפליקציית WhatsApp של הלקוח:</p>
            <img src={clientWhatsAppQr} alt="WhatsApp QR" className="mt-3 max-w-[280px] rounded-2xl bg-white p-2" />
          </div>
        )}
        <h3>הודעות שנסרקו</h3>
        {clientWhatsAppMessages.length === 0 ? (
          <p>אין הודעות WhatsApp שנסרקו עדיין</p>
        ) : (
          clientWhatsAppMessages.map((item) => (
            <div key={item.id} className="border-t border-[var(--border)] py-3">
              <strong>{item.from}</strong>
              <p>{item.body}</p>
              <small>
                {new Date(item.timestamp).toLocaleString("he-IL")} · {item.hasInvoice ? "חשבונית" : ""} {item.hasTask ? "משימה" : ""}
              </small>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2>Tasks</h2>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          Add Task
        </button>
        {showForm && (
          <form onSubmit={saveTask} className="mt-4 grid gap-3">
            <input
              placeholder="title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <textarea
              placeholder="description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}>
              <option value="todo">todo</option>
              <option value="in-progress">in-progress</option>
              <option value="done">done</option>
            </select>
            <button className="btn" type="submit" disabled={loading}>
              {editingId ? "Save Changes" : "Create Task"}
            </button>
          </form>
        )}
        {tasks.length === 0 ? (
          <p>No tasks yet</p>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="border-t border-[var(--border)] py-3">
              <strong>{task.title}</strong>
              <p>{task.description}</p>
              <button className="btn btn-secondary" onClick={() => toggleStatus(task)}>
                {task.status}
              </button>
              <span> {task.priority}</span>
              {task.dueDate && <span> · {new Date(task.dueDate).toLocaleDateString("he-IL")}</span>}
              <button className="btn btn-secondary" onClick={() => editTask(task)}>
                Edit
              </button>
              <button className="btn btn-secondary" onClick={() => deleteTask(task.id)}>
                Delete
              </button>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2>AI Suggestions</h2>
        <button className="btn" onClick={generateSuggestions} disabled={suggestionsLoading}>
          {suggestionsLoading ? "Generating..." : "Generate AI Suggestions"}
        </button>
        {suggestions.map((suggestion) => (
          <div key={`${suggestion.title}-${suggestion.priority}`} className="border-t border-[var(--border)] py-3">
            <strong>{suggestion.title}</strong>
            <p>{suggestion.description}</p>
            <span>{suggestion.priority}</span>
            <button className="btn btn-secondary" onClick={() => addSuggestion(suggestion)}>
              Add as Task
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
        {data.client.driveFolderUrl && <a className="btn btn-secondary" href={data.client.driveFolderUrl} target="_blank" rel="noreferrer">פתח Drive</a>}
        {data.client.invoiceSheetUrl && <a className="btn btn-secondary" href={data.client.invoiceSheetUrl} target="_blank" rel="noreferrer">פתח Sheets</a>}
        {invoices.length === 0 ? (
          <p>לא נמצאו חשבוניות</p>
        ) : (
          invoices.map((invoice) => (
            <div key={invoice.id} className="border-t border-[var(--border)] py-3">
              <strong>{invoice.invoiceNumber ?? "ללא מספר"}</strong>
              <p>{new Date(invoice.date).toLocaleDateString("he-IL")} · ₪{invoice.amount.toLocaleString("he-IL")} {invoice.currency} · {invoice.status}</p>
              {invoice.description && <p>{invoice.description}</p>}
              {invoice.driveUrl && <a href={invoice.driveUrl} target="_blank" rel="noreferrer">Drive PDF</a>}
            </div>
          ))
        )}
      </div>
      <div className="card">
        <h2>תשלומים / מסמכים ישנים</h2>
        {data.payments.length === 0 ? (
          <p>אין חשבוניות עדיין.</p>
        ) : (
          data.payments.map((payment) => (
            <p key={payment.id}>
              {payment.supplier} | ₪{payment.amount} | {new Date(payment.date).toLocaleDateString("he-IL")} |{" "}
              {(payment.invoiceLink || payment.documentLink) && (
                <a href={payment.invoiceLink ?? payment.documentLink ?? ""} target="_blank" rel="noreferrer">
                  Drive
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
