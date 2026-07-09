"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type BottomNavItem = {
  id: string;
  label: string;
  href: string;
};

export function BottomNavigation({ items }: { items: BottomNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#D9E2F2] bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur md:hidden">
      <div className="grid grid-cols-4 gap-2">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.id}
              href={item.href}
              className={`rounded-xl px-2 py-2 text-center text-xs font-bold ${
                active ? "bg-[#E0E7FF] text-[#1D4ED8]" : "text-[#64748B]"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
