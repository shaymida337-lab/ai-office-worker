"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch, type Task } from "@/lib/api";
import { useRouter } from "next/navigation";

export default function TasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    apiFetch<Task[]>("/api/tasks")
      .then(setTasks)
      .catch(() => router.push("/"));
  }, [router]);

  async function complete(id: string) {
    await apiFetch(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "done" }),
    });
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: "done" } : t))
    );
  }

  return (
    <div className="container">
      <Nav />
      <div className="mb-8"><div className="page-kicker">Task inbox</div><h1>משימות מהמייל</h1></div>
      <div className="card">
        <ul className="m-0 list-none p-0">
          {tasks.map((t) => (
            <li
              key={t.id}
              className={`border-b border-[var(--border)] py-3 ${t.status === "done" ? "opacity-50" : ""}`}
            >
              <strong>{t.title}</strong>
              {t.supplier && (
                <span className="text-ink-muted"> — {t.supplier}</span>
              )}
              {t.status !== "done" && (
                <button
                  className="btn btn-secondary mr-4"
                  onClick={() => complete(t.id)}
                >
                  בוצע
                </button>
              )}
            </li>
          ))}
        </ul>
        {tasks.length === 0 && (
          <p>אין משימות עדיין.</p>
        )}
      </div>
    </div>
  );
}
