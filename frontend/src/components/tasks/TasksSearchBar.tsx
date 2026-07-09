"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/natalie-ui";
import { useI18n } from "@/i18n";

export function TasksSearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();

  return (
    <section aria-label={t("tasksDesign.searchPlaceholder")}>
      <label htmlFor="tasks-search" className="sr-only">
        {t("tasksDesign.searchPlaceholder")}
      </label>
      <div className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-[var(--natalie-card-border,#DBE5F4)] bg-[var(--natalie-card-bg,#ffffff)] px-4 shadow-sm">
        <Search className="h-5 w-5 shrink-0 text-[#1D4ED8]" strokeWidth={2.2} />
        <Input
          id="tasks-search"
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("tasksDesign.searchPlaceholder")}
          className="border-0 bg-transparent px-0 py-3 shadow-none focus:ring-0"
        />
      </div>
    </section>
  );
}
