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

type ClientDetail = {
  client: {
    id: string;
    name: string;
    email: string;
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
  const [form, setForm] = useState(emptyTask);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    const next = await apiFetch<ClientDetail>(`/api/clients/${clientId}`);
    const taskResult = await apiFetch<{ tasks: TaskItem[] }>(`/api/clients/${clientId}/tasks`);
    setData(next);
    setTasks(taskResult.tasks);
    setHealth(next.client.health ?? null);
  }

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : "טעינת לקוח נכשלה"));
    const cached = suggestionCache.get(clientId);
    if (cached) setSuggestions(cached);
  }, [clientId]);

  const healthTone = useMemo(() => {
    const score = health?.score ?? 0;
    if (score <= 40) return { label: "אדום", color: "#dc2626" };
    if (score <= 70) return { label: "צהוב", color: "#ca8a04" };
    return { label: "ירוק", color: "#16a34a" };
  }, [health?.score]);

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
      <h1>
        <span style={{ color: data.client.color ?? "#3B82F6" }}>■</span> {data.client.name}
      </h1>
      <p>gmail: {data.client.email}</p>
      {message && <p style={{ color: "var(--danger)" }}>{message}</p>}

      <div className="card">
        <h2>Health Score</h2>
        <strong style={{ color: healthTone.color, fontSize: "1.8rem" }}>{health?.score ?? 0}/100</strong>
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

      <div style={{ marginBottom: "1rem" }}>
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
        <h2>Tasks</h2>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          Add Task
        </button>
        {showForm && (
          <form onSubmit={saveTask} style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
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
            <div key={task.id} style={{ borderTop: "1px solid var(--border)", padding: "0.75rem 0" }}>
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
          <div key={`${suggestion.title}-${suggestion.priority}`} style={{ borderTop: "1px solid var(--border)", padding: "0.75rem 0" }}>
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
