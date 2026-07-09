"use client";

import { Button } from "@/components/natalie-ui";
import { useI18n } from "@/i18n";
import type { Task } from "@/lib/api";
import type { TaskTab } from "./TasksFilterTabs";

export function TaskListItem({
  task,
  tab,
  isCompleting,
  isRestoring,
  onComplete,
  onRestore,
  formatCompletedDate,
}: {
  task: Task;
  tab: TaskTab;
  isCompleting: boolean;
  isRestoring: boolean;
  onComplete: (id: string) => void;
  onRestore: (id: string) => void;
  formatCompletedDate: (date: string) => string;
}) {
  const { t } = useI18n();
  const completed = tab === "completed";

  return (
    <li
      className={`grid gap-3 border-b border-[var(--natalie-border,#D9E2F2)] py-4 transition-all duration-300 last:border-b-0 sm:flex sm:flex-wrap sm:items-center sm:justify-between ${
        completed ? "opacity-80" : ""
      } ${
        isCompleting
          ? "scale-[0.98] rounded-xl bg-[#ECFDF5] px-3 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]"
          : ""
      }`}
    >
      <div className="min-w-0">
        <strong
          className={
            completed
              ? "text-sm font-semibold text-[var(--natalie-text-muted,#64748B)] line-through"
              : "text-base font-semibold text-[var(--natalie-text-primary,#0F172A)]"
          }
        >
          {isCompleting ? t("tasksDesign.markingDone") : task.title}
        </strong>
        {task.supplier ? (
          <span className="text-sm text-[var(--natalie-text-muted,#64748B)]"> · {task.supplier}</span>
        ) : null}
        {completed ? (
          <div className="mt-1 text-sm text-[var(--natalie-text-muted,#64748B)]">
            {t("tasksDesign.completedAt")}: {formatCompletedDate(task.updatedAt)}
          </div>
        ) : null}
      </div>
      {tab === "active" ? (
        <Button variant="secondary" size="sm" disabled={isCompleting} onClick={() => onComplete(task.id)}>
          {t("tasksDesign.complete")}
        </Button>
      ) : (
        <Button variant="secondary" size="sm" disabled={isRestoring} onClick={() => onRestore(task.id)}>
          {isRestoring ? t("tasksDesign.restoring") : t("tasksDesign.restore")}
        </Button>
      )}
    </li>
  );
}
