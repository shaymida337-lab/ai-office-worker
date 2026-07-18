"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, Bot, CalendarDays, FileText, Home, ListChecks, LogOut, LifeBuoy, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import { clearAllAuthTokens } from "@/lib/api";
import { prefetchCrm } from "@/lib/crm/prefetchCrm";
import { shellLayout } from "./tokens";

export type BottomNavItem = {
  id: string;
  label: string;
  href: string;
};

const navIcons: Record<string, LucideIcon> = {
  home: Home,
  calendar: CalendarDays,
  customers: Users,
  documents: FileText,
  tasks: ListChecks,
  natalie: Bot,
};

function isBottomNavActive(pathname: string, item: BottomNavItem) {
  if (item.id === "home") return pathname === "/dashboard";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function BottomNavigation({ items }: { items: BottomNavItem[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreItems = useMemo(
    () => [
      { id: "invoices", label: t("globalNav.invoices"), href: "/dashboard/invoices" },
      { id: "payments", label: t("globalNav.payments"), href: "/payments" },
      { id: "reports", label: t("globalNav.reports"), href: "/reports" },
      { id: "settings", label: t("globalNav.settings"), href: "/dashboard/settings" },
      { id: "integrations", label: t("globalNav.integrations"), href: "/dashboard/settings?tab=integrations" },
    ],
    [t]
  );
  const moreActive = moreItems.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Warm /crm + /api/leads while the user is on home/other screens (CRM-only).
  useEffect(() => {
    if (pathname === "/crm") return;
    const timer = window.setTimeout(() => prefetchCrm(router), 400);
    return () => window.clearTimeout(timer);
  }, [pathname, router]);

  return (
    <>
      {moreOpen ? (
        <div className="fixed inset-0 z-[60] bg-[#0f172a]/35 backdrop-blur-sm" onClick={() => setMoreOpen(false)}>
          <div
            className={`${shellLayout.contentMaxWidth} absolute bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px)+0.5rem)] left-2 right-2 max-h-[55vh] overflow-y-auto rounded-2xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface,#ffffff)] p-3 shadow-[0_16px_40px_rgba(15,23,42,0.16)]`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-black text-[#0f172a] dark:text-[#F1F5F9]">{t("globalNav.more")}</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#dbe5f4] bg-white text-[#64748B] dark:border-[#1F2A44] dark:bg-[#111827]"
                aria-label={t("globalNav.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {moreItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                      active
                        ? "border-[#93C5FD] bg-[#DBEAFE] text-[#1D4ED8]"
                        : "border-[#e2e8f0] bg-[#f8fafc] text-[#334155] hover:bg-[#eef2ff] dark:border-[#1F2A44] dark:bg-[#0F172A] dark:text-[#CBD5E1] dark:hover:bg-[#1E293B]"
                    }`}
                    onClick={() => setMoreOpen(false)}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <button
                type="button"
                className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-start text-sm font-semibold text-[#334155] transition hover:bg-[#eef2ff] dark:border-[#1F2A44] dark:bg-[#0F172A] dark:text-[#CBD5E1] dark:hover:bg-[#1E293B]"
                onClick={() => {
                  setMoreOpen(false);
                  window.dispatchEvent(new Event("open-help-center"));
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <LifeBuoy className="h-4 w-4 shrink-0" aria-hidden />
                  עזרה
                </span>
              </button>
              <button
                type="button"
                className="rounded-xl border border-[rgba(185,28,28,0.35)] bg-[#FEF2F2] px-3 py-2 text-start text-sm font-semibold text-[#7F1D1D] transition hover:bg-[#FEE2E2]"
                onClick={() => {
                  setMoreOpen(false);
                  clearAllAuthTokens();
                  router.push("/");
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <LogOut className="h-4 w-4 shrink-0" aria-hidden />
                  התנתק
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <nav
        className="fixed inset-x-0 bottom-0 z-40 h-[4.5rem] border-t border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface,#ffffff)]/98 px-2 pb-[max(0px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur"
        aria-label="Main navigation"
      >
        <div
          className={`${shellLayout.contentMaxWidth} grid h-full items-center gap-1`}
          style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}
        >
          {items.map((item) => {
            const active = isBottomNavActive(pathname, item);
            const Icon = navIcons[item.id];
            return (
              <Link
                key={item.id}
                href={item.href}
                onPointerEnter={() => {
                  if (item.href === "/crm") prefetchCrm(router);
                }}
                onFocus={() => {
                  if (item.href === "/crm") prefetchCrm(router);
                }}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] sm:px-2 ${
                  active
                    ? "bg-[#DBEAFE] text-[#1D4ED8] shadow-[inset_0_0_0_1px_rgba(29,78,216,0.18)]"
                    : "text-[#94A3B8] hover:bg-[var(--natalie-surface-elevated,#F8FAFF)] hover:text-[#64748B]"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {Icon ? (
                  <Icon
                    className={`h-5 w-5 shrink-0 transition ${active ? "scale-110 text-[#1D4ED8]" : "opacity-55"}`}
                    aria-hidden
                    strokeWidth={active ? 2.5 : 2}
                  />
                ) : null}
                <span
                  className={`w-full truncate text-[10px] leading-tight sm:text-xs ${
                    active ? "font-extrabold text-[#1D4ED8]" : "font-semibold text-[#94A3B8]"
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreOpen((value) => !value)}
            className={`flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] sm:px-2 ${
              moreActive || moreOpen
                ? "bg-[#DBEAFE] text-[#1D4ED8] shadow-[inset_0_0_0_1px_rgba(29,78,216,0.18)]"
                : "text-[#94A3B8] hover:bg-[var(--natalie-surface-elevated,#F8FAFF)] hover:text-[#64748B]"
            }`}
            aria-expanded={moreOpen}
            aria-label={t("globalNav.more")}
          >
            <Menu className={`h-5 w-5 shrink-0 transition ${moreActive || moreOpen ? "scale-110 text-[#1D4ED8]" : "opacity-55"}`} aria-hidden />
            <span
              className={`w-full truncate text-[10px] leading-tight sm:text-xs ${
                moreActive || moreOpen ? "font-extrabold text-[#1D4ED8]" : "font-semibold text-[#94A3B8]"
              }`}
            >
              {t("globalNav.more")}
            </span>
          </button>
        </div>
      </nav>
    </>
  );
}
