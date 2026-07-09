"use client";

import { EmptyState } from "@/components/natalie-ui";
import { useI18n } from "@/i18n";
import type { TaskTab } from "./TasksFilterTabs";

export function TasksEmptyState({ tab }: { tab: TaskTab }) {
  const { t } = useI18n();

  const title = tab === "active" ? t("tasksDesign.emptyActiveTitle") : t("tasksDesign.emptyCompletedTitle");
  const description =
    tab === "active" ? t("tasksDesign.emptyActiveHint") : t("tasksDesign.emptyCompletedHint");

  return <EmptyState title={title} description={description} />;
}
