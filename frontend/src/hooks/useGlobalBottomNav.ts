"use client";

import { useMemo } from "react";
import type { BottomNavItem } from "@/components/natalie-ui/BottomNavigation";
import { useI18n } from "@/i18n";

export function useGlobalBottomNav(): BottomNavItem[] {
  const { t } = useI18n();

  return useMemo(
    () => [
      { id: "home", label: t("globalNav.home"), href: "/dashboard" },
      { id: "calendar", label: t("globalNav.calendar"), href: "/dashboard/calendar" },
      { id: "customers", label: t("globalNav.customers"), href: "/crm" },
      { id: "documents", label: t("globalNav.documents"), href: "/dashboard/document-reviews" },
      { id: "tasks", label: t("globalNav.tasks"), href: "/tasks" },
      { id: "natalie", label: t("globalNav.natalie"), href: "/natalie" },
    ],
    [t]
  );
}
