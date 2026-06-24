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
    <header className="flex min-w-0 items-center justify-between gap-3 py-0.5" aria-label="מיתוג נטלי">
      <div className="min-w-0 flex-1 text-right">
        <p className="text-xl font-extrabold leading-tight md:text-2xl" style={{ color: colors.accent }}>
          נטלי
        </p>
        <p className="text-sm font-semibold leading-5 md:text-base" style={{ color: colors.textSecondary }}>
          עובדת המשרד שלך
        </p>
        {businessName && (
          <p className="mt-0.5 truncate text-xs font-medium md:text-sm" style={{ color: colors.textMuted }}>
            {businessName}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onNotifications}
        aria-label="התראות"
        className={`relative grid h-10 w-10 shrink-0 place-items-center ${radius.control} border transition active:scale-[0.98] md:h-11 md:w-11`}
        style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle, color: colors.textSecondary }}
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={2} />
        {unreadCount > 0 && (
          <span
            className="absolute left-1.5 top-1.5 h-2 w-2 rounded-full"
            style={{ backgroundColor: colors.dangerText }}
            aria-hidden
          />
        )}
      </button>
    </header>
  );
}
