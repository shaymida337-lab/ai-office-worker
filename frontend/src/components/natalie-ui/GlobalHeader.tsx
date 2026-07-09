"use client";

import Link from "next/link";
import { Bell, Globe, Moon, Search, Sun } from "lucide-react";
import { useEffect, useRef } from "react";
import { Logo } from "@/components/Logo";
import { useGlobalHeaderProfile } from "@/hooks/useGlobalHeaderProfile";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";
import { useI18n } from "@/i18n";
import { Button } from "./Button";
import { Input } from "./Input";
import { natalie } from "./tokens";
import { useTheme } from "./ThemeProvider";

function profileInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  return (parts[0]?.[0] ?? "נ").toUpperCase();
}

export function GlobalHeader({
  className = "",
  sidebarOffset = false,
  notificationCount = 0,
  onNotificationsClick,
}: {
  className?: string;
  /** When true, offset header on desktop to align with Nav sidebar (`lg:right-60`). */
  sidebarOffset?: boolean;
  notificationCount?: number;
  onNotificationsClick?: () => void;
}) {
  const { t, language, setLanguage } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const { userName, workspaceName } = useGlobalHeaderProfile();
  const {
    searchInputRef,
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchLoading,
    searchError,
    searchResults,
    loadSearchData,
    openSearchResult,
  } = useGlobalSearch();

  const searchPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!searchOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!searchPanelRef.current?.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [searchOpen, setSearchOpen]);

  const offsetClass = sidebarOffset ? "lg:right-60" : "";

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 border-b border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface,#ffffff)]/95 backdrop-blur ${offsetClass} ${className}`}
    >
      <div
        className="mx-auto flex min-h-16 max-h-[4.5rem] w-full max-w-6xl items-center gap-6 px-4 md:px-6 xl:max-w-7xl"
        style={{ paddingTop: "max(0px, env(safe-area-inset-top))" }}
      >
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center transition-opacity duration-200 hover:opacity-90"
          aria-label={t("globalHeader.home")}
        >
          <Logo size="sm" iconOnly className="sm:hidden" />
          <Logo size="sm" className="hidden sm:flex" />
        </Link>

        <div ref={searchPanelRef} className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setSearchOpen(true);
              void loadSearchData();
            }}
            onFocus={() => {
              setSearchOpen(true);
              void loadSearchData();
            }}
            placeholder={t("globalHeader.searchPlaceholder")}
            className="!min-h-10 !py-2 ps-10"
            aria-label={t("globalHeader.searchPlaceholder")}
          />
          {searchOpen && searchQuery.trim().length >= 2 ? (
            <div className="absolute start-0 end-0 top-[calc(100%+0.35rem)] z-[80] overflow-hidden rounded-2xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-card-bg,#ffffff)] shadow-lg">
              {searchLoading ? <div className="p-4 text-sm text-[var(--natalie-text-muted,#64748B)]">{t("globalHeader.searching")}</div> : null}
              {!searchLoading && searchError ? (
                <div className="p-4 text-sm text-[#DC2626]">{searchError}</div>
              ) : null}
              {!searchLoading && !searchError && searchResults.length === 0 ? (
                <div className="p-4 text-sm text-[var(--natalie-text-muted,#64748B)]">{t("globalHeader.searchEmpty")}</div>
              ) : null}
              {!searchLoading && !searchError
                ? searchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => openSearchResult(result.href)}
                      className="flex w-full items-center justify-between gap-3 border-b border-[var(--natalie-border,#D9E2F2)] px-4 py-3 text-start transition duration-200 last:border-b-0 hover:bg-[var(--natalie-surface-elevated,#F8FAFF)]"
                    >
                      <span className="min-w-0">
                        <span className={`block truncate text-sm font-black ${natalie.title}`}>{result.title}</span>
                        <span className={`mt-0.5 block truncate text-xs ${natalie.subtitle}`}>{result.subtitle}</span>
                      </span>
                      <span className="shrink-0 rounded-full border border-[#93C5FD] bg-[#EFF6FF] px-2.5 py-1 text-xs font-bold text-[#1E40AF]">
                        {result.type}
                      </span>
                    </button>
                  ))
                : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => onNotificationsClick?.()}
            aria-label={t("globalHeader.notifications")}
            className="relative"
          >
            <Bell className="h-4 w-4" />
            {notificationCount > 0 ? (
              <span
                className="absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#DC2626] px-1 text-[10px] font-black text-white"
                aria-hidden
              >
                {notificationCount > 9 ? "9+" : notificationCount}
              </span>
            ) : (
              <span className="absolute end-1.5 top-1.5 h-2 w-2 rounded-full bg-[#DC2626]/80" aria-hidden />
            )}
          </Button>

          <Button variant="ghost" size="sm" type="button" onClick={toggleTheme} aria-label={t("globalHeader.theme")}>
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setLanguage(language === "he" ? "en" : "he")}
            aria-label={t("globalHeader.language")}
          >
            <Globe className="h-4 w-4" />
            <span className="hidden sm:inline">{language === "he" ? "EN" : "עב"}</span>
          </Button>
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-3" aria-label={t("globalHeader.profile")}>
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#2563EB,#1D4ED8)] text-sm font-black text-white shadow-[0_8px_20px_rgba(37,99,235,0.28)]"
            aria-hidden
          >
            {profileInitials(userName)}
          </span>
          <div className="hidden min-w-0 max-w-[9rem] md:block lg:max-w-[11rem]">
            <p className={`truncate text-sm font-black leading-tight ${natalie.title}`}>{userName}</p>
            <p className={`truncate text-xs font-semibold leading-tight ${natalie.subtitle}`}>{workspaceName}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
