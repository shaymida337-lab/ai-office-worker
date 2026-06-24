"use client";

import { Bell } from "lucide-react";
import { colors, radius } from "@/lib/design-tokens";

export function NatalieTopBar({
  businessName,
  unreadCount = 0,
  onNotifications,
}: {
  businessName: string;
  unreadCount?: number;
  onNotifications: () => void;
}) {
  return (
    <header className="flex min-w-0 items-center justify-between gap-3 py-1" aria-label="סרגל עליון">
      <div className="min-w-0 flex-1 text-right">
        <p className="truncate text-lg font-extrabold leading-tight md:text-xl" style={{ color: colors.textPrimary }}>
          {businessName}
        </p>
      </div>

      <button
        type="button"
        onClick={onNotifications}
        aria-label="התראות"
        className={`relative grid h-11 w-11 shrink-0 place-items-center ${radius.control} border transition active:scale-[0.98]`}
        style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle, color: colors.textSecondary }}
      >
        <Bell className="h-5 w-5" strokeWidth={2} />
        {unreadCount > 0 && (
          <span
            className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: colors.dangerText }}
            aria-hidden
          />
        )}
      </button>
    </header>
  );
}
