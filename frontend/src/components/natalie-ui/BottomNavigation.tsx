"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, CalendarDays, FileText, Home, ListChecks, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 h-[4.5rem] border-t border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface,#ffffff)]/98 px-2 pb-[max(0px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur"
      aria-label="Main navigation"
    >
      <div
        className={`${shellLayout.contentMaxWidth} grid h-full items-center gap-1`}
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const active = isBottomNavActive(pathname, item);
          const Icon = navIcons[item.id];
          return (
            <Link
              key={item.id}
              href={item.href}
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
      </div>
    </nav>
  );
}
