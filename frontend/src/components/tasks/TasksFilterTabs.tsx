"use client";

import { useI18n } from "@/i18n";

export type TaskTab = "active" | "completed";

export function TasksFilterTabs({
  value,
  onChange,
  activeCount,
  completedCount,
}: {
  value: TaskTab;
  onChange: (value: TaskTab) => void;
  activeCount: number;
  completedCount: number;
}) {
  const { t } = useI18n();

  const items: Array<{ id: TaskTab; label: string }> = [
    { id: "active", label: t("tasksDesign.tabActive", { count: String(activeCount) }) },
    { id: "completed", label: t("tasksDesign.tabCompleted", { count: String(completedCount) }) },
  ];

  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("tasksDesign.title")}>
      {items.map((item) => {
        const selected = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.id)}
            className={`min-h-11 rounded-full border px-4 py-2 text-sm font-bold transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] ${
              selected
                ? "border-[#1D4ED8] bg-[#1D4ED8] text-white shadow-sm"
                : "border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-card-bg,#ffffff)] text-[var(--natalie-text-muted,#64748B)] hover:border-[#93C5FD] hover:text-[#1D4ED8]"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
