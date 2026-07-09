"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, CalendarDays, FileText, Home, ListChecks, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface,#ffffff)]/95 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur sm:px-2"
      aria-label="Main navigation"
    >
      <div className="mx-auto grid w-full max-w-6xl gap-1 xl:max-w-7xl" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = isBottomNavActive(pathname, item);
          const Icon = navIcons[item.id];
          return (
            <Link
              key={item.id}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] sm:px-2 ${
                active ? "bg-[#E0E7FF] text-[#1D4ED8]" : "text-[#64748B]"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden /> : null}
              <span className="w-full truncate text-[10px] font-bold leading-tight sm:text-xs">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
