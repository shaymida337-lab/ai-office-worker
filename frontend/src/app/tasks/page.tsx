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
      <h1>משימות מהמייל</h1>
      <Nav />
      <div className="card">
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {tasks.map((t) => (
            <li
              key={t.id}
              style={{
                padding: "0.75rem 0",
                borderBottom: "1px solid #2a3548",
                opacity: t.status === "done" ? 0.5 : 1,
              }}
            >
              <strong>{t.title}</strong>
              {t.supplier && (
                <span style={{ color: "var(--muted)" }}> — {t.supplier}</span>
              )}
              {t.status !== "done" && (
                <button
                  className="btn btn-secondary"
                  style={{ marginRight: "1rem" }}
                  onClick={() => complete(t.id)}
                >
                  בוצע
                </button>
              )}
            </li>
          ))}
        </ul>
        {tasks.length === 0 && (
          <p style={{ color: "var(--muted)" }}>אין משימות עדיין.</p>
        )}
      </div>
    </div>
  );
}
