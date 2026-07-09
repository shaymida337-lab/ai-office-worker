"use client";

import { useEffect, useMemo, useState } from "react";
import {
  TaskListItem,
  TasksEmptyState,
  TasksFilterTabs,
  TasksSearchBar,
  type TaskTab,
} from "@/components/tasks";
import {
  AppShell,
  BottomNavigation,
  Card,
  FloatingActionButton,
  MessageBanner,
  PageTitle,
  SkeletonCard,
} from "@/components/natalie-ui";
import { openNatalieAssistant } from "@/lib/calendar/openNatalieAssistant";
import { useI18n } from "@/i18n";
import { apiFetch, type Task } from "@/lib/api";

const completedStatuses = new Set(["completed", "done"]);

export default function TasksPage() {
  const { t, dir, language } = useI18n();
  const locale = language === "he" ? "he-IL" : "en-US";

  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTab, setActiveTab] = useState<TaskTab>("active");
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const bottomItems = useMemo(
    () => [
      { id: "home", label: t("tasksDesign.nav.home"), href: "/dashboard" },
      { id: "invoices", label: t("tasksDesign.nav.invoices"), href: "/dashboard/invoices" },
      { id: "payments", label: t("tasksDesign.nav.payments"), href: "/payments" },
      { id: "calendar", label: t("tasksDesign.nav.calendar"), href: "/dashboard/calendar" },
    ],
    [t]
  );

  useEffect(() => {
    apiFetch<Task[]>("/api/tasks")
      .then(setTasks)
      .catch((err) => setMessage(err instanceof Error ? err.message : t("tasksDesign.loadError")))
      .finally(() => setLoading(false));
  }, [t]);

  async function complete(id: string) {
    setCompletingIds((prev) => new Set(prev).add(id));
    try {
      await apiFetch(`/api/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      });
      window.setTimeout(() => {
        const completedAt = new Date().toISOString();
        setTasks((prev) =>
          prev.map((task) => (task.id === id ? { ...task, status: "completed", updatedAt: completedAt } : task))
        );
        setCompletingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 450);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("tasksDesign.updateError"));
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
      setTasks((prev) =>
        prev.map((task) => (task.id === id ? { ...task, status: "open", updatedAt: restoredAt } : task))
      );
      setActiveTab("active");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("tasksDesign.restoreError"));
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
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTasks = normalizedQuery
    ? visibleTasks.filter(
        (task) =>
          (task.title ?? "").toLowerCase().includes(normalizedQuery) ||
          (task.supplier ?? "").toLowerCase().includes(normalizedQuery)
      )
    : visibleTasks;

  const formatCompletedDate = (date: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(date));

  return (
    <div dir={dir}>
      <AppShell
        pageTitle={<PageTitle title={t("tasksDesign.title")} subtitle={t("tasksDesign.subtitle")} />}
        bottomNavigation={<BottomNavigation items={bottomItems} />}
        floatingButton={
          <FloatingActionButton
            label={t("tasksDesign.floatingNatalie")}
            onClick={() => openNatalieAssistant("עזרי לי עם המשימות שלי")}
          />
        }
      >
        {message ? <MessageBanner tone="error" className="mb-4">{message}</MessageBanner> : null}

        <Card className="grid gap-5">
          <TasksSearchBar value={query} onChange={setQuery} />
          <TasksFilterTabs
            value={activeTab}
            onChange={setActiveTab}
            activeCount={activeTasks.length}
            completedCount={completedTasks.length}
          />

          {loading ? (
            <SkeletonCard />
          ) : (
            <>
              {filteredTasks.length > 0 ? (
                <ul className="m-0 list-none p-0">
                  {filteredTasks.map((task) => (
                    <TaskListItem
                      key={task.id}
                      task={task}
                      tab={activeTab}
                      isCompleting={completingIds.has(task.id)}
                      isRestoring={restoringIds.has(task.id)}
                      onComplete={complete}
                      onRestore={restore}
                      formatCompletedDate={formatCompletedDate}
                    />
                  ))}
                </ul>
              ) : (
                <TasksEmptyState tab={activeTab} />
              )}
            </>
          )}
        </Card>
      </AppShell>
    </div>
  );
}
