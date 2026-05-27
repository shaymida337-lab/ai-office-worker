"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch, type Task } from "@/lib/api";

type TaskTab = "active" | "completed";

const completedStatuses = new Set(["completed", "done"]);

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTab, setActiveTab] = useState<TaskTab>("active");
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");

  useEffect(() => {
    apiFetch<Task[]>("/api/tasks")
      .then(setTasks)
      .catch((err) => setMessage(err instanceof Error ? err.message : "טעינת משימות נכשלה"));
  }, []);

  async function complete(id: string) {
    setCompletingIds((prev) => new Set(prev).add(id));
    try {
      await apiFetch(`/api/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      });
      window.setTimeout(() => {
        const completedAt = new Date().toISOString();
        setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, status: "completed", updatedAt: completedAt } : task)));
        setCompletingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 450);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "עדכון המשימה נכשל");
      setCompletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function restore(id: string) {
    setRestoringIds((prev) => new Set(prev).add(id));
    try {
      await apiFetch(`/api/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "open" }),
      });
      const restoredAt = new Date().toISOString();
      setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, status: "open", updatedAt: restoredAt } : task)));
      setActiveTab("active");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שחזור המשימה נכשל");
    } finally {
      setRestoringIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const activeTasks = tasks.filter((task) => !completedStatuses.has(task.status));
  const completedTasks = tasks.filter((task) => completedStatuses.has(task.status));
  const visibleTasks = activeTab === "active" ? activeTasks : completedTasks;

  const formatCompletedDate = (date: string) =>
    new Intl.DateTimeFormat("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(date));

  return (
    <div className="container">
      <Nav />
      <div className="mb-8"><div className="page-kicker">Task inbox</div><h1>משימות מהמייל</h1></div>
      {message && <div className="mb-6 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-base text-red-100">{message}</div>}
      <div className="card">
        <div className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-[var(--border)] bg-surface-hover p-1">
          <button
            type="button"
            onClick={() => setActiveTab("active")}
            className={`rounded-xl px-4 py-2 text-[14px] font-bold transition ${
              activeTab === "active" ? "bg-[#6366F1] text-white shadow-[0_10px_24px_rgba(99,102,241,0.28)]" : "text-[#E2E8F0] hover:bg-surface-card"
            }`}
          >
            משימות פעילות ({activeTasks.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("completed")}
            className={`rounded-xl px-4 py-2 text-[14px] font-bold transition ${
              activeTab === "completed" ? "bg-[#6366F1] text-white shadow-[0_10px_24px_rgba(99,102,241,0.28)]" : "text-[#E2E8F0] hover:bg-surface-card"
            }`}
          >
            בוצעו ✓ ({completedTasks.length})
          </button>
        </div>

        <ul className="m-0 list-none p-0">
          {visibleTasks.map((t) => {
            const isCompleting = completingIds.has(t.id);
            const isRestoring = restoringIds.has(t.id);
            return (
            <li
              key={t.id}
              className={`grid gap-3 border-b border-[var(--border)] py-4 transition-all duration-300 sm:flex sm:flex-wrap sm:items-center sm:justify-between ${
                activeTab === "completed" ? "text-ink-muted opacity-70" : "text-[#E2E8F0]"
              } ${isCompleting ? "scale-[0.98] rounded-xl bg-emerald-500/15 px-3 text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]" : ""}`}
            >
              <div className="min-w-0">
                <strong className={activeTab === "completed" ? "text-[14px] font-semibold text-ink-muted line-through" : "text-[15px] font-semibold text-white"}>
                  {isCompleting ? "✓ בוצע" : t.title}
                </strong>
                {t.supplier && <span className="text-[14px] text-ink-muted"> — {t.supplier}</span>}
                {activeTab === "completed" && <div className="mt-1 text-[13px] text-ink-muted">הושלם: {formatCompletedDate(t.updatedAt)}</div>}
              </div>
              {activeTab === "active" ? (
                <button
                  className="btn btn-secondary"
                  disabled={isCompleting}
                  onClick={() => complete(t.id)}
                >
                  בוצע
                </button>
              ) : (
                <button
                  className="btn btn-secondary"
                  disabled={isRestoring}
                  onClick={() => restore(t.id)}
                >
                  {isRestoring ? "משחזר..." : "שחזר"}
                </button>
              )}
            </li>
          );
          })}
        </ul>
        {visibleTasks.length === 0 && (
          <p className="text-[14px] text-ink-muted">{activeTab === "active" ? "אין משימות פעילות כרגע." : "אין משימות שבוצעו עדיין."}</p>
        )}
      </div>
    </div>
  );
}
