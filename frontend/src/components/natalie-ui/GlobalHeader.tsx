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
import { natalie, shellLayout } from "./tokens";
import { useTheme } from "./ThemeProvider";

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
      style={{ paddingTop: "max(0px, env(safe-area-inset-top))" }}
    >
      <div
        className={`${shellLayout.contentMaxWidth} grid h-[4.5rem] grid-cols-[minmax(0,1fr)_min(100%,28rem)_minmax(0,1fr)] items-center ${shellLayout.contentPaddingX}`}
      >
        <div className="flex min-w-0 items-center gap-3 pe-1 sm:pe-0">
          <Link
            href="/dashboard"
            className="flex shrink-0 items-center transition-opacity duration-200 hover:opacity-90"
            aria-label={t("globalHeader.home")}
          >
            <Logo size="sm" iconOnly className="sm:hidden" />
            <Logo size="sm" className="hidden sm:flex" />
          </Link>
          <div className="hidden min-w-0 sm:block" aria-label={t("globalHeader.profile")}>
            <p className={`truncate text-sm font-black leading-tight ${natalie.title}`}>{workspaceName}</p>
            <p className={`truncate text-xs font-semibold leading-tight ${natalie.subtitle}`}>{userName}</p>
          </div>
        </div>

        <div ref={searchPanelRef} className={`relative justify-self-center ${shellLayout.searchWidth} px-2`}>
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
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
            <div className="absolute start-0 end-0 top-[calc(100%+0.5rem)] z-[80] overflow-hidden rounded-2xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-card-bg,#ffffff)] shadow-lg">
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

        <div className="flex shrink-0 items-center justify-end gap-2 ps-1 sm:ps-0">
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
      </div>
    </header>
  );
}
