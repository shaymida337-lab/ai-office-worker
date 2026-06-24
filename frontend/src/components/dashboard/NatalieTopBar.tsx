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
    <header className="flex min-w-0 items-center justify-between gap-3 py-0.5 md:py-1" aria-label="סרגל דשבורד">
      <div className="min-w-0 flex-1 text-right">
        <p className="truncate text-base font-bold leading-tight md:text-lg" style={{ color: colors.textPrimary }}>
          {businessName || "העסק שלי"}
        </p>
        <p className="hidden text-sm font-medium leading-5 md:block" style={{ color: colors.textMuted }}>
          לוח הבקרה שלך
        </p>
      </div>

      <button
        type="button"
        onClick={onNotifications}
        aria-label="התראות"
        className={`relative grid h-10 w-10 shrink-0 place-items-center ${radius.control} border transition hover:bg-[#F4F6FB] active:scale-[0.98] md:h-11 md:w-11`}
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
