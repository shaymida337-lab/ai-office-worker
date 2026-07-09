"use client";

import { Bell, Globe, Moon, Search, Sun, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { Button } from "./Button";
import { Input } from "./Input";

export function GlobalToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
}: {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
}) {
  const { language, setLanguage, t } = useI18n();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("natalie-theme");
    const prefersDark = stored === "dark";
    setDark(prefersDark);
    document.documentElement.classList.toggle("dark", prefersDark);
  }, []);

  function toggleDark() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("natalie-theme", next ? "dark" : "light");
  }

  function toggleLanguage() {
    setLanguage(language === "he" ? "en" : "he");
  }

  return (
    <div className="border-b border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface,#ffffff)]/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 md:px-6 xl:max-w-7xl">
        {onSearchChange ? (
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
            <Input
              value={searchValue ?? ""}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder ?? t("globalToolbar.search")}
              className="!min-h-10 !py-2 ps-10"
              aria-label={searchPlaceholder ?? t("globalToolbar.search")}
            />
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <Button variant="ghost" size="sm" type="button" onClick={toggleLanguage} aria-label={t("globalToolbar.language")}>
          <Globe className="h-4 w-4" />
          <span className="hidden sm:inline">{language === "he" ? "EN" : "עב"}</span>
        </Button>
        <Button variant="ghost" size="sm" type="button" onClick={toggleDark} aria-label={t("globalToolbar.theme")}>
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="sm" type="button" aria-label={t("globalToolbar.notifications")}>
          <Bell className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" type="button" aria-label={t("globalToolbar.profile")}>
          <UserRound className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
